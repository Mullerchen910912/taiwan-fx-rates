"""Turn free-text cash-handling-fee notes into computable rules.

The fee column on findrate.tw is human-written Chinese. The observed corpus
(35 banks, 2026-07-19) reduces to three computable shapes:

- flat:    每筆NT$100 → NT$100 per transaction
- percent: 總額0.7%,最低NT$100 → 0.7% of the TWD total, floor NT$100
- free:    免手續費 → 0

Direction matters: 賣 means the bank sells foreign cash to you (the travel
direction), 買 means the bank buys it back. Anything we cannot parse keeps
``kind="unknown"`` and the verbatim text, so the UI shows the original note
instead of silently assuming a number. Where a note gives customer and
non-customer prices, the first (customer) price is used and the rest goes to
notes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class FeeRule:
    kind: str = "unknown"  # "flat" | "percent" | "unknown"
    flat_twd: float | None = None
    pct: float | None = None  # fraction of the TWD total, e.g. 0.007
    min_twd: float | None = None

    def to_dict(self) -> dict:
        return {"kind": self.kind, "flat_twd": self.flat_twd, "pct": self.pct, "min_twd": self.min_twd}

    def fee_for(self, twd_total: float) -> float | None:
        """Fee in TWD for a transaction of ``twd_total`` TWD, or None if unknown."""
        if self.kind == "flat":
            return self.flat_twd
        if self.kind == "percent":
            assert self.pct is not None
            return max(self.pct * twd_total, self.min_twd or 0.0)
        return None


FREE = FeeRule(kind="flat", flat_twd=0.0)
UNKNOWN = FeeRule()


@dataclass
class Fee:
    sell: FeeRule  # bank sells foreign cash to customer (you are buying)
    buy: FeeRule  # bank buys foreign cash from customer
    raw: str
    notes: str = ""

    @property
    def parsed(self) -> bool:
        return self.sell.kind != "unknown" or self.buy.kind != "unknown"

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "notes": self.notes,
            "parsed": self.parsed,
            "sell": self.sell.to_dict(),
            "buy": self.buy.to_dict(),
        }


def _normalize(text: str) -> str:
    text = text.strip()
    for src, dst in (("，", ","), ("（", "("), ("）", ")"), ("NT$", ""), ("NT", ""), ("$", ""), (" ", " ")):
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text)


_FLAT_RE = re.compile(r"^每筆(\d+(?:\.\d+)?)(.*)$")
_PERCENT_RE = re.compile(r"^(?:台幣)?總額(?:之)?(\d+(?:\.\d+)?)%(?:\s*,?\s*最低(\d+(?:\.\d+)?))?(.*)$")
_SELL_FREE_BUY_FLAT_RE = re.compile(r"^本行賣免收\s*,\s*買入每筆(\d+(?:\.\d+)?)$")
_NONCUSTOMER_FLAT_RE = re.compile(r"^非本行每筆(\d+(?:\.\d+)?)$")


def parse_fee(raw: str) -> Fee:
    """Parse one fee note. Falls back to kind="unknown" with the raw text."""
    text = _normalize(raw)

    if re.fullmatch(r"免手續費|免收|免收手續費", text):
        return Fee(sell=FREE, buy=FREE, raw=raw)

    # 結購 = customer purchasing foreign cash, i.e. the bank-sell direction.
    if text == "結購外幣現鈔免收":
        return Fee(sell=FREE, buy=UNKNOWN, raw=raw, notes="僅結購(買外幣)方向明示免收")

    if m := _SELL_FREE_BUY_FLAT_RE.match(text):
        return Fee(sell=FREE, buy=FeeRule("flat", flat_twd=float(m.group(1))), raw=raw)

    if m := _FLAT_RE.match(text):
        rule = FeeRule("flat", flat_twd=float(m.group(1)))
        return Fee(sell=rule, buy=rule, raw=raw, notes=m.group(2).strip(" ,"))

    if m := _PERCENT_RE.match(text):
        rule = FeeRule(
            "percent",
            pct=float(m.group(1)) / 100.0,
            min_twd=float(m.group(2)) if m.group(2) else None,
        )
        return Fee(sell=rule, buy=rule, raw=raw, notes=m.group(3).strip(" ,()"))

    # Only a non-customer price is given; a general traveller may not hold an
    # account there, so use it as the headline fee.
    if m := _NONCUSTOMER_FLAT_RE.match(text):
        rule = FeeRule("flat", flat_twd=float(m.group(1)))
        return Fee(sell=rule, buy=rule, raw=raw, notes="非本行客戶費率;本行客戶請洽銀行")

    # Conditional-free (需有該行帳戶) and anything else: keep verbatim.
    return Fee(sell=UNKNOWN, buy=UNKNOWN, raw=raw)
