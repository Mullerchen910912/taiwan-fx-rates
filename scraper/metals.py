"""Fetch international precious-metal spot prices and convert to TWD/gram.

Source: api.gold-api.com (no API key). Prices are USD per troy ounce for the
international spot market. We convert to an approximate NT$/gram using a
USD→TWD reference derived from the same run's scraped bank rates.

Important honesty note surfaced in the UI: this is the *international spot*
reference, NOT a bank's gold-passbook (黃金存摺) buy/sell board — those carry a
dealer spread and differ. We never present it as a tradeable bank quote.
"""
from __future__ import annotations

import time

import requests

from .fetch import USER_AGENT

# 1 troy ounce = 31.1034768 grams.
OZ_TO_GRAM = 31.1034768

API_URL = "https://api.gold-api.com/price/{symbol}"

# symbol → Chinese display name. Order = display order.
METALS = {
    "XAU": "黃金",
    "XAG": "白銀",
    "XPT": "白金",
    "XPD": "鈀金",
}


def twd_per_gram(usd_per_oz: float, usd_twd: float | None) -> float | None:
    """Convert a USD/oz spot price to approximate NT$/gram.

    Returns None when no USD→TWD reference is available.
    """
    if usd_twd is None:
        return None
    return usd_per_oz * usd_twd / OZ_TO_GRAM


def build_metal_record(symbol: str, payload: dict, usd_twd: float | None) -> dict:
    """Turn one gold-api.com response dict into our snapshot record."""
    usd_oz = float(payload["price"])
    per_gram = twd_per_gram(usd_oz, usd_twd)
    return {
        "symbol": symbol,
        "name": METALS.get(symbol, payload.get("name", symbol)),
        "usd_per_oz": round(usd_oz, 2),
        "twd_per_gram": round(per_gram, 1) if per_gram is not None else None,
        "updated_at": payload.get("updatedAt"),
    }


def fetch_metals(usd_twd: float | None, *, timeout: int = 20, pause: float = 0.8) -> dict:
    """Fetch all configured metals. One failure never drops the rest.

    Each symbol is retried once (the API occasionally reads slowly).
    Returns ``{"items": [...], "errors": {symbol: msg}}``.
    """
    items, errors = [], {}
    for i, symbol in enumerate(METALS):
        if i:
            time.sleep(pause)
        last_error = None
        for attempt in range(2):
            try:
                resp = requests.get(
                    API_URL.format(symbol=symbol),
                    headers={"User-Agent": USER_AGENT},
                    timeout=timeout,
                )
                resp.raise_for_status()
                items.append(build_metal_record(symbol, resp.json(), usd_twd))
                last_error = None
                break
            except (requests.RequestException, ValueError, KeyError) as err:
                last_error = f"{type(err).__name__}: {err}"
                if attempt == 0:
                    time.sleep(pause)
        if last_error:
            errors[symbol] = last_error
    return {"items": items, "errors": errors}
