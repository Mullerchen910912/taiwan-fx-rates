import pytest

from scraper.metals import OZ_TO_GRAM, build_metal_record, twd_per_gram


def test_twd_per_gram_conversion():
    # Gold at 4000 USD/oz, USD=32 TWD → 4000*32/31.1035 ≈ 4115.5 TWD/gram
    assert twd_per_gram(4000.0, 32.0) == pytest.approx(4000 * 32 / OZ_TO_GRAM)
    assert round(twd_per_gram(4000.0, 32.0), 1) == 4115.3


def test_twd_per_gram_without_reference_is_none():
    assert twd_per_gram(4000.0, None) is None


def test_build_record_shapes_payload():
    payload = {"price": 4038.5, "name": "Gold", "updatedAt": "2026-07-21T02:45:02Z"}
    rec = build_metal_record("XAU", payload, 32.0)
    assert rec["symbol"] == "XAU"
    assert rec["name"] == "黃金"  # Chinese display name, not the API's "Gold"
    assert rec["usd_per_oz"] == 4038.5
    assert rec["twd_per_gram"] == round(4038.5 * 32 / OZ_TO_GRAM, 1)
    assert rec["updated_at"] == "2026-07-21T02:45:02Z"


def test_build_record_handles_no_usd_reference():
    rec = build_metal_record("XAG", {"price": 57.77}, None)
    assert rec["twd_per_gram"] is None
    assert rec["usd_per_oz"] == 57.77
    assert rec["name"] == "白銀"
