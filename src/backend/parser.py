from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz
from anthropic import Anthropic

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MODEL = "mimo-v2.5"
BASE_URL = "https://token-plan-cn.xiaomimimo.com/anthropic"
DPI = 200
MAX_RETRIES = 3
RETRY_DELAY = 5

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
            logger.info("API call attempt %d/%d (%d pages)", attempt, MAX_RETRIES, len(images))
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
        tx = {
            "transaction_id": tx_id,
            "date": date,
            "account_code": account_code,
            "type_code": int(raw.get("type_code", 2)),
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
            logger.info("Dedup: dropping %s %s (date already exists)", tx["account_code"], tx["date"])
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


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------


def main() -> None:
    logger = setup_logger()
    logger.info("=" * 60)
    logger.info("Parser started")

    # Load accounts
    if not ACCOUNTS_PATH.exists():
        logger.error("accounts.json not found at %s", ACCOUNTS_PATH)
        return
    accounts = load_json(ACCOUNTS_PATH)
    logger.info("Loaded %d accounts", len(accounts))

    # Load existing transactions
    if TRANSACTIONS_PATH.exists():
        transactions = load_json(TRANSACTIONS_PATH)
    else:
        transactions = []
    logger.info("Existing transactions: %d", len(transactions))

    # Load parsed history
    if PARSED_PATH.exists():
        parsed_entries = load_json(PARSED_PATH)
    else:
        parsed_entries = []
    parsed_hashes: Set[str] = {entry["file_hash"] for entry in parsed_entries}
    logger.info("Previously parsed files: %d", len(parsed_hashes))

    # Scan PDF directory
    pdf_files = sorted(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        logger.info("No PDF files found in %s", PDF_DIR)
        return
    logger.info("Found %d PDF files", len(pdf_files))

    # Filter out already parsed
    unprocessed: List[Path] = []
    for pdf_path in pdf_files:
        file_hash = compute_file_hash(pdf_path)
        if file_hash in parsed_hashes:
            logger.info("Skipping already parsed: %s (hash: %s...)", pdf_path.name, file_hash[:16])
        else:
            unprocessed.append(pdf_path)

    if not unprocessed:
        logger.info("All PDFs already parsed. Nothing to do.")
        return
    logger.info("Unprocessed PDFs: %d", len(unprocessed))

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
    for pdf_path in unprocessed:
        file_hash = compute_file_hash(pdf_path)
        logger.info("Processing: %s (hash: %s...)", pdf_path.name, file_hash[:16])

        # Render PDF to images
        try:
            images = render_pdf_to_images(pdf_path)
            logger.info("Rendered %d pages to images", len(images))
        except Exception as exc:
            logger.error("Failed to render PDF %s: %s", pdf_path.name, exc)
            continue

        # Call AI API
        response_text = call_ai(client, system_prompt, images, logger)
        if not response_text:
            logger.error("No response from AI for %s", pdf_path.name)
            continue

        # Parse response
        raw_txns = parse_ai_response(response_text)
        if not raw_txns:
            logger.error("Failed to parse AI response for %s. Response (truncated): %s",
                         pdf_path.name, response_text[:500])
            continue
        logger.info("Extracted %d raw transactions from %s", len(raw_txns), pdf_path.name)

        # Validate
        raw_txns = validate_transactions(raw_txns, logger)
        if not raw_txns:
            logger.error("No valid transactions after validation for %s", pdf_path.name)
            continue

        if not validate_single_account(raw_txns, logger):
            logger.error("Skipping %s due to multi-account violation", pdf_path.name)
            continue

        # Assign IDs
        account_code = str(raw_txns[0].get("account_code", "")).strip()
        new_txns = assign_transaction_ids(raw_txns, seq_map, file_hash, processed_at)
        all_new_txns.extend(new_txns)
        new_parsed_entries.append({
            "file_hash": file_hash,
            "file_name": pdf_path.name,
            "processed_at": processed_at,
            "account_code": account_code,
        })
        logger.info("Assigned %d transaction IDs for %s (account: %s)", len(new_txns), pdf_path.name, account_code)

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
    logger.info("Total transactions after merge: %d", len(transactions))

    # Refund detection on full dataset
    detect_refunds(transactions, logger)

    # Transfer detection on full dataset
    fee_txns = detect_transfers(transactions, logger)
    if fee_txns:
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
        logger.info("Added %d fee transactions", len(fee_txns))

    # Sort transactions for consistent output
    transactions.sort(key=lambda t: (t["date"], t["transaction_id"]))

    # Write outputs
    write_json(TRANSACTIONS_PATH, transactions)
    logger.info("Wrote %d transactions to %s", len(transactions), TRANSACTIONS_PATH)

    parsed_entries.extend(new_parsed_entries)
    write_json(PARSED_PATH, parsed_entries)
    logger.info("Updated parsed.json with %d new entries", len(new_parsed_entries))

    logger.info("Parser finished. %d new transactions added from %d PDFs.",
                len(all_new_txns) + len(fee_txns), len(unprocessed))
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
