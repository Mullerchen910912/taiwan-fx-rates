import pytest

from scraper.fees import parse_fee


def test_free():
    fee = parse_fee("免手續費")
    assert fee.parsed
    assert fee.sell.fee_for(100_000) == 0
    assert fee.buy.fee_for(100_000) == 0


def test_flat_per_transaction():
    fee = parse_fee("每筆NT$200")
    assert fee.sell.kind == "flat"
    assert fee.sell.fee_for(20_000) == 200
    assert fee.buy.fee_for(20_000) == 200


def test_flat_with_trailing_note_kept():
    fee = parse_fee("每筆NT$100 ATM免收")
    assert fee.sell.fee_for(20_000) == 100
    assert "ATM免收" in fee.notes

    fee = parse_fee("每筆NT$100,非本行每筆$200")
    assert fee.sell.fee_for(20_000) == 100
    assert "非本行" in fee.notes


def test_direction_split():
    fee = parse_fee("本行賣免收,買入每筆100")
    assert fee.sell.fee_for(20_000) == 0  # travel direction: bank sells cash
    assert fee.buy.fee_for(20_000) == 100


def test_purchase_only_free():
    fee = parse_fee("結購外幣現鈔免收")
    assert fee.sell.fee_for(20_000) == 0
    assert fee.buy.fee_for(20_000) is None


@pytest.mark.parametrize(
    "raw,pct,min_twd",
    [
        ("台幣總額0.5%,最低NT$100", 0.005, 100),
        ("總額0.7%,最低NT$100", 0.007, 100),
        ("總額1%,最低100", 0.01, 100),
        ("台幣總額之0.5%", 0.005, None),
        ("總額0.6%", 0.006, None),
        ("總額0.135%,最低NT$100（J卡8折優惠）", 0.00135, 100),
    ],
)
def test_percent_variants(raw, pct, min_twd):
    fee = parse_fee(raw)
    assert fee.sell.kind == "percent"
    assert fee.sell.pct == pytest.approx(pct)
    assert fee.sell.min_twd == min_twd


def test_percent_minimum_binds_small_amounts():
    fee = parse_fee("總額0.5%,最低NT$100")
    assert fee.sell.fee_for(10_000) == 100  # 0.5% = 50 → floor binds
    assert fee.sell.fee_for(100_000) == 500


def test_noncustomer_flat():
    fee = parse_fee("非本行每筆NT100")
    assert fee.sell.fee_for(20_000) == 100
    assert "非本行" in fee.notes


@pytest.mark.parametrize("raw", ["有賬戶免手續費", "最低NT$100"])
def test_ambiguous_stays_unknown_with_raw(raw):
    fee = parse_fee(raw)
    assert not fee.parsed
    assert fee.sell.fee_for(20_000) is None
    assert fee.raw == raw
