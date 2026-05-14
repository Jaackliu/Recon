"""One-time migration: convert Chinese category names to English in transactions.json.

Idempotent -- skips transactions that already have English categories.
Logs unmapped categories as warnings.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "data" / "database"
LOG_DIR = ROOT / "data" / "logs"

TRANSACTIONS_PATH = DB_DIR / "transactions.json"

CATEGORY_MAP = {
    "交通": "Transportation",
    "餐饮": "Food",
    "生活": "Living",
    "购物": "Shopping",
    "居住": "Housing",
    "文娱旅游": "Entertainment",
    "订阅": "Subscription",
    "通讯": "Telecom",
    "行政": "Administrative",
    "外部转账": "External Transfer",
    "其他": "Other",
    "工资": "Salary",
    "奖学金": "Scholarship",
    "补助": "Subsidy",
    "税息": "Tax & Interest",
    "教育": "Education",
}

ENGLISH_CATEGORIES = set(CATEGORY_MAP.values())


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("migrate_categories")
    logger.setLevel(logging.DEBUG)
    fh = logging.FileHandler(LOG_DIR / "migrate_categories.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


def main() -> None:
    logger = setup_logger()

    if not TRANSACTIONS_PATH.exists():
        logger.error("transactions.json not found at %s", TRANSACTIONS_PATH)
        sys.exit(1)

    with TRANSACTIONS_PATH.open("r", encoding="utf-8") as f:
        transactions = json.load(f)

    migrated = 0
    skipped = 0
    unmapped = 0

    for tx in transactions:
        cat = tx.get("category", "")
        if cat in ENGLISH_CATEGORIES:
            skipped += 1
            continue
        if cat in CATEGORY_MAP:
            tx["category"] = CATEGORY_MAP[cat]
            migrated += 1
        else:
            logger.warning("Unmapped category: %r (tx: %s)", cat, tx.get("transaction_id", "?"))
            unmapped += 1

    with TRANSACTIONS_PATH.open("w", encoding="utf-8") as f:
        json.dump(transactions, f, indent=2, ensure_ascii=False)

    logger.info("Migration complete: %d migrated, %d already English, %d unmapped", migrated, skipped, unmapped)


if __name__ == "__main__":
    main()
