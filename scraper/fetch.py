"""Polite HTTP fetching for findrate.tw currency pages."""
from __future__ import annotations

import time

import requests

BASE_URL = "https://www.findrate.tw/{code}/"
USER_AGENT = (
    "taiwan-fx-rates/1.0 (personal exchange-rate comparison tool; "
    "+https://github.com/Mullerchen910912/taiwan-fx-rates)"
)


def fetch_currency_page(code: str, *, timeout: int = 20, retries: int = 1, pause: float = 2.0) -> str:
    """Fetch the findrate.tw page for one currency code (e.g. "JPY").

    Retries once on network errors, then re-raises. Pages are UTF-8.
    """
    url = BASE_URL.format(code=code)
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            return resp.text
        except requests.RequestException as err:
            last_error = err
            if attempt < retries:
                time.sleep(pause)
    assert last_error is not None
    raise last_error
