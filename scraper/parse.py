"""Parse a findrate.tw currency page into structured per-bank records.

Layout facts this parser relies on (verified 2026-07-19):
- The main table is the one whose header contains 現鈔買入.
- Each data row: bank link / cash buy / cash sell / spot buy / spot sell /
  update time / cash handling fee.
- The visible update time is only HH:MM; the real date is hidden in an HTML
  comment right before it (``<!--2026-06-15-->15:56``). Some banks are weeks
  stale, so extracting that date is essential.
- Rates for services a bank does not offer are shown as ``--``.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup, Comment, Tag

SITE_ROOT = "https://www.findrate.tw"

_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
_TIME_RE = re.compile(r"(\d{1,2}):(\d{2})")
_NUMBER_RE = re.compile(r"^\d+(?:\.\d+)?$")


class ParseError(RuntimeError):
    """Raised when the page no longer matches the expected structure."""


def parse_currency_page(html: str) -> list[dict]:
    """Return one record per bank row of the main rate table.

    Each record: ``{bank, bank_url, cash_buy, cash_sell, spot_buy, spot_sell,
    updated_at, fee_raw}`` where rates are floats or None and ``updated_at``
    is an ISO-8601 string with +08:00 offset, or None if the hidden date
    comment is missing.
    """
    soup = BeautifulSoup(html, "html.parser")
    table = _find_main_table(soup)
    if table is None:
        raise ParseError("main rate table (header 現鈔買入) not found — page layout changed?")

    records = []
    for row in table.find_all("tr"):
        bank_cell = row.find("td", class_="bank")
        if bank_cell is None:  # header row
            continue
        cells = row.find_all("td")
        if len(cells) < 7:
            raise ParseError(f"expected 7 cells per row, got {len(cells)}")
        link = bank_cell.find("a")
        records.append(
            {
                "bank": (link or bank_cell).get_text(strip=True),
                "bank_url": SITE_ROOT + link["href"] if link and link.has_attr("href") else None,
                "cash_buy": _rate(cells[1]),
                "cash_sell": _rate(cells[2]),
                "spot_buy": _rate(cells[3]),
                "spot_sell": _rate(cells[4]),
                "updated_at": _updated_at(cells[5]),
                "fee_raw": " ".join(cells[6].get_text().split()),
            }
        )
    if not records:
        raise ParseError("main table matched but contained no bank rows")
    return records


def _find_main_table(soup: BeautifulSoup) -> Tag | None:
    for table in soup.find_all("table"):
        header = table.find("tr")
        if header and "現鈔買入" in header.get_text():
            return table
    return None


def _rate(cell: Tag) -> float | None:
    text = cell.get_text(strip=True)
    return float(text) if _NUMBER_RE.match(text) else None


def _updated_at(cell: Tag) -> str | None:
    comment = cell.find(string=lambda s: isinstance(s, Comment))
    date_match = _DATE_RE.search(str(comment)) if comment else None
    time_match = _TIME_RE.search(cell.get_text())
    if not date_match:
        return None
    hour, minute = (int(g) for g in time_match.groups()) if time_match else (0, 0)
    return f"{date_match.group(1)}T{hour:02d}:{minute:02d}:00+08:00"
