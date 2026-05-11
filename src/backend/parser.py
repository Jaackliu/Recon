from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz
from anthropic import Anthropic
import transactions_check

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MODEL = "mimo-v2.5"
BASE_URL = "https://token-plan-cn.xiaomimimo.com/anthropic"
DPI = 200
MAX_RETRIES = 3
RETRY_DELAY = 5
IMAGE_GROUP_SIZE = 2
MAX_WORKERS = 5
BALANCE_CHECK_MAX_RETRIES = 3

TZ_CST = timezone(timedelta(hours=8))

ROOT = Path(__file__).resolve().parents[2]
PDF_DIR = ROOT / "data" / "raw_input"
DB_DIR = ROOT / "data" / "database"
LOG_DIR = ROOT / "data" / "logs"
PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "parse_transactions.txt"

ACCOUNTS_PATH = DB_DIR / "accounts.json"
TRANSACTIONS_PATH = DB_DIR / "transactions.json"
PARSED_PATH = DB_DIR / "parsed.json"

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
        response_text = call_ai(client, system_prompt, images, logger)
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


def _call_ai_worker(args: Tuple[int, int, int, List[str], str, str, str]) -> Tuple[int, Optional[List[Dict[str, Any]]], bool]:
    gi, total_groups, total_pages, group, system_prompt, api_key, base_url = args
    client = Anthropic(api_key=api_key, base_url=base_url)
    logger = setup_logger()
    is_last = gi == total_groups - 1
    is_single_page = len(group) == 1
    label = "Worker group %d/%d (%d images)" % (gi + 1, total_groups, len(group))
    logger.debug(label)
    return gi, *_call_ai_with_retry(
        client, system_prompt, group, logger, label,
        is_last_single_page=(is_last and is_single_page),
    )


# ---------------------------------------------------------------------------
# API Interaction
# ---------------------------------------------------------------------------


def load_prompt_template() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def build_system_prompt(accounts: List[Dict[str, Any]]) -> str:
    template = load_prompt_template()
    accounts_json = json.dumps(accounts, indent=2, ensure_ascii=False)
    return template.format(accounts_json=accounts_json)


def call_ai(
    client: Anthropic,
    system_prompt: str,
    images: List[str],
    logger: logging.Logger,
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
                model=MODEL,
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
) -> Optional[str]:
    groups = split_images_into_groups(images)
    total_pages = len(images)

    # Single group — still use retry logic, no process pool needed
    if len(groups) == 1:
        is_single_page = total_pages == 1
        txns, valid_empty = _call_ai_with_retry(
            client, system_prompt, groups[0], logger,
            "Single group (%d images)" % total_pages,
            is_last_single_page=is_single_page,
        )
        if txns is None:
            return None
        return json.dumps(txns, ensure_ascii=False)

    # Multiple groups — use process pool
    logger.debug("Splitting %d pages into %d groups (max %d per group), up to %d workers",
                 total_pages, len(groups), IMAGE_GROUP_SIZE, MAX_WORKERS)

    tasks = [
        (gi, len(groups), total_pages, group, system_prompt, api_key, BASE_URL)
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
            "currency": str(raw.get("currency", "CNY")),
            "amount": round(float(raw.get("amount", 0)), 2),
            "balance": round(float(raw.get("balance", 0)), 2),
            "category": str(raw.get("category", "其他")),
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


def detect_refunds(transactions: List[Dict[str, Any]], logger: logging.Logger) -> None:
    by_account: Dict[str, List[Dict[str, Any]]] = {}
    for tx in transactions:
        by_account.setdefault(tx["account_code"], []).append(tx)

    for account_code, txns in by_account.items():
        txns.sort(key=lambda t: (t["date"], t["transaction_id"]))
        consumed: Set[str] = set()
        for i, tx in enumerate(txns):
            if tx["transaction_id"] in consumed:
                continue
            if tx["type_code"] != 2:
                continue
            amount = tx["amount"]
            tx_date = datetime.strptime(tx["date"], "%Y-%m-%d").date()
            is_integer_amount = abs(amount - round(amount)) < 0.005
            if is_integer_amount and amount <= 5:
                continue
            window_days = 30 if is_integer_amount else 60
            for j in range(i + 1, len(txns)):
                other = txns[j]
                if other["transaction_id"] in consumed:
                    continue
                if other["type_code"] != 1:
                    continue
                other_date = datetime.strptime(other["date"], "%Y-%m-%d").date()
                delta = (other_date - tx_date).days
                if delta < 0 or delta > window_days:
                    break
                if abs(other["amount"] - amount) < 0.005:
                    tx["type_code"] = 3
                    other["type_code"] = 3
                    consumed.add(tx["transaction_id"])
                    consumed.add(other["transaction_id"])
                    logger.info(
                        "Refund detected: %s (%.2f) <-> %s (%.2f) on %s~%s",
                        tx["transaction_id"], amount,
                        other["transaction_id"], other["amount"],
                        tx["date"], other["date"],
                    )
                    break


def detect_transfers(transactions: List[Dict[str, Any]], logger: logging.Logger) -> List[Dict[str, Any]]:
    expenses: List[Dict[str, Any]] = []
    incomes: List[Dict[str, Any]] = []
    for tx in transactions:
        if tx["type_code"] == 2:
            expenses.append(tx)
        elif tx["type_code"] == 1:
            incomes.append(tx)

    expenses.sort(key=lambda t: (t["date"], t["transaction_id"]))
    incomes.sort(key=lambda t: (t["date"], t["transaction_id"]))

    consumed: Set[str] = set()
    fee_txns: List[Dict[str, Any]] = []

    for exp in expenses:
        if exp["transaction_id"] in consumed:
            continue
        exp_date = datetime.strptime(exp["date"], "%Y-%m-%d").date()
        exp_account = exp["account_code"]
        exp_amount = exp["amount"]

        best_match = None
        for inc in incomes:
            if inc["transaction_id"] in consumed:
                continue
            if inc["account_code"] == exp_account:
                continue
            inc_date = datetime.strptime(inc["date"], "%Y-%m-%d").date()
            delta = (inc_date - exp_date).days
            if delta < 0 or delta > 3:
                continue
            if exp_amount * 0.97 <= inc["amount"] <= exp_amount:
                best_match = inc
                break

        if best_match:
            exp["type_code"] = 4
            best_match["type_code"] = 4
            consumed.add(exp["transaction_id"])
            consumed.add(best_match["transaction_id"])
            logger.info(
                "Transfer detected: %s (%.2f, acct %s) <-> %s (%.2f, acct %s)",
                exp["transaction_id"], exp_amount, exp_account,
                best_match["transaction_id"], best_match["amount"], best_match["account_code"],
            )
            fee = round(exp_amount - best_match["amount"], 2)
            if fee > 0.005:
                fee_txns.append({
                    "account_code": exp_account,
                    "date": exp["date"],
                    "type_code": 2,
                    "cashflow_direction": 2,
                    "currency": "CNY",
                    "amount": fee,
                    "balance": 0,
                    "category": "其他",
                    "description": "转账手续费",
                    "raw_text": f"transfer fee for {exp['transaction_id']}",
                })
                logger.info("Fee transaction generated: %.2f for %s", fee, exp_account)

    return fee_txns


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


def parse_pdf(
    pdf_path: Path,
    file_hash: str,
    system_prompt: str,
    client: Anthropic,
    api_key: str,
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

    response_text = call_ai_grouped(client, system_prompt, images, logger, api_key)
    if not response_text:
        logger.error("No response from AI for %s", pdf_path.name)
        return [], None

    raw_txns = parse_ai_response(response_text)
    if not raw_txns:
        logger.error("Failed to parse AI response for %s. Response (truncated): %s",
                     pdf_path.name, response_text[:500])
        return [], None
    logger.info("Extracted %d raw transactions from %s", len(raw_txns), pdf_path.name)

    raw_txns = validate_transactions(raw_txns, logger)
    if not raw_txns:
        logger.error("No valid transactions after validation for %s", pdf_path.name)
        return [], None

    if not validate_single_account(raw_txns, logger):
        logger.error("Skipping %s due to multi-account violation", pdf_path.name)
        return [], None

    account_code = str(raw_txns[0].get("account_code", "")).strip()
    new_txns = assign_transaction_ids(raw_txns, seq_map, file_hash, processed_at)
    parsed_entry = {
        "file_hash": file_hash,
        "file_name": pdf_path.name,
        "processed_at": processed_at,
        "account_code": account_code,
    }
    logger.debug("Assigned %d transaction IDs for %s (account: %s)", len(new_txns), pdf_path.name, account_code)
    return new_txns, parsed_entry


def run_balance_check_and_reparse(
    transactions: List[Dict[str, Any]],
    parsed_entries: List[Dict[str, Any]],
    pdf_hash_map: Dict[str, Path],
    system_prompt: str,
    client: Anthropic,
    api_key: str,
    logger: logging.Logger,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    for attempt in range(1, BALANCE_CHECK_MAX_RETRIES + 1):
        errors_by_hash = transactions_check.check_transactions_by_pdf(
            transactions,
            parsed_entries,
            logger,
        )
        if not errors_by_hash:
            if attempt == 1:
                logger.info("Balance check: all PDFs ok")
            else:
                logger.info("Balance check passed after %d attempts", attempt)
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
            transactions, parsed_entries = transactions_check.remove_pdf_records(
                transactions,
                parsed_entries,
                failed_hashes,
                logger,
            )
            return transactions, parsed_entries

        transactions, parsed_entries = transactions_check.remove_pdf_records(
            transactions,
            parsed_entries,
            failed_hashes,
            logger,
        )

        reparsed_txns: List[Dict[str, Any]] = []
        reparsed_entries: List[Dict[str, Any]] = []
        seq_map = build_seq_map(transactions)
        processed_at = datetime.now(TZ_CST).isoformat()

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

    # Load accounts
    if not ACCOUNTS_PATH.exists():
        logger.error("accounts.json not found at %s", ACCOUNTS_PATH)
        return
    accounts = load_json(ACCOUNTS_PATH)

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
    system_prompt = build_system_prompt(accounts)

    # Create API client
    import os
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("MIMO_API_KEY")
    if not api_key:
        logger.error("MIMO_API_KEY not set in .env")
        return
    client = Anthropic(api_key=api_key, base_url=BASE_URL)

    processed_at = datetime.now(TZ_CST).isoformat()
    seq_map = build_seq_map(transactions)
    all_new_txns: List[Dict[str, Any]] = []
    new_parsed_entries: List[Dict[str, Any]] = []

    # Process each PDF
    for pdf_path, file_hash in unprocessed:
        new_txns, parsed_entry = parse_pdf(
            pdf_path,
            file_hash,
            system_prompt,
            client,
            api_key,
            seq_map,
            logger,
            processed_at,
        )
        if not new_txns or not parsed_entry:
            continue
        all_new_txns.extend(new_txns)
        new_parsed_entries.append(parsed_entry)

    if not all_new_txns:
        logger.info("No new transactions extracted from any PDF.")
        return

    # Deduplication
    all_new_txns = apply_dedup(all_new_txns, transactions, logger)
    if not all_new_txns:
        logger.info("All new transactions were duplicates. Nothing to add.")
        # Still update parsed.json
        parsed_entries.extend(new_parsed_entries)
        write_json(PARSED_PATH, parsed_entries)
        return

    # Merge
    transactions.extend(all_new_txns)
    parsed_entries.extend(new_parsed_entries)
    logger.debug("Total transactions after merge: %d", len(transactions))

    # Balance consistency check before refunds/transfers
    transactions, parsed_entries = run_balance_check_and_reparse(
        transactions,
        parsed_entries,
        pdf_hash_map,
        system_prompt,
        client,
        api_key,
        logger,
    )

    # Refund detection on full dataset
    detect_refunds(transactions, logger)

    # Transfer detection on full dataset
    fee_txns = detect_transfers(transactions, logger)
    if fee_txns:
        seq_map = build_seq_map(transactions)
        # Assign IDs to fee transactions
        for fee in fee_txns:
            key = (fee["account_code"], fee["date"])
            seq = seq_map.get(key, 0) + 1
            seq_map[key] = seq
            date_compact = fee["date"].replace("-", "")
            fee["transaction_id"] = f"TX-{fee['account_code']}-{date_compact}-{seq:03d}"
            fee["processed_at"] = processed_at
            fee["source_hash"] = ""
        transactions.extend(fee_txns)
        logger.debug("Added %d fee transactions", len(fee_txns))

    # Sort transactions for consistent output
    transactions.sort(key=lambda t: (t["date"], t["transaction_id"]))

    # Write outputs
    write_json(TRANSACTIONS_PATH, transactions)
    write_json(PARSED_PATH, parsed_entries)

    logger.info("Done: +%d new txns from %d PDFs, total %d transactions",
                len(all_new_txns) + len(fee_txns), len(unprocessed), len(transactions))


if __name__ == "__main__":
    main()
