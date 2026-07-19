from pathlib import Path

import pytest

from scraper.parse import ParseError, parse_currency_page

FIXTURE = Path(__file__).parent / "fixtures" / "findrate_jpy.html"


@pytest.fixture(scope="module")
def records():
    return parse_currency_page(FIXTURE.read_text(encoding="utf-8"))


def test_row_count(records):
    assert len(records) == 35


def test_every_row_has_bank_and_url(records):
    for r in records:
        assert r["bank"]
        assert r["bank_url"].startswith("https://www.findrate.tw/bank/")


def test_bank_of_taiwan_row(records):
    bot = next(r for r in records if r["bank"] == "臺灣銀行")
    assert bot["cash_buy"] == 0.1877
    assert bot["cash_sell"] == 0.2005
    assert bot["spot_buy"] == 0.1945
    assert bot["spot_sell"] == 0.1995
    # The visible cell shows only 17:00 — the date lives in a hidden HTML
    # comment, and for 臺灣銀行 it is weeks stale. This is the whole point.
    assert bot["updated_at"] == "2026-06-29T17:00:00+08:00"
    assert bot["fee_raw"] == "免手續費"


def test_missing_cash_service_is_none(records):
    huanan = next(r for r in records if r["bank"] == "華南銀行")
    assert huanan["cash_buy"] is None
    assert huanan["cash_sell"] is None
    assert huanan["spot_buy"] is not None


def test_hidden_date_comment_extracted_for_all_rows(records):
    dates = {r["updated_at"][:10] for r in records if r["updated_at"]}
    # Fixture captured 2026-07-19 contains a spread of stale dates.
    assert dates == {"2026-06-15", "2026-06-29", "2026-07-04", "2026-07-19"}
    assert all(r["updated_at"] for r in records)


def test_layout_change_raises():
    with pytest.raises(ParseError):
        parse_currency_page("<html><body><p>redesigned!</p></body></html>")
