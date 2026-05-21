from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Set, Tuple

import sys
sys.dont_write_bytecode = True

import fitz
from anthropic import Anthropic
import check_transactions
import detect_reclassify

from path_config import ROOT, DB_DIR, LOG_DIR, CONFIG_DIR, RAW_INPUT_DIR

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DPI = 200
MAX_RETRIES = 3
RETRY_DELAY = 5
IMAGE_GROUP_SIZE = 2
MAX_WORKERS = 10
BALANCE_CHECK_MAX_RETRIES = 3

TZ_LOCAL = ZoneInfo(os.environ.get("TIMEZONE", "Asia/Shanghai"))

PDF_DIR = RAW_INPUT_DIR
PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "parse_transactions.txt"

ACCOUNTS_PATH = CONFIG_DIR / "accounts.json"
CURRENCY_PATH = CONFIG_DIR / "currency.json"
TRANSACTIONS_PATH = DB_DIR / "transactions.json"
PARSED_PATH = DB_DIR / "parsed.json"
PARSE_SUMMARY_PATH = DB_DIR / "parse_summary.json"

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("parser")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(LOG_DIR / "parser.log", encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    return logger


def compute_file_hash(file_path: Path) -> str:
    sha256 = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


# ---------------------------------------------------------------------------
# PDF → Image
# ---------------------------------------------------------------------------


def render_pdf_to_images(pdf_path: Path) -> List[str]:
    doc = fitz.open(pdf_path)
    images: List[str] = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        pix = page.get_pixmap(dpi=DPI)
        png_bytes = pix.tobytes("png")
        b64 = base64.b64encode(png_bytes).decode("ascii")
        images.append(b64)
    doc.close()
    return images


def split_images_into_groups(images: List[str], group_size: int = IMAGE_GROUP_SIZE) -> List[List[str]]:
    return [images[i:i + group_size] for i in range(0, len(images), group_size)]


def _call_ai_with_retry(
    client: Anthropic,
    system_prompt: str,
    images: List[str],
    logger: logging.Logger,
    group_label: str,
    model: str,
    is_last_single_page: bool = False,
) -> Tuple[Optional[List[Dict[str, Any]]], bool]:
    """Call AI for one image group with up to MAX_RETRIES attempts.

    Returns (txns, valid_empty):
      - txns is a list on success (may be empty if valid_empty is True)
      - txns is None on failure
      - valid_empty is True only when the last group has 1 page and all
        attempts returned no valid transactions (not API errors)
    """
    last_was_no_txns = False
    for attempt in range(1, MAX_RETRIES + 1):
        logger.debug("%s attempt %d/%d", group_label, attempt, MAX_RETRIES)
        response_text = call_ai(client, system_prompt, images, logger, model)
        if not response_text:
            logger.error("%s attempt %d: API error (no response)", group_label, attempt)
            last_was_no_txns = False
            continue
        txns = parse_ai_response(response_text)
        if txns:
            logger.info("%s attempt %d: extracted %d transactions", group_label, attempt, len(txns))
            return txns, False
        logger.debug("%s attempt %d: no valid transactions", group_label, attempt)
        last_was_no_txns = True

    if is_last_single_page and last_was_no_txns:
        logger.info("%s: last group, 1 page, no transactions found — accepted as valid empty", group_label)
        return [], True
    return None, False


def _call_ai_worker(args: Tuple[int, int, int, List[str], str, str, str, str]) -> Tuple[int, Optional[List[Dict[str, Any]]], bool]:
    gi, total_groups, total_pages, group, system_prompt, api_key, base_url, model = args
    client = Anthropic(api_key=api_key, base_url=base_url)
    logger = setup_logger()
    is_last = gi == total_groups - 1
    is_single_page = len(group) == 1
    label = "Worker group %d/%d (%d images)" % (gi + 1, total_groups, len(group))
    logger.debug(label)
    return gi, *_call_ai_with_retry(
        client, system_prompt, group, logger, label, model,
        is_last_single_page=(is_last and is_single_page),
    )


# ---------------------------------------------------------------------------
# API Interaction
# ---------------------------------------------------------------------------


def load_prompt_template() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def build_system_prompt(accounts: List[Dict[str, Any]], currencies: List[Dict[str, Any]]) -> str:
    template = load_prompt_template()
    prompt_accounts: List[Dict[str, Any]] = []
    for account in accounts:
        prompt_accounts.append({
            "account_code": account.get("account_code", ""),
            "account_name": account.get("account_name", ""),
            "bank_name": account.get("bank_name", ""),
            "account_number": account.get("account_number", ""),
            "supported_currencies": account.get("supported_currencies", []),
        })
    accounts_json = json.dumps(prompt_accounts, indent=2, ensure_ascii=False)
    prompt_currencies = [
        {k: v for k, v in c.items() if k != "alias"}
        for c in currencies
    ]
    currency_json = json.dumps(prompt_currencies, indent=2, ensure_ascii=False)
    return template.format(accounts_json=accounts_json, currency_json=currency_json)


def call_ai(
    client: Anthropic,
    system_prompt: str,
    images: List[str],
    logger: logging.Logger,
    model: str,
) -> Optional[str]:
    content: List[Dict[str, Any]] = []
    for i, b64 in enumerate(images):
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": b64,
            },
        })
        content.append({
            "type": "text",
            "text": f"[Page {i + 1}]",
        })

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.debug("API call attempt %d/%d (%d pages)", attempt, MAX_RETRIES, len(images))
            message = client.messages.create(
                model=model,
                max_tokens=20480,
                system=system_prompt,
                messages=[{"role": "user", "content": content}],
            )
            for block in message.content:
                if getattr(block, "type", None) == "text":
                    return block.text
            logger.warning("API returned no text content")
            return None
        except Exception as exc:
            logger.warning("API call attempt %d failed: %s", attempt, exc)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
    logger.error("All %d API attempts failed", MAX_RETRIES)
    return None


def call_ai_grouped(
    client: Anthropic,
    system_prompt: str,
    images: List[str],
    logger: logging.Logger,
    api_key: str,
    model: str,
    base_url: str,
) -> Optional[str]:
    groups = split_images_into_groups(images)
    total_pages = len(images)

    # Single group — still use retry logic, no process pool needed
    if len(groups) == 1:
        is_single_page = total_pages == 1
        txns, valid_empty = _call_ai_with_retry(
            client, system_prompt, groups[0], logger,
            "Single group (%d images)" % total_pages, model,
            is_last_single_page=is_single_page,
        )
        if txns is None:
            return None
        return json.dumps(txns, ensure_ascii=False)

    # Multiple groups — use process pool
    logger.debug("Splitting %d pages into %d groups (max %d per group), up to %d workers",
                 total_pages, len(groups), IMAGE_GROUP_SIZE, MAX_WORKERS)

    tasks = [
        (gi, len(groups), total_pages, group, system_prompt, api_key, base_url, model)
        for gi, group in enumerate(groups)
    ]

    results: Dict[int, Tuple[Optional[List[Dict[str, Any]]], bool]] = {}
    with ProcessPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_call_ai_worker, args): args[0] for args in tasks}
        for future in as_completed(futures):
            try:
                gi, txns, valid_empty = future.result()
            except Exception as exc:
                logger.error("Worker process exception: %s", exc)
                return None
            results[gi] = (txns, valid_empty)

    all_txns: List[Dict[str, Any]] = []
    for gi in range(len(groups)):
        txns, valid_empty = results[gi]
        if txns is None:
            logger.error("Group %d/%d failed — aborting PDF", gi + 1, len(groups))
            return None
        all_txns.extend(txns)

    return json.dumps(all_txns, ensure_ascii=False)


def parse_ai_response(response_text: str) -> Optional[List[Dict[str, Any]]]:
    if not response_text:
        return None
    # Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\s*", "", response_text)
    cleaned = cleaned.replace("```", "").strip()
    # Find JSON array
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start:end + 1])
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    return None


# ---------------------------------------------------------------------------
# Transaction ID Generation
# ---------------------------------------------------------------------------


def build_seq_map(transactions: List[Dict[str, Any]]) -> Dict[Tuple[str, str], int]:
    seq_map: Dict[Tuple[str, str], int] = {}
    for tx in transactions:
        account_code = tx["account_code"]
        date = tx["date"]
        parts = tx["transaction_id"].split("-")
        try:
            seq = int(parts[-1])
        except (ValueError, IndexError):
            seq = 0
        key = (account_code, date)
        seq_map[key] = max(seq_map.get(key, 0), seq)
    return seq_map


def assign_transaction_ids(
    raw_txns: List[Dict[str, Any]],
    seq_map: Dict[Tuple[str, str], int],
    source_hash: str,
    processed_at: str,
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for raw in raw_txns:
        account_code = str(raw.get("account_code", "")).strip()
        date = str(raw.get("date", "")).strip()
        if not account_code or not date:
            continue
        key = (account_code, date)
        seq = seq_map.get(key, 0) + 1
        seq_map[key] = seq
        date_compact = date.replace("-", "")
        tx_id = f"TX-{account_code}-{date_compact}-{seq:03d}"
        type_code = int(raw.get("type_code", 2))
        cashflow_direction = 1 if type_code == 1 else 2
        tx = {
            "transaction_id": tx_id,
            "date": date,
            "account_code": account_code,
            "type_code": type_code,
            "cashflow_direction": cashflow_direction,
            "currency": str(raw.get("currency", "01")),
            "amount": round(float(raw.get("amount", 0)), 2),
            "balance": round(float(raw.get("balance", 0)), 2),
            "category": str(raw.get("category", "Other")),
            "description": str(raw.get("description", "")),
            "raw_text": str(raw.get("raw_text", "")),
            "processed_at": processed_at,
            "source_hash": source_hash,
        }
        if tx["amount"] <= 0:
            tx["amount"] = abs(tx["amount"])
        result.append(tx)
    return result


# ---------------------------------------------------------------------------
# Business Logic
# ---------------------------------------------------------------------------


def apply_dedup(
    new_txns: List[Dict[str, Any]],
    existing_txns: List[Dict[str, Any]],
    logger: logging.Logger,
) -> List[Dict[str, Any]]:
    existing_dates: Set[Tuple[str, str]] = set()
    for tx in existing_txns:
        existing_dates.add((tx["account_code"], tx["date"]))

    kept: List[Dict[str, Any]] = []
    dropped = 0
    for tx in new_txns:
        key = (tx["account_code"], tx["date"])
        if key in existing_dates:
            dropped += 1
            logger.debug("Dedup: dropping %s %s (date already exists)", tx["account_code"], tx["date"])
        else:
            kept.append(tx)
    if dropped:
        logger.info("Dedup: dropped %d transactions, kept %d", dropped, len(kept))
    return kept


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"date", "account_code", "type_code", "amount", "balance", "category"}


def validate_transactions(
    raw_txns: List[Dict[str, Any]],
    logger: logging.Logger,
) -> List[Dict[str, Any]]:
    valid: List[Dict[str, Any]] = []
    for i, raw in enumerate(raw_txns):
        if not isinstance(raw, dict):
            logger.warning("Skipping non-dict entry at index %d", i)
            continue
        missing = REQUIRED_FIELDS - set(raw.keys())
        if missing:
            logger.warning("Skipping entry %d, missing fields: %s", i, missing)
            continue
        try:
            float(raw["amount"])
        except (ValueError, TypeError):
            logger.warning("Skipping entry %d, invalid amount: %s", i, raw.get("amount"))
            continue
        valid.append(raw)
    return valid


def validate_single_account(raw_txns: List[Dict[str, Any]], logger: logging.Logger) -> bool:
    codes = {str(tx.get("account_code", "")).strip() for tx in raw_txns}
    codes.discard("")
    if len(codes) > 1:
        logger.error("Multiple account codes in single PDF batch: %s", codes)
        return False
    if len(codes) == 0:
        logger.error("No account code found in extracted transactions")
        return False
    return True


def _check_balance_order(txns: List[Dict[str, Any]]) -> bool:
    """Return True if balance arithmetic holds in the given order.

    For each consecutive pair, checks:
        balance[i+1] ≈ balance[i] + signed_amount[i+1]
    where signed_amount is +amount for type_code==1 (income) and -amount for
    type_code==2 (expense).

    Returns True for groups with fewer than 2 transactions (trivially correct).
    Returns False if any balance or amount is missing/invalid.
    """
    if len(txns) < 2:
        return True

    for i in range(len(txns) - 1):
        try:
            balance_i = round(float(txns[i]["balance"]), 2)
            balance_next = round(float(txns[i + 1]["balance"]), 2)
            amount_next = round(float(txns[i + 1]["amount"]), 2)
            type_code = int(txns[i + 1].get("type_code", 2))
        except (ValueError, TypeError, KeyError):
            return False

        signed = amount_next if type_code == 1 else -amount_next
        expected = round(balance_i + signed, 2)
        if abs(expected - balance_next) > 0.01:
            return False

    return True


def normalize_transaction_order(
    raw_txns: List[Dict[str, Any]],
    logger: logging.Logger,
) -> List[Dict[str, Any]]:
    """Detect and fix descending within-day order.

    Groups transactions by (account_code, date, currency).  For each group
    with 2+ entries, checks whether the balance arithmetic holds in the
    current order.  If it does not hold but holds after reversing, the
    group is reversed in-place within the list.  This ensures that
    assign_transaction_ids always assigns sequence numbers in ascending
    chronological order regardless of the PDF's native sort direction.

    Groups where neither order satisfies the arithmetic are left unchanged
    (the balance-check retry logic will handle them).
    """
    if len(raw_txns) < 2:
        return raw_txns

    from collections import defaultdict

    groups: Dict[Tuple[str, str, str], List[int]] = defaultdict(list)
    for i, tx in enumerate(raw_txns):
        account = str(tx.get("account_code", "")).strip()
        date = str(tx.get("date", "")).strip()
        currency = str(tx.get("currency", "01")).strip()
        groups[(account, date, currency)].append(i)

    reversed_count = 0
    for key, indices in groups.items():
        if len(indices) < 2:
            continue

        group_txns = [raw_txns[i] for i in indices]

        if _check_balance_order(group_txns):
            continue

        reversed_group = list(reversed(group_txns))
        if _check_balance_order(reversed_group):
            for j, idx in enumerate(indices):
                raw_txns[idx] = reversed_group[j]
            reversed_count += 1
            logger.info(
                "Reversed descending order: account=%s date=%s currency=%s (%d txns)",
                key[0], key[1], key[2], len(indices),
            )
        else:
            logger.warning(
                "Balance arithmetic inconsistent in both orders: "
                "account=%s date=%s currency=%s (%d txns) — leaving unchanged",
                key[0], key[1], key[2], len(indices),
            )

    if reversed_count:
        logger.info("Normalized %d descending groups to ascending order", reversed_count)

    return raw_txns


def parse_pdf(
    pdf_path: Path,
    file_hash: str,
    system_prompt: str,
    client: Anthropic,
    api_key: str,
    model: str,
    base_url: str,
    seq_map: Dict[Tuple[str, str], int],
    logger: logging.Logger,
    processed_at: str,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    try:
        images = render_pdf_to_images(pdf_path)
        logger.info("Processing %s (%d pages, hash: %s...)", pdf_path.name, len(images), file_hash[:16])
    except Exception as exc:
        logger.error("Failed to render PDF %s: %s", pdf_path.name, exc)
        return [], None

    response_text = call_ai_grouped(client, system_prompt, images, logger, api_key, model, base_url)
    if not response_text:
        logger.error("No response from AI for %s", pdf_path.name)
        return [], None

    raw_txns = parse_ai_response(response_text)
    if not raw_txns:
        logger.error("Failed to parse AI response for %s. Response (truncated): %s",
                     pdf_path.name, response_text[:500])
        return [], None
    currencies_found = sorted({str(tx.get("currency", "")) for tx in raw_txns if tx.get("currency")})
    logger.info("Extracted %d raw transactions from %s (account: %s, currencies: %s)",
                len(raw_txns), pdf_path.name,
                str(raw_txns[0].get("account_code", "unknown")).strip(),
                ", ".join(currencies_found) if currencies_found else "unknown")

    raw_txns = validate_transactions(raw_txns, logger)
    if not raw_txns:
        logger.error("No valid transactions after validation for %s", pdf_path.name)
        return [], None

    if not validate_single_account(raw_txns, logger):
        logger.error("Skipping %s due to multi-account violation", pdf_path.name)
        return [], None

    raw_txns = normalize_transaction_order(raw_txns, logger)

    account_code = str(raw_txns[0].get("account_code", "")).strip()
    new_txns = assign_transaction_ids(raw_txns, seq_map, file_hash, processed_at)
    parsed_entry = {
        "file_hash": file_hash,
        "file_name": pdf_path.name,
        "processed_at": processed_at,
        "account_code": account_code,
    }
    tx_currencies = sorted({tx["currency"] for tx in new_txns})
    logger.debug("Assigned %d transaction IDs for %s (account: %s, currencies: %s)",
                 len(new_txns), pdf_path.name, account_code, ", ".join(tx_currencies))
    return new_txns, parsed_entry


def run_balance_check_and_reparse(
    transactions: List[Dict[str, Any]],
    parsed_entries: List[Dict[str, Any]],
    pdf_hash_map: Dict[str, Path],
    system_prompt: str,
    client: Anthropic,
    api_key: str,
    model: str,
    base_url: str,
    logger: logging.Logger,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    for attempt in range(1, BALANCE_CHECK_MAX_RETRIES + 1):
        # Balance check is performed per PDF and per currency.
        errors_by_hash = check_transactions.check_transactions_by_pdf(
            transactions,
            parsed_entries,
            logger,
        )
        if not errors_by_hash:
            if attempt == 1:
                logger.info("Balance check: all PDFs/currencies ok")
            else:
                logger.info("Balance check passed after %d attempts (per currency)", attempt)
            return transactions, parsed_entries

        failed_hashes = sorted(errors_by_hash.keys())
        logger.warning(
            "Balance check found %d PDFs with mismatches (attempt %d/%d)",
            len(failed_hashes),
            attempt,
            BALANCE_CHECK_MAX_RETRIES,
        )

        if attempt >= BALANCE_CHECK_MAX_RETRIES:
            logger.error(
                "Balance check failed after %d attempts; removing %d PDFs",
                BALANCE_CHECK_MAX_RETRIES,
                len(failed_hashes),
            )
            transactions, parsed_entries = check_transactions.remove_pdf_records(
                transactions,
                parsed_entries,
                failed_hashes,
                logger,
            )
            return transactions, parsed_entries

        transactions, parsed_entries = check_transactions.remove_pdf_records(
            transactions,
            parsed_entries,
            failed_hashes,
            logger,
        )

        reparsed_txns: List[Dict[str, Any]] = []
        reparsed_entries: List[Dict[str, Any]] = []
        seq_map = build_seq_map(transactions)
        processed_at = datetime.now(TZ_LOCAL).isoformat()

        for file_hash in failed_hashes:
            pdf_path = pdf_hash_map.get(file_hash)
            if not pdf_path:
                logger.error("Balance check: missing PDF file for hash %s", file_hash)
                continue
            new_txns, parsed_entry = parse_pdf(
                pdf_path,
                file_hash,
                system_prompt,
                client,
                api_key,
                model,
                base_url,
                seq_map,
                logger,
                processed_at,
            )
            if not new_txns or not parsed_entry:
                logger.error("Balance check: reparse failed for %s", pdf_path.name)
                continue
            reparsed_txns.extend(new_txns)
            reparsed_entries.append(parsed_entry)

        if reparsed_txns:
            reparsed_txns = apply_dedup(reparsed_txns, transactions, logger)
            if reparsed_txns:
                transactions.extend(reparsed_txns)
                transactions.sort(key=lambda t: (t["date"], t["transaction_id"]))
        if reparsed_entries:
            parsed_entries.extend(reparsed_entries)

    return transactions, parsed_entries


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------


def main() -> None:
    logger = setup_logger()
    logger.info("--- Parser started ---")

    # Failure tracking
    failed_pdfs: List[Dict[str, Any]] = []
    success_pdfs: List[Dict[str, Any]] = []

    def _record_failure(file_name: str, reason: str, detail: str = "") -> None:
        failed_pdfs.append({"file_name": file_name, "reason": reason, "detail": detail})
        logger.error("PARSE_FAILED: %s reason=%s detail=%s", file_name, reason, detail)

    # Load accounts
    if not ACCOUNTS_PATH.exists():
        logger.error("accounts.json not found at %s", ACCOUNTS_PATH)
        return
    accounts = load_json(ACCOUNTS_PATH)

    if not CURRENCY_PATH.exists():
        logger.error("currency.json not found at %s", CURRENCY_PATH)
        return
    currencies = load_json(CURRENCY_PATH)

    # Load existing transactions
    if TRANSACTIONS_PATH.exists():
        transactions = load_json(TRANSACTIONS_PATH)
    else:
        transactions = []

    # Load parsed history
    if PARSED_PATH.exists():
        parsed_entries = load_json(PARSED_PATH)
    else:
        parsed_entries = []
    parsed_hashes: Set[str] = {entry["file_hash"] for entry in parsed_entries}

    # Scan PDF directory
    pdf_files = sorted(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        logger.info("No PDF files found in %s", PDF_DIR)
        return

    # Filter out already parsed
    pdf_hash_map: Dict[str, Path] = {}
    unprocessed: List[Tuple[Path, str]] = []
    for pdf_path in pdf_files:
        file_hash = compute_file_hash(pdf_path)
        pdf_hash_map[file_hash] = pdf_path
        if file_hash not in parsed_hashes:
            unprocessed.append((pdf_path, file_hash))

    if not unprocessed:
        logger.info("All %d PDFs already parsed. Nothing to do.", len(pdf_files))
        return
    logger.info("Found %d PDFs, %d unprocessed", len(pdf_files), len(unprocessed))

    # Load prompt template
    system_prompt = build_system_prompt(accounts, currencies)

    # Create API client
    import os
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("AI_API_KEY")
    base_url = os.environ.get("AI_BASE_URL")
    model = os.environ.get("AI_MODEL")
    if not api_key:
        logger.error("AI_API_KEY not set in .env")
        return
    if not base_url:
        logger.error("AI_BASE_URL not set in .env")
        return
    if not model:
        logger.error("AI_MODEL not set in .env")
        return
    client = Anthropic(api_key=api_key, base_url=base_url)

    processed_at = datetime.now(TZ_LOCAL).isoformat()
    seq_map = build_seq_map(transactions)
    all_new_txns: List[Dict[str, Any]] = []
    new_parsed_entries: List[Dict[str, Any]] = []

    # Process each PDF
    for pdf_path, file_hash in unprocessed:
        # Step 1: Render PDF to images (no retry — if the file is broken, retrying won't help)
        try:
            images = render_pdf_to_images(pdf_path)
            logger.info("Processing %s (%d pages, hash: %s...)", pdf_path.name, len(images), file_hash[:16])
        except Exception as exc:
            _record_failure(pdf_path.name, "render_error", str(exc)[:200])
            continue

        # Step 2: Initial AI call (ai_no_response is NOT retried here —
        # call_ai_grouped already retries 3 times internally)
        response_text = call_ai_grouped(client, system_prompt, images, logger, api_key, model, base_url)
        if not response_text:
            _record_failure(pdf_path.name, "ai_no_response", "AI API returned no response")
            continue

        # Step 3: Parse + validate with retry (ai_parse_error / no_valid_transactions / multi_account)
        last_error = ("", "")
        for attempt in range(1, MAX_RETRIES + 1):
            raw_txns = parse_ai_response(response_text)
            if not raw_txns:
                last_error = ("ai_parse_error", "Failed to parse AI response as JSON")
                logger.warning("Attempt %d/%d: %s for %s", attempt, MAX_RETRIES, last_error[0], pdf_path.name)
                if attempt < MAX_RETRIES:
                    response_text = call_ai_grouped(client, system_prompt, images, logger, api_key, model, base_url)
                    if not response_text:
                        last_error = ("ai_no_response", "AI API returned no response on retry")
                        break
                continue

            raw_txns = validate_transactions(raw_txns, logger)
            if not raw_txns:
                last_error = ("no_valid_transactions", "No valid transactions after field validation")
                logger.warning("Attempt %d/%d: %s for %s", attempt, MAX_RETRIES, last_error[0], pdf_path.name)
                if attempt < MAX_RETRIES:
                    response_text = call_ai_grouped(client, system_prompt, images, logger, api_key, model, base_url)
                    if not response_text:
                        last_error = ("ai_no_response", "AI API returned no response on retry")
                        break
                continue

            if not validate_single_account(raw_txns, logger):
                last_error = ("multi_account", "Multiple account codes found in single PDF")
                logger.warning("Attempt %d/%d: %s for %s", attempt, MAX_RETRIES, last_error[0], pdf_path.name)
                if attempt < MAX_RETRIES:
                    response_text = call_ai_grouped(client, system_prompt, images, logger, api_key, model, base_url)
                    if not response_text:
                        last_error = ("ai_no_response", "AI API returned no response on retry")
                        break
                continue

            # All checks passed
            last_error = ("", "")
            break

        if last_error[0]:
            _record_failure(pdf_path.name, last_error[0], last_error[1])
            continue

        # Step 4: Normalize order, assign IDs, record success
        raw_txns = normalize_transaction_order(raw_txns, logger)
        account_code = str(raw_txns[0].get("account_code", "")).strip()
        new_txns = assign_transaction_ids(raw_txns, seq_map, file_hash, processed_at)

        parsed_entry = {
            "file_hash": file_hash,
            "file_name": pdf_path.name,
            "processed_at": processed_at,
            "account_code": account_code,
        }
        all_new_txns.extend(new_txns)
        new_parsed_entries.append(parsed_entry)
        success_pdfs.append({"file_name": pdf_path.name, "transaction_count": len(new_txns)})

    if not all_new_txns:
        summary = {
            "timestamp": processed_at,
            "total_pdfs": len(unprocessed),
            "new_pdfs": len(unprocessed),
            "success_count": 0,
            "new_transaction_count": 0,
            "failed_pdfs": failed_pdfs,
            "success_pdfs": [],
        }
        write_json(PARSE_SUMMARY_PATH, summary)
        logger.info("No new transactions extracted from any PDF. Failed: %d", len(failed_pdfs))
        return

    # Deduplication
    all_new_txns = apply_dedup(all_new_txns, transactions, logger)
    if not all_new_txns:
        logger.info("All new transactions were duplicates. Nothing to add.")
        parsed_entries.extend(new_parsed_entries)
        write_json(PARSED_PATH, parsed_entries)
        summary = {
            "timestamp": processed_at,
            "total_pdfs": len(unprocessed),
            "new_pdfs": len(unprocessed),
            "success_count": len(success_pdfs),
            "new_transaction_count": 0,
            "failed_pdfs": failed_pdfs,
            "success_pdfs": success_pdfs,
        }
        write_json(PARSE_SUMMARY_PATH, summary)
        return

    # Merge
    transactions.extend(all_new_txns)
    parsed_entries.extend(new_parsed_entries)
    logger.debug("Total transactions after merge: %d", len(transactions))

    # Balance consistency check on full dataset
    transactions, parsed_entries = run_balance_check_and_reparse(
        transactions,
        parsed_entries,
        pdf_hash_map,
        system_prompt,
        client,
        api_key,
        model,
        base_url,
        logger,
    )

    # Track PDFs removed by balance check
    final_hashes = {entry.get("file_hash") for entry in parsed_entries}
    for entry in new_parsed_entries:
        fh = entry.get("file_hash")
        if fh and fh not in final_hashes:
            fn = entry.get("file_name", fh)
            # Remove from success_pdfs if present
            success_pdfs = [s for s in success_pdfs if s["file_name"] != fn]
            # Add to failed_pdfs if not already there
            if not any(f["file_name"] == fn for f in failed_pdfs):
                _record_failure(fn, "balance_check_failed", "Balance consistency check failed after retries")

    # Refund detection on full dataset
    detect_reclassify.detect_refunds(transactions, logger)

    # Transfer detection on full dataset
    fee_txns = detect_reclassify.detect_transfers(transactions, logger, processed_at=processed_at)
    if fee_txns:
        transactions.extend(fee_txns)
        logger.debug("Added %d fee transactions", len(fee_txns))

    # Sort transactions for consistent output
    transactions.sort(key=lambda t: (t["date"], t["transaction_id"]))

    # Write outputs
    write_json(TRANSACTIONS_PATH, transactions)
    write_json(PARSED_PATH, parsed_entries)

    # Write summary
    new_accounts = sorted({tx["account_code"] for tx in all_new_txns})
    new_currencies = sorted({tx["currency"] for tx in all_new_txns})
    final_txn_count = sum(s["transaction_count"] for s in success_pdfs)
    summary = {
        "timestamp": processed_at,
        "total_pdfs": len(unprocessed),
        "new_pdfs": len(unprocessed),
        "success_count": len(success_pdfs),
        "new_transaction_count": final_txn_count,
        "failed_pdfs": failed_pdfs,
        "success_pdfs": success_pdfs,
    }
    write_json(PARSE_SUMMARY_PATH, summary)

    logger.info("Done: +%d new txns from %d PDFs (success: %d, failed: %d), total %d transactions (accounts: %s, currencies: %s)",
                final_txn_count + len(fee_txns), len(unprocessed), len(success_pdfs), len(failed_pdfs),
                len(transactions), ", ".join(new_accounts), ", ".join(new_currencies))


if __name__ == "__main__":
    main()
