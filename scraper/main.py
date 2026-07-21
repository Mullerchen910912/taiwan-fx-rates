"""Fetch all configured currencies and write data/latest.json (+ daily history).

Run from the repo root:  python -m scraper.main
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .fees import parse_fee
from .fetch import fetch_currency_page
from .metals import fetch_metals
from .parse import parse_currency_page

TAIPEI = ZoneInfo("Asia/Taipei")
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# Currency pages to scrape (findrate.tw supports 24; keep this list short to
# stay polite). Order = display order in the UI.
CURRENCIES = {
    "JPY": "日圓",
    "USD": "美元",
    "KRW": "韓元",
    "EUR": "歐元",
    "THB": "泰銖",
    "HKD": "港幣",
    "SGD": "新加坡幣",
    "CNY": "人民幣",
}

PAUSE_BETWEEN_REQUESTS = 1.5  # seconds


def usd_twd_reference(currencies: dict) -> float | None:
    """A representative USD→TWD rate for converting metal prices.

    Median of fresh-enough banks' USD spot mid-price; falls back to cash mid
    if no spot quotes exist. Returns None if USD wasn't scraped at all.
    """
    usd = currencies.get("USD")
    if not usd:
        return None
    for buy_key, sell_key in (("spot_buy", "spot_sell"), ("cash_buy", "cash_sell")):
        mids = [
            (b[buy_key] + b[sell_key]) / 2
            for b in usd["banks"]
            if b.get(buy_key) is not None and b.get(sell_key) is not None
        ]
        if mids:
            mids.sort()
            n = len(mids)
            return mids[n // 2] if n % 2 else (mids[n // 2 - 1] + mids[n // 2]) / 2
    return None


def build_snapshot() -> dict:
    currencies: dict = {}
    errors: dict = {}
    for i, (code, name) in enumerate(CURRENCIES.items()):
        if i:
            time.sleep(PAUSE_BETWEEN_REQUESTS)
        try:
            html = fetch_currency_page(code)
            banks = parse_currency_page(html)
            for record in banks:
                record["fee"] = parse_fee(record.pop("fee_raw")).to_dict()
            currencies[code] = {"name": name, "banks": banks}
            print(f"[ok] {code}: {len(banks)} banks")
        except Exception as err:  # one broken currency must not kill the rest
            errors[code] = f"{type(err).__name__}: {err}"
            print(f"[warn] {code} failed: {errors[code]}", file=sys.stderr)

    usd_twd = usd_twd_reference(currencies)
    metals: dict = {}
    try:
        result = fetch_metals(usd_twd)
        metals = {
            "usd_twd_ref": round(usd_twd, 3) if usd_twd else None,
            "source": {"name": "gold-api.com（國際盤即時價）", "url": "https://www.gold-api.com/"},
            "items": result["items"],
        }
        if result["errors"]:
            errors["metals"] = result["errors"]
        print(f"[ok] metals: {len(result['items'])} items (USD≈{usd_twd})")
    except Exception as err:  # metals must never break the currency snapshot
        errors["metals"] = f"{type(err).__name__}: {err}"
        print(f"[warn] metals failed: {errors['metals']}", file=sys.stderr)

    return {
        "generated_at": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        "source": {"name": "比率網 findrate.tw", "url": "https://www.findrate.tw/"},
        "currencies": currencies,
        "metals": metals,
        "errors": errors,
    }


def main() -> int:
    snapshot = build_snapshot()
    if not snapshot["currencies"]:
        print("[error] every currency failed; keeping previous latest.json", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(exist_ok=True)
    history_dir = DATA_DIR / "history"
    history_dir.mkdir(exist_ok=True)

    payload = json.dumps(snapshot, ensure_ascii=False, indent=1)
    (DATA_DIR / "latest.json").write_text(payload, encoding="utf-8")
    day = snapshot["generated_at"][:10]
    (history_dir / f"{day}.json").write_text(payload, encoding="utf-8")

    print(f"[done] {len(snapshot['currencies'])}/{len(CURRENCIES)} currencies → data/latest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
