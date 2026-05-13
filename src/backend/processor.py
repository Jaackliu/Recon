from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

TYPE_LABELS = {
    1: "income",
    2: "expense",
    3: "refund",
    4: "transfer",
}

FILTERED_TYPE_CODES = {1, 2}
INTERNAL_TRANSFER_CODE = 4
DEFAULT_DATASET_KEY = "default"
DEFAULT_LOCAL_KEY = "default_local"


def round_money(value: float) -> float:
    rounded = float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if abs(rounded) < 0.005:
        return 0.0
    return rounded


def get_fx_rate(
    rates: Dict[str, Dict[str, float]],
    source_currency: str,
    target_currency: str,
    logger: logging.Logger,
) -> float:
    if source_currency == target_currency:
        return 1.0
    try:
        return float(rates[source_currency][target_currency])
    except KeyError:
        logger.error(
            "Missing fx rate: %s -> %s",
            source_currency,
            target_currency,
        )
        return 1.0


def parse_date(value: str) -> datetime.date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def date_range(start_date: datetime.date, end_date: datetime.date) -> Iterable[datetime.date]:
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def parse_tx_sequence(transaction_id: str) -> int:
    parts = transaction_id.split("-")
    if len(parts) >= 4:
        try:
            return int(parts[-1])
        except ValueError:
            return 0
    return 0


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=False)


def setup_logger(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("processor")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(log_path, encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger


def infer_signed_amount(
    tx: Dict[str, Any],
    logger: logging.Logger,
) -> float:
    amount = float(tx["amount"])
    direction = int(tx["cashflow_direction"])

    if direction == 1:
        return amount
    if direction == 2:
        return -amount

    logger.warning(
        "Unknown cashflow_direction: account=%s tx=%s",
        tx.get("account_code", ""),
        tx.get("transaction_id", ""),
    )
    return -amount


def normalize_transactions(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for tx in transactions:
        normalized.append(
            {
                **tx,
                "_date": parse_date(tx["date"]),
                "_seq": parse_tx_sequence(tx["transaction_id"]),
            }
        )
    return normalized


def prepare_transactions(
    transactions: List[Dict[str, Any]],
    logger: logging.Logger,
    account_targets: Optional[Dict[str, str]] = None,
    filter_currency: Optional[str] = None,
    fx_rates: Optional[Dict[str, Dict[str, float]]] = None,
) -> List[Dict[str, Any]]:
    prepared: List[Dict[str, Any]] = []

    for tx in transactions:
        if filter_currency:
            if tx.get("currency") != filter_currency:
                continue
            prepared.append(dict(tx))
            continue

        if account_targets is None or fx_rates is None:
            logger.error("Missing currency conversion settings.")
            return []

        account_code = tx.get("account_code")
        target_currency = account_targets.get(account_code)
        if not target_currency:
            logger.warning("Missing target currency for account: %s", account_code)
            continue

        source_currency = tx.get("currency")
        if not source_currency:
            logger.warning("Missing source currency for transaction: %s", tx.get("transaction_id"))
            continue

        rate = get_fx_rate(fx_rates, source_currency, target_currency, logger)
        converted = dict(tx)
        converted["amount"] = float(tx["amount"]) * rate
        converted["balance"] = float(tx["balance"]) * rate
        converted["currency"] = target_currency
        prepared.append(converted)

    return prepared


def group_by_account(transactions: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for tx in transactions:
        grouped[tx["account_code"]].append(tx)
    for account_code, items in grouped.items():
        items.sort(key=lambda item: (item["_date"], item["_seq"], item["transaction_id"]))
    return grouped


def build_daily_series_from_grouped(
    transactions_by_account: Dict[str, List[Dict[str, Any]]],
    account_codes: List[str],
    logger: logging.Logger,
) -> Dict[str, List[Dict[str, Any]]]:
    global_end_date: Optional[datetime.date] = None
    if transactions_by_account:
        all_txs = [tx for items in transactions_by_account.values() for tx in items]
        if all_txs:
            global_end_date = max(tx["_date"] for tx in all_txs)

    daily_series: Dict[str, List[Dict[str, Any]]] = {}
    for account_code in account_codes:
        account_txs = transactions_by_account.get(account_code, [])
        if not account_txs:
            daily_series[account_code] = []
            continue
        start_date = account_txs[0]["_date"]
        end_date = global_end_date or account_txs[-1]["_date"]
        daily_series[account_code] = build_daily_series(
            account_txs,
            start_date,
            end_date,
            account_code,
            logger,
        )

    return daily_series


def build_converted_daily_series(
    transactions_raw: List[Dict[str, Any]],
    account_codes: List[str],
    logger: logging.Logger,
    account_targets: Dict[str, str],
    fx_rates: Dict[str, Dict[str, float]],
) -> Dict[str, List[Dict[str, Any]]]:
    global_end_date: Optional[datetime.date] = None
    if transactions_raw:
        global_end_date = max(parse_date(tx["date"]) for tx in transactions_raw)

    grouped: Dict[str, Dict[str, List[Dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for tx in transactions_raw:
        account_code = tx.get("account_code")
        if account_code not in account_targets:
            continue
        source_currency = tx.get("currency")
        if not source_currency:
            logger.warning("Missing source currency for transaction: %s", tx.get("transaction_id"))
            continue

        target_currency = account_targets[account_code]
        rate = get_fx_rate(fx_rates, source_currency, target_currency, logger)
        converted = dict(tx)
        converted["amount"] = float(tx["amount"]) * rate
        converted["balance"] = float(tx["balance"]) * rate
        converted["currency"] = target_currency
        grouped[account_code][source_currency].append(converted)

    daily_series: Dict[str, List[Dict[str, Any]]] = {}
    for account_code in account_codes:
        currency_series: Dict[str, List[Dict[str, Any]]] = {}
        for source_currency, txs in grouped.get(account_code, {}).items():
            normalized = normalize_transactions(txs)
            if not normalized:
                continue
            start_date = min(tx["_date"] for tx in normalized)
            end_date = global_end_date or max(tx["_date"] for tx in normalized)
            currency_series[source_currency] = build_daily_series(
                normalized,
                start_date,
                end_date,
                account_code,
                logger,
            )

        if currency_series:
            daily_series[account_code] = build_total_series(currency_series)
        else:
            daily_series[account_code] = []

    currency_breakdown: Dict[str, List[Dict[str, Any]]] = {}
    for account_code in account_codes:
        target_currency = account_targets.get(account_code, "")
        rows: List[Dict[str, Any]] = []
        for source_currency, series in grouped.get(account_code, {}).items():
            normalized = normalize_transactions(
                [
                    {**tx, "amount": float(tx["amount"]) * get_fx_rate(fx_rates, tx.get("currency", ""), target_currency, logger), "balance": float(tx["balance"]) * get_fx_rate(fx_rates, tx.get("currency", ""), target_currency, logger)}
                    for tx in series
                ]
            )
            if not normalized:
                continue
            last_entry = normalized[-1]
            rows.append({
                "currency": source_currency,
                "end_balance": round_money(float(last_entry["balance"])),
            })
        if rows:
            rows.sort(key=lambda r: abs(r["end_balance"]), reverse=True)
            currency_breakdown[account_code] = rows

    return daily_series, currency_breakdown


def build_daily_series(
    transactions: List[Dict[str, Any]],
    start_date: datetime.date,
    end_date: datetime.date,
    account_code: str,
    logger: logging.Logger,
) -> List[Dict[str, Any]]:
    if not transactions:
        return []

    tx_by_date: Dict[datetime.date, List[Dict[str, Any]]] = defaultdict(list)
    for tx in transactions:
        tx_by_date[tx["_date"]].append(tx)
    for day in tx_by_date:
        tx_by_date[day].sort(key=lambda item: (item["_seq"], item["transaction_id"]))

    daily: List[Dict[str, Any]] = []
    prev_end_balance: Optional[float] = None
    last_balance: Optional[float] = None

    for current_date in date_range(start_date, end_date):
        day_txs = tx_by_date.get(current_date, [])

        all_inflow = 0.0
        all_outflow = 0.0
        filtered_inflow = 0.0
        filtered_outflow = 0.0
        internal_inflow = 0.0
        internal_outflow = 0.0

        start_balance = prev_end_balance

        if day_txs:
            if start_balance is None:
                signed_first = infer_signed_amount(day_txs[0], logger)
                start_balance = float(day_txs[0]["balance"]) - signed_first
            last_balance = start_balance

            for tx in day_txs:
                signed = infer_signed_amount(tx, logger)
                if signed >= 0:
                    all_inflow += signed
                else:
                    all_outflow += signed

                if int(tx["type_code"]) in FILTERED_TYPE_CODES:
                    if signed >= 0:
                        filtered_inflow += signed
                    else:
                        filtered_outflow += signed

                if int(tx["type_code"]) == INTERNAL_TRANSFER_CODE:
                    if signed >= 0:
                        internal_inflow += signed
                    else:
                        internal_outflow += signed

                last_balance = float(tx["balance"])
            end_balance = last_balance if last_balance is not None else start_balance
        else:
            if start_balance is None:
                start_balance = 0.0
            end_balance = start_balance
            last_balance = end_balance

        internal_net = internal_inflow + internal_outflow

        daily.append(
            {
                "date": current_date.isoformat(),
                "start_balance": round_money(start_balance),
                "end_balance": round_money(end_balance),
                "all_inflow": round_money(all_inflow),
                "all_outflow": round_money(all_outflow),
                "net_internal_transfer": round_money(internal_net),
                "filtered_inflow": round_money(filtered_inflow),
                "filtered_outflow": round_money(filtered_outflow),
            }
        )

        prev_end_balance = end_balance
        last_balance = end_balance

    return daily


def build_total_series(account_series: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    ranges = []
    for series in account_series.values():
        if series:
            ranges.append((parse_date(series[0]["date"]), parse_date(series[-1]["date"])))

    if not ranges:
        return []

    start_date = min(item[0] for item in ranges)
    end_date = max(item[1] for item in ranges)

    series_maps = {
        account: {entry["date"]: entry for entry in series}
        for account, series in account_series.items()
    }

    total_series: List[Dict[str, Any]] = []
    for current_date in date_range(start_date, end_date):
        date_key = current_date.isoformat()
        totals = {
            "start_balance": 0.0,
            "end_balance": 0.0,
            "all_inflow": 0.0,
            "all_outflow": 0.0,
            "net_internal_transfer": 0.0,
            "filtered_inflow": 0.0,
            "filtered_outflow": 0.0,
        }

        for series_map in series_maps.values():
            entry = series_map.get(date_key)
            if entry is None:
                continue
            totals["start_balance"] += float(entry["start_balance"])
            totals["end_balance"] += float(entry["end_balance"])
            totals["all_inflow"] += float(entry["all_inflow"])
            totals["all_outflow"] += float(entry["all_outflow"])
            totals["net_internal_transfer"] += float(entry["net_internal_transfer"])
            totals["filtered_inflow"] += float(entry["filtered_inflow"])
            totals["filtered_outflow"] += float(entry["filtered_outflow"])

        total_series.append(
            {
                "date": date_key,
                "start_balance": round_money(totals["start_balance"]),
                "end_balance": round_money(totals["end_balance"]),
                "all_inflow": round_money(totals["all_inflow"]),
                "all_outflow": round_money(totals["all_outflow"]),
                "net_internal_transfer": round_money(totals["net_internal_transfer"]),
                "filtered_inflow": round_money(totals["filtered_inflow"]),
                "filtered_outflow": round_money(totals["filtered_outflow"]),
            }
        )

    return total_series


def build_heatmap(series: List[Dict[str, Any]], days: int = 90) -> List[Dict[str, Any]]:
    if not series:
        return []
    slice_series = series[-days:] if len(series) > days else series
    heatmap = []
    for entry in slice_series:
        net_inflow = float(entry["all_inflow"]) + float(entry["all_outflow"])
        heatmap.append(
            {
                "date": entry["date"],
                "net_inflow": round_money(net_inflow),
            }
        )
    return heatmap


def build_monthly_combo(series: List[Dict[str, Any]], months: int = 12) -> List[Dict[str, Any]]:
    if not series:
        return []

    month_stats: Dict[str, Dict[str, float]] = {}
    month_order: List[str] = []

    for entry in series:
        month_key = entry["date"][:7]
        if month_key not in month_stats:
            month_stats[month_key] = {"end_balance": 0.0, "inflow": 0.0, "outflow": 0.0}
            month_order.append(month_key)
        month_stats[month_key]["end_balance"] = float(entry["end_balance"])
        month_stats[month_key]["inflow"] += float(entry["all_inflow"])
        month_stats[month_key]["outflow"] += float(entry["all_outflow"])

    recent_months = month_order[-months:]
    output = []
    for month_key in recent_months:
        stats = month_stats[month_key]
        output.append(
            {
                "month": month_key,
                "end_balance": round_money(stats["end_balance"]),
                "inflow": round_money(stats["inflow"]),
                "outflow": round_money(stats["outflow"]),
            }
        )
    return output


def build_transactions_output(
    account_codes: List[str],
    transactions_by_account: Dict[str, List[Dict[str, Any]]],
    include_total: bool = True,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    def tx_sort_key(tx: Dict[str, Any]) -> Any:
        return (tx["_date"], tx["_seq"], tx["transaction_id"])

    output: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

    for account_code in account_codes:
        txs = sorted(transactions_by_account.get(account_code, []), key=tx_sort_key)
        output[account_code] = {
            "transactions": [serialize_transaction(tx) for tx in txs]
        }

    if include_total:
        all_txs: List[Dict[str, Any]] = []
        for account_code in account_codes:
            all_txs.extend(transactions_by_account.get(account_code, []))
        all_txs.sort(key=tx_sort_key)

        output["total"] = {"transactions": [serialize_transaction(tx) for tx in all_txs]}
    return output


def serialize_transaction(tx: Dict[str, Any]) -> Dict[str, Any]:
    type_code = int(tx["type_code"])
    return {
        "id": tx["transaction_id"],
        "date": tx["date"],
        "type": TYPE_LABELS.get(type_code, "expense"),
        "is_filtered": type_code in FILTERED_TYPE_CODES,
        "category": tx["category"],
        "amount": round_money(float(tx["amount"])),
        "cashflow_direction": int(tx["cashflow_direction"]),
        "description": tx["description"],
    }


def build_dataset(
    transactions_raw: List[Dict[str, Any]],
    account_codes: List[str],
    logger: logging.Logger,
    account_targets: Optional[Dict[str, str]] = None,
    filter_currency: Optional[str] = None,
    fx_rates: Optional[Dict[str, Dict[str, float]]] = None,
    include_total: bool = True,
) -> Dict[str, Any]:
    prepared = prepare_transactions(
        transactions_raw,
        logger,
        account_targets=account_targets,
        filter_currency=filter_currency,
        fx_rates=fx_rates,
    )
    transactions = normalize_transactions(prepared)
    transactions_by_account = group_by_account(transactions)

    currency_breakdown: Optional[Dict[str, List[Dict[str, Any]]]] = None
    if account_targets and fx_rates and not filter_currency:
        daily_series, currency_breakdown = build_converted_daily_series(
            transactions_raw,
            account_codes,
            logger,
            account_targets,
            fx_rates,
        )
    else:
        daily_series = build_daily_series_from_grouped(
            transactions_by_account,
            account_codes,
            logger,
        )

    if include_total:
        daily_series["total"] = build_total_series(daily_series)

    static_charts: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for account_code, series in daily_series.items():
        static_charts[account_code] = {
            "heatmap": build_heatmap(series),
            "monthly_combo": build_monthly_combo(series),
        }

    transactions_output = build_transactions_output(
        account_codes,
        transactions_by_account,
        include_total=include_total,
    )

    return {
        "daily_series": daily_series,
        "static_charts": static_charts,
        "transactions": transactions_output,
        "currency_breakdown": currency_breakdown,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "data"
    db_dir = data_dir / "database"
    ui_dir = data_dir / "ui"
    log_dir = data_dir / "logs"
    settings_path = repo_root / "settings.json"
    currency_path = db_dir / "currency.json"
    fx_rate_path = db_dir / "fx_rate.json"

    logger = setup_logger(log_dir / "processor.log")

    accounts_path = db_dir / "accounts.json"
    transactions_path = db_dir / "transactions.json"

    if not transactions_path.exists():
        logger.error("Missing transactions file: %s", transactions_path)
        return

    transactions_raw = load_json(transactions_path)

    accounts_raw: List[Dict[str, Any]] = []
    if accounts_path.exists():
        accounts_raw = load_json(accounts_path)
        account_codes = [item["account_code"] for item in accounts_raw]
    else:
        account_codes = sorted({tx["account_code"] for tx in transactions_raw})

    account_defaults = {
        item["account_code"]: item.get("default_currency") for item in accounts_raw
    }

    supported_currency_codes: List[str] = []
    for account in accounts_raw:
        supported_currency_codes.extend(account.get("supported_currencies", []))
    supported_currency_codes = sorted(set(supported_currency_codes))

    currencies_raw: List[Dict[str, Any]] = []
    if currency_path.exists():
        currencies_raw = load_json(currency_path)

    fx_rates: Dict[str, Dict[str, float]] = {}
    if fx_rate_path.exists():
        fx_payload = load_json(fx_rate_path)
        fx_rates = fx_payload.get("rates", {})

    settings: Dict[str, Any] = {}
    if settings_path.exists():
        settings = load_json(settings_path)

    global_default_currency = settings.get("global_default_currency")
    if not global_default_currency:
        if account_defaults:
            global_default_currency = next(iter(account_defaults.values()))
        elif currencies_raw:
            global_default_currency = currencies_raw[0].get("currency_code")

    if not global_default_currency:
        logger.error("Missing global default currency setting.")
        return

    if not fx_rates:
        logger.error("Missing fx rate data: %s", fx_rate_path)
        return

    daily_series_by_currency: Dict[str, Any] = {}
    static_charts_by_currency: Dict[str, Any] = {}
    transactions_by_currency: Dict[str, Any] = {}

    global_targets = {code: global_default_currency for code in account_codes}
    local_targets = {
        code: account_defaults.get(code, global_default_currency) for code in account_codes
    }

    global_dataset = build_dataset(
        transactions_raw,
        account_codes,
        logger,
        account_targets=global_targets,
        fx_rates=fx_rates,
        include_total=True,
    )
    daily_series_by_currency[DEFAULT_DATASET_KEY] = global_dataset["daily_series"]
    static_charts_by_currency[DEFAULT_DATASET_KEY] = global_dataset["static_charts"]
    transactions_by_currency[DEFAULT_DATASET_KEY] = global_dataset["transactions"]

    local_dataset = build_dataset(
        transactions_raw,
        account_codes,
        logger,
        account_targets=local_targets,
        fx_rates=fx_rates,
        include_total=False,
    )
    daily_series_by_currency[DEFAULT_LOCAL_KEY] = local_dataset["daily_series"]
    static_charts_by_currency[DEFAULT_LOCAL_KEY] = local_dataset["static_charts"]
    transactions_by_currency[DEFAULT_LOCAL_KEY] = local_dataset["transactions"]

    for currency_code in supported_currency_codes:
        filtered_dataset = build_dataset(
            transactions_raw,
            account_codes,
            logger,
            filter_currency=currency_code,
            include_total=True,
        )
        daily_series_by_currency[currency_code] = filtered_dataset["daily_series"]
        static_charts_by_currency[currency_code] = filtered_dataset["static_charts"]
        transactions_by_currency[currency_code] = filtered_dataset["transactions"]

    currency_breakdown = local_dataset.get("currency_breakdown")

    meta = {"processor_default_currency": global_default_currency}
    daily_series_by_currency["_meta"] = meta
    static_charts_by_currency["_meta"] = meta
    transactions_by_currency["_meta"] = meta

    write_json(ui_dir / "ui_daily_series.json", daily_series_by_currency)
    write_json(ui_dir / "ui_static_charts.json", static_charts_by_currency)
    write_json(ui_dir / "ui_transactions_and_categories.json", transactions_by_currency)
    if currency_breakdown is not None:
        write_json(ui_dir / "ui_currency_breakdown.json", currency_breakdown)

    logger.info("Generated UI data: %s", ui_dir)


if __name__ == "__main__":
    main()
