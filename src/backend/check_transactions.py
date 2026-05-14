from __future__ import annotations

import json
import logging
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "data" / "database"
LOG_DIR = ROOT / "data" / "logs"

TRANSACTIONS_PATH = DB_DIR / "transactions.json"
PARSED_PATH = DB_DIR / "parsed.json"

EPSILON = 0.01


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("check_transactions")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(LOG_DIR / "check_transactions.log", encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    return logger


def round_money(value: float) -> float:
    rounded = float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if abs(rounded) < 0.005:
        return 0.0
    return rounded


def parse_tx_sequence(transaction_id: str) -> int:
    parts = transaction_id.split("-")
    if len(parts) >= 4:
        try:
            return int(parts[-1])
        except ValueError:
            return 0
    return 0


def tx_sort_key(tx: Dict[str, Any]) -> Tuple[str, int, str]:
    tx_id = str(tx.get("transaction_id", ""))
    return (str(tx.get("date", "")), parse_tx_sequence(tx_id), tx_id)


def parse_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def infer_signed_amount(tx: Dict[str, Any], logger: logging.Logger) -> Optional[float]:
    amount = parse_float(tx.get("amount"))
    direction = parse_float(tx.get("cashflow_direction"))
    if amount is None or direction is None:
        logger.error(
            "Balance check: invalid amount or cashflow_direction: tx=%s",
            tx.get("transaction_id", ""),
        )
        return None
    if int(direction) == 1:
        return amount
    if int(direction) == 2:
        return -amount
    logger.error(
        "Balance check: unknown cashflow_direction: tx=%s direction=%s",
        tx.get("transaction_id", ""),
        direction,
    )
    return None


def normalize_parsed_entries(parsed_entries: Any) -> Tuple[List[Dict[str, Any]], bool]:
    if isinstance(parsed_entries, dict):
        entries: List[Dict[str, Any]] = []
        for file_hash, entry in parsed_entries.items():
            if not isinstance(entry, dict):
                continue
            normalized = dict(entry)
            normalized.setdefault("file_hash", file_hash)
            entries.append(normalized)
        return entries, True
    if isinstance(parsed_entries, list):
        return parsed_entries, False
    return [], False


def build_parsed_output(entries: List[Dict[str, Any]], as_dict: bool) -> Any:
    if not as_dict:
        return entries
    return {entry.get("file_hash", ""): entry for entry in entries if entry.get("file_hash")}


def build_pdf_name_map(parsed_entries: List[Dict[str, Any]]) -> Dict[str, str]:
    name_map: Dict[str, str] = {}
    for entry in parsed_entries:
        file_hash = entry.get("file_hash", "")
        if not file_hash:
            continue
        name_map[file_hash] = entry.get("file_name", "")
    return name_map


def check_transactions_by_pdf(
    transactions: List[Dict[str, Any]],
    parsed_entries: List[Dict[str, Any]],
    logger: logging.Logger,
) -> Dict[str, List[Dict[str, Any]]]:
    pdf_name_map = build_pdf_name_map(parsed_entries)
    checkable = [tx for tx in transactions if tx.get("source_hash")]

    txns_by_hash: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for tx in checkable:
        txns_by_hash[str(tx.get("source_hash", ""))].append(tx)

    errors_by_hash: Dict[str, List[Dict[str, Any]]] = {}
    for source_hash, txns in txns_by_hash.items():
        if not source_hash:
            continue
        txns.sort(key=tx_sort_key)
        account_codes = {str(tx.get("account_code", "")) for tx in txns}
        if len(account_codes) > 1:
            logger.error(
                "Balance check: multiple account codes in PDF %s: %s",
                pdf_name_map.get(source_hash, source_hash),
                sorted(code for code in account_codes if code),
            )
            errors_by_hash.setdefault(source_hash, []).append({"reason": "multiple_accounts"})
            continue

        txns_by_currency: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for tx in txns:
            currency = str(tx.get("currency", ""))
            txns_by_currency[currency].append(tx)

        for currency, currency_txns in txns_by_currency.items():
            currency_txns.sort(key=tx_sort_key)
            prev_balance: Optional[float] = None
            for tx in currency_txns:
                tx_id = str(tx.get("transaction_id", ""))
                if prev_balance is None:
                    balance = parse_float(tx.get("balance"))
                    if balance is None:
                        logger.error(
                            "Balance check: invalid balance: account=%s currency=%s tx=%s",
                            next(iter(account_codes), ""),
                            currency,
                            tx_id,
                        )
                    else:
                        prev_balance = balance
                    logger.debug("Balance check: skip tx without previous balance: %s", tx_id)
                    continue
                amount = parse_float(tx.get("amount"))
                balance = parse_float(tx.get("balance"))
                if amount is None or balance is None:
                    logger.error(
                        "Balance check: invalid amount/balance: tx=%s",
                        tx_id,
                    )
                    errors_by_hash.setdefault(source_hash, []).append(
                        {"transaction_id": tx_id, "currency": currency}
                    )
                    continue
                signed = infer_signed_amount(tx, logger)
                if signed is None:
                    errors_by_hash.setdefault(source_hash, []).append(
                        {"transaction_id": tx_id, "currency": currency}
                    )
                    continue
                expected = round_money(prev_balance + signed)
                if abs(expected - balance) > EPSILON:
                    pdf_label = pdf_name_map.get(source_hash, source_hash)
                    logger.error(
                        "Balance mismatch: pdf=%s currency=%s tx=%s prev=%.2f amount=%.2f dir=%s expected=%.2f actual=%.2f",
                        pdf_label,
                        currency,
                        tx_id,
                        prev_balance,
                        amount,
                        tx.get("cashflow_direction"),
                        expected,
                        balance,
                    )
                    errors_by_hash.setdefault(source_hash, []).append(
                        {
                            "transaction_id": tx_id,
                            "currency": currency,
                            "prev_balance": prev_balance,
                            "amount": amount,
                            "cashflow_direction": tx.get("cashflow_direction"),
                            "expected_balance": expected,
                            "actual_balance": balance,
                        }
                    )
                prev_balance = balance

    return errors_by_hash


def remove_pdf_records(
    transactions: List[Dict[str, Any]],
    parsed_entries: List[Dict[str, Any]],
    failed_hashes: List[str],
    logger: logging.Logger,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    failed_set = set(failed_hashes)
    before_txn = len(transactions)
    before_parsed = len(parsed_entries)

    filtered_transactions = [
        tx for tx in transactions
        if str(tx.get("source_hash", "")) not in failed_set
    ]
    filtered_parsed = [
        entry for entry in parsed_entries
        if str(entry.get("file_hash", "")) not in failed_set
    ]

    removed_txn = before_txn - len(filtered_transactions)
    removed_parsed = before_parsed - len(filtered_parsed)
    logger.info(
        "Removed %d transactions and %d parsed entries for %d PDFs",
        removed_txn,
        removed_parsed,
        len(failed_set),
    )
    return filtered_transactions, filtered_parsed


def main() -> None:
    logger = setup_logger()
    logger.info("--- Transactions check started ---")

    if not TRANSACTIONS_PATH.exists():
        logger.error("transactions.json not found at %s", TRANSACTIONS_PATH)
        return
    transactions = load_json(TRANSACTIONS_PATH)

    if PARSED_PATH.exists():
        parsed_raw = load_json(PARSED_PATH)
    else:
        parsed_raw = []
    parsed_entries, parsed_is_dict = normalize_parsed_entries(parsed_raw)

    errors_by_hash = check_transactions_by_pdf(transactions, parsed_entries, logger)
    if not errors_by_hash:
        logger.info("All PDFs passed balance consistency check")
        return

    failed_hashes = sorted(errors_by_hash.keys())
    transactions, parsed_entries = remove_pdf_records(transactions, parsed_entries, failed_hashes, logger)
    write_json(TRANSACTIONS_PATH, transactions)
    write_json(PARSED_PATH, build_parsed_output(parsed_entries, parsed_is_dict))

    logger.warning(
        "Balance check failed for %d PDFs; removed related records",
        len(failed_hashes),
    )


if __name__ == "__main__":
    main()
