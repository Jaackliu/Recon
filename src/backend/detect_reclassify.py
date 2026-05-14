"""Detect refunds (撤销/报销) and internal transfers (内部转账).

Matches are based on `cashflow_direction` (1=inflow, 2=outflow).
Detection is performed independently per currency.
Matched pairs have their `type_code` mutated (3=refund, 4=transfer).

Usage:
    python detect_reclassify.py                         # default paths
    python detect_reclassify.py -t path/to/transactions.json
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "data" / "database"
LOG_DIR = ROOT / "data" / "logs"

TRANSACTIONS_PATH = DB_DIR / "transactions.json"


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


def setup_logger(log_dir: Path = LOG_DIR) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("detect_reclassify")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(log_dir / "detect_reclassify.log", encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    return logger


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


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def detect_refunds(transactions: List[Dict[str, Any]], logger: logging.Logger) -> None:
    by_account_currency: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for tx in transactions:
        account_code = str(tx.get("account_code", ""))
        currency = str(tx.get("currency", ""))
        by_account_currency.setdefault((account_code, currency), []).append(tx)

    for (account_code, currency), txns in by_account_currency.items():
        txns.sort(key=lambda t: (t["date"], t["transaction_id"]))
        consumed: Set[str] = set()
        for i, tx in enumerate(txns):
            if tx["transaction_id"] in consumed:
                continue
            if tx["cashflow_direction"] != 2:
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
                if other["cashflow_direction"] != 1:
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
                        "Refund detected: %s (%.2f) <-> %s (%.2f) on %s~%s currency=%s",
                        tx["transaction_id"], amount,
                        other["transaction_id"], other["amount"],
                        tx["date"], other["date"],
                        currency,
                    )
                    break


def detect_transfers(
    transactions: List[Dict[str, Any]],
    logger: logging.Logger,
    processed_at: str | None = None,
) -> List[Dict[str, Any]]:
    expenses_by_currency: Dict[str, List[Dict[str, Any]]] = {}
    incomes_by_currency: Dict[str, List[Dict[str, Any]]] = {}
    for tx in transactions:
        currency = str(tx.get("currency", ""))
        if tx["cashflow_direction"] == 2:
            expenses_by_currency.setdefault(currency, []).append(tx)
        elif tx["cashflow_direction"] == 1:
            incomes_by_currency.setdefault(currency, []).append(tx)

    fee_txns: List[Dict[str, Any]] = []
    currencies = set(expenses_by_currency.keys()) | set(incomes_by_currency.keys())
    for currency in currencies:
        expenses = expenses_by_currency.get(currency, [])
        incomes = incomes_by_currency.get(currency, [])

        expenses.sort(key=lambda t: (t["date"], t["transaction_id"]))
        incomes.sort(key=lambda t: (t["date"], t["transaction_id"]))

        consumed: Set[str] = set()

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
                    "Transfer detected: %s (%.2f, acct %s) <-> %s (%.2f, acct %s) currency=%s",
                    exp["transaction_id"], exp_amount, exp_account,
                    best_match["transaction_id"], best_match["amount"], best_match["account_code"],
                    currency,
                )
                fee = round(exp_amount - best_match["amount"], 2)
                if fee > 0.005:
                    fee_txns.append({
                        "account_code": exp_account,
                        "date": exp["date"],
                        "type_code": 2,
                        "cashflow_direction": 2,
                        "currency": currency or "01",
                        "amount": fee,
                        "balance": 0,
                        "category": "Other",
                        "description": "Transfer fee",
                        "raw_text": f"transfer fee for {exp['transaction_id']}",
                    })
                    logger.info("Fee transaction generated: %.2f for %s currency=%s", fee, exp_account, currency)

    # Assign IDs to fee transactions
    if fee_txns and processed_at is not None:
        seq_map = build_seq_map(transactions)
        for fee in fee_txns:
            key = (fee["account_code"], fee["date"])
            seq = seq_map.get(key, 0) + 1
            seq_map[key] = seq
            date_compact = fee["date"].replace("-", "")
            fee["transaction_id"] = f"TX-{fee['account_code']}-{date_compact}-{seq:03d}"
            fee["processed_at"] = processed_at
            fee["source_hash"] = ""

    return fee_txns


# ---------------------------------------------------------------------------
# Main (standalone)
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect refunds and internal transfers")
    parser.add_argument("-t", "--transactions", type=Path, default=TRANSACTIONS_PATH)
    parser.add_argument("--log-dir", type=Path, default=LOG_DIR)
    args = parser.parse_args()

    logger = setup_logger(args.log_dir)
    logger.info("--- Detect reclassify started ---")

    if not args.transactions.exists():
        logger.error("Transactions file not found: %s", args.transactions)
        return

    transactions = load_json(args.transactions)
    logger.info("Loaded %d transactions", len(transactions))

    detect_refunds(transactions, logger)

    processed_at = datetime.now().astimezone().isoformat()
    fee_txns = detect_transfers(transactions, logger, processed_at=processed_at)
    if fee_txns:
        transactions.extend(fee_txns)
        logger.debug("Added %d fee transactions", len(fee_txns))

    transactions.sort(key=lambda t: (t["date"], t["transaction_id"]))
    write_json(args.transactions, transactions)

    logger.info("Done: %d fee txns added, total %d transactions",
                len(fee_txns), len(transactions))


if __name__ == "__main__":
    main()
