from __future__ import annotations

import json
import logging
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Tuple

import httpx

from path_config import DB_DIR, LOG_DIR, CONFIG_DIR

CURRENCY_PATH = CONFIG_DIR / "currency.json"
FX_RATE_PATH = DB_DIR / "fx_rate.json"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)


def setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("fetch_fx")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(LOG_DIR / "fetch_fx.log", encoding="utf-8")
        formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    return logger


def round_rate(value: Decimal, places: int = 6) -> float:
    quant = Decimal("1").scaleb(-places)
    return float(value.quantize(quant, rounding=ROUND_HALF_UP))


def load_currencies() -> List[Dict[str, str]]:
    data = load_json(CURRENCY_PATH)
    if not isinstance(data, list):
        raise ValueError("currency.json must be a list")
    currencies: List[Dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        currency_code = str(item.get("currency_code", "")).strip()
        currency_iso = str(item.get("currency_iso", "")).strip().upper()
        alias = item.get("alias", "")
        currency_symbol = str(item.get("currency_symbol", "")).strip()
        if not currency_code or not currency_iso:
            raise ValueError("currency.json has missing currency_code or currency_iso")
        currencies.append(
            {
                "currency_code": currency_code,
                "currency_iso": currency_iso,
                "alias": alias,
                "currency_symbol": currency_symbol,
            }
        )
    return currencies


def build_iso_maps(currencies: List[Dict[str, str]]) -> Tuple[Dict[str, str], Dict[str, str]]:
    code_to_iso: Dict[str, str] = {}
    iso_to_code: Dict[str, str] = {}
    for item in currencies:
        code = item["currency_code"]
        iso = item["currency_iso"]
        if code in code_to_iso:
            raise ValueError(f"duplicate currency_code: {code}")
        if iso in iso_to_code:
            raise ValueError(f"duplicate currency_iso: {iso}")
        code_to_iso[code] = iso
        iso_to_code[iso] = code
    return code_to_iso, iso_to_code


def fetch_from_frankfurter(iso_codes: List[str], timeout: float = 10.0) -> Dict[str, Any]:
    if not iso_codes:
        raise ValueError("iso_codes is empty")
    base_iso = "USD" if "USD" in iso_codes else iso_codes[0]
    targets = [iso for iso in iso_codes if iso != base_iso]

    url = "https://api.frankfurter.app/latest"
    params: Dict[str, str] = {"from": base_iso}
    if targets:
        params["to"] = ",".join(sorted(targets))

    with httpx.Client(follow_redirects=True, timeout=timeout) as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    rates = data.get("rates", {})
    base_rates: Dict[str, float] = {base_iso: 1.0}
    for iso in targets:
        if iso not in rates:
            raise RuntimeError(f"missing rate for {iso}")
        base_rates[iso] = float(rates[iso])

    return {
        "date": data.get("date", ""),
        "source": "Frankfurter (ECB)",
        "base_iso": base_iso,
        "base_rates": base_rates,
    }


def build_fx_matrix(base_rates: Dict[str, float], iso_codes: List[str]) -> Dict[str, Dict[str, float]]:
    matrix: Dict[str, Dict[str, float]] = {}
    for base in iso_codes:
        if base not in base_rates:
            raise RuntimeError(f"missing base rate for {base}")
        denom = Decimal(str(base_rates[base]))
        if denom == 0:
            raise RuntimeError(f"invalid base rate for {base}")
        row: Dict[str, float] = {}
        for target in iso_codes:
            if target not in base_rates:
                raise RuntimeError(f"missing base rate for {target}")
            numerator = Decimal(str(base_rates[target]))
            row[target] = round_rate(numerator / denom)
        matrix[base] = row
    return matrix


def build_fx_payload(
    currencies: List[Dict[str, str]],
    fx_snapshot: Dict[str, Any],
) -> Dict[str, Any]:
    code_to_iso, _ = build_iso_maps(currencies)
    iso_codes = [code_to_iso[code] for code in code_to_iso]

    base_rates = fx_snapshot["base_rates"]
    matrix_by_iso = build_fx_matrix(base_rates, iso_codes)

    rates_by_code: Dict[str, Dict[str, float]] = {}
    for code, iso in code_to_iso.items():
        row: Dict[str, float] = {}
        for target_code, target_iso in code_to_iso.items():
            row[target_code] = matrix_by_iso[iso][target_iso]
        rates_by_code[code] = row

    return {
        "as_of": fx_snapshot.get("date", ""),
        "source": fx_snapshot.get("source", ""),
        "base_iso": fx_snapshot.get("base_iso", ""),
        "currencies": currencies,
        "rates": rates_by_code,
    }


def run() -> None:
    logger = setup_logger()
    currencies = load_currencies()
    code_to_iso, _ = build_iso_maps(currencies)
    iso_codes = [code_to_iso[code] for code in code_to_iso]

    fx_snapshot = fetch_from_frankfurter(iso_codes)
    payload = build_fx_payload(currencies, fx_snapshot)

    write_json(FX_RATE_PATH, payload)
    logger.info("fx_rate.json updated: %s currencies", len(currencies))


if __name__ == "__main__":
    run()
