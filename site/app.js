"use strict";

/* Sensible default amounts per currency (roughly a short-trip budget). */
const DEFAULT_AMOUNTS = {
  JPY: 100000, USD: 1000, KRW: 300000, EUR: 1000,
  THB: 10000, HKD: 5000, SGD: 1000, CNY: 5000,
};
const STALE_DAYS = 3; // quoted-rate older than this vs. snapshot date = stale

const state = {
  code: null,
  direction: "buy",   // "buy": you buy foreign currency (travel) | "sell": you sell it back
  channel: "cash",    // "cash" | "spot"
  showStale: false,
  amounts: { ...DEFAULT_AMOUNTS },
};
let DATA = null;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const fmtTWD = (n) => "NT$" + Math.round(n).toLocaleString("zh-TW");

/* data/ sits next to index.html on the published site; one level up when
   serving the repo root during local development. */
async function loadData() {
  for (const path of ["./data/latest.json", "../data/latest.json"]) {
    try {
      const resp = await fetch(path, { cache: "no-store" });
      if (resp.ok) return await resp.json();
    } catch (_) { /* try next */ }
  }
  throw new Error("latest.json not reachable");
}

function feeFor(rule, twdTotal) {
  if (!rule) return null;
  if (rule.kind === "flat") return rule.flat_twd;
  if (rule.kind === "percent") return Math.max(rule.pct * twdTotal, rule.min_twd || 0);
  return null; // unknown
}

function feeRuleLabel(rule) {
  if (!rule) return "";
  if (rule.kind === "flat") return rule.flat_twd === 0 ? "" : `每筆 NT$${rule.flat_twd}`;
  if (rule.kind === "percent") {
    const pct = `${+(rule.pct * 100).toFixed(4)}%`;
    return rule.min_twd ? `${pct},低消 NT$${rule.min_twd}` : pct;
  }
  return "";
}

function dayDiff(laterISO, earlierISO) {
  const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((day(laterISO) - day(earlierISO)) / 86400000);
}

function computeRows() {
  const { banks } = DATA.currencies[state.code];
  const amount = state.amounts[state.code] || 0;
  const buying = state.direction === "buy";
  const rateKey = buying
    ? (state.channel === "cash" ? "cash_sell" : "spot_sell")
    : (state.channel === "cash" ? "cash_buy" : "spot_buy");

  const rows = [];
  let noService = 0;
  for (const bank of banks) {
    const rate = bank[rateKey];
    if (rate == null) { noService += 1; continue; }
    const twd = amount * rate;
    let fee = 0, feeUnknown = false, feeRule = null;
    if (state.channel === "cash") {
      feeRule = buying ? bank.fee.sell : bank.fee.buy;
      fee = feeFor(feeRule, twd);
      if (fee == null) { fee = 0; feeUnknown = true; }
    }
    rows.push({
      bank,
      rate,
      fee,
      feeUnknown,
      feeRule,
      total: buying ? twd + fee : twd - fee,
      stale: bank.updated_at ? dayDiff(DATA.generated_at, bank.updated_at) > STALE_DAYS : false,
    });
  }
  rows.sort((a, b) => (buying ? a.total - b.total : b.total - a.total));
  return { rows, noService, amount, buying };
}

/* ---------- rendering ---------- */

function render() {
  const { rows, noService, amount, buying } = computeRows();
  const fresh = rows.filter((r) => !r.stale);
  const shown = state.showStale ? rows : fresh;
  const cur = DATA.currencies[state.code];

  $("#stale-count").textContent = rows.length - fresh.length;
  $("#table-title").textContent =
    `${cur.name} ${state.channel === "cash" ? "現鈔" : "即期"}${buying ? "賣出" : "買入"}排名`;
  $("#total-th").textContent = buying ? "總成本" : "實拿";
  $("#amount-unit").textContent = `(${state.code})`;
  $("#channel-hint").textContent = state.channel === "cash"
    ? "現鈔:臨櫃/機場分行直接領外幣現金,總成本已含各行牌告的現鈔手續費。"
    : "即期:需該行外幣帳戶(網銀換匯)。無現鈔手續費;多數銀行線上換匯另有讓分優惠,未計入。";

  renderBest(fresh, amount, buying);
  renderTable(shown, fresh, buying);

  const notes = [];
  if (!state.showStale && rows.length > fresh.length) {
    notes.push(`已排除 ${rows.length - fresh.length} 家超過 ${STALE_DAYS} 天未更新牌價的銀行(勾選右上角可顯示)。`);
  }
  if (noService) notes.push(`${noService} 家銀行無${state.channel === "cash" ? "現鈔" : "即期"}服務,未列出。`);
  if (shown.some((r) => r.feeUnknown)) notes.push("「?」= 手續費規則無法自動判讀,排名未計入該費用,請看原文備註。");
  $("#table-note").textContent = notes.join(" ");
}

function renderBest(fresh, amount, buying) {
  const card = $("#best-card");
  if (!fresh.length || !(amount > 0)) { card.hidden = true; return; }
  const best = fresh[0];
  const worst = fresh[fresh.length - 1];
  const gap = Math.abs(worst.total - best.total);
  card.hidden = false;
  card.innerHTML = `
    <div class="best-label">${buying ? "最省" : "換回最多"}</div>
    <div class="best-main">${esc(best.bank.bank)} — ${fmtTWD(best.total)}</div>
    <p class="best-sub">${state.code} ${amount.toLocaleString("zh-TW")}
      @ ${best.rate}${best.fee ? `,含手續費 ${fmtTWD(best.fee)}` : best.feeUnknown ? "(手續費未確認)" : ",免手續費"}
      ・跟最差的一家差 ${fmtTWD(gap)}</p>`;
}

function renderTable(shown, fresh, buying) {
  const body = $("#table-body");
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="6" class="status-msg">這個組合目前沒有可比較的銀行資料。</td></tr>`;
    return;
  }
  const bestTotal = fresh.length ? fresh[0].total : shown[0].total;
  const maxTotal = Math.max(...shown.map((r) => r.total));
  const genDay = DATA.generated_at.slice(0, 10);
  let rank = 0;

  body.innerHTML = shown.map((r) => {
    const isBest = fresh.length && r === fresh[0];
    if (!r.stale) rank += 1;
    const delta = r.total - bestTotal; // vs. the freshest best; signed
    const deltaGood = buying ? delta < 0 : delta > 0;
    const upDate = r.bank.updated_at ? r.bank.updated_at.slice(0, 10) : null;
    const upTime = r.bank.updated_at ? r.bank.updated_at.slice(11, 16) : "?";
    const feeMain = r.feeUnknown ? "?" : (r.fee === 0 ? "免費" : fmtTWD(r.fee));
    const feeSub = state.channel !== "cash" ? ""
      : r.feeUnknown ? r.bank.fee.raw : (feeRuleLabel(r.feeRule) || r.bank.fee.notes);
    return `
    <tr class="${isBest ? "best-row" : ""} ${r.stale ? "stale-row" : ""}">
      <td class="col-rank">${r.stale ? "⚠" : rank}</td>
      <td>
        ${r.bank.bank_url ? `<a class="bank-link" href="${esc(r.bank.bank_url)}" target="_blank" rel="noopener">${esc(r.bank.bank)}</a>` : esc(r.bank.bank)}
        ${r.stale ? `<span class="badge" title="牌價更新日 ${esc(upDate)}">舊 ${esc(upDate ? upDate.slice(5) : "?")}</span>` : ""}
        ${isBest ? `<span class="badge badge-accent">最划算</span>` : ""}
      </td>
      <td class="num">${r.rate}</td>
      <td class="num col-fee">${feeMain}${feeSub ? `<span class="fee-note" title="${esc(r.bank.fee.raw)}">${esc(feeSub)}</span>` : ""}</td>
      <td class="num total-cell">
        <span class="total-num">${fmtTWD(r.total)}</span>
        <span class="diff ${Math.abs(delta) < 0.5 ? "zero" : deltaGood ? "good" : ""}">${
          Math.abs(delta) < 0.5 ? (buying ? "最低" : "最高")
            : (delta > 0 ? "+" : "−") + Math.round(Math.abs(delta)).toLocaleString("zh-TW") + " 元"}</span>
        <div class="bar" style="width:${maxTotal ? Math.max(3, (r.total / maxTotal) * 100) : 0}%"></div>
      </td>
      <td class="updated ${r.stale ? "stale" : ""} col-updated">${upDate === genDay ? `今天 ${upTime}` : esc(upDate ?? "?")}</td>
    </tr>`;
  }).join("");
}

function renderFreshness() {
  const gen = new Date(DATA.generated_at);
  const hours = Math.max(0, Math.round((Date.now() - gen.getTime()) / 3600000));
  const ago = hours < 1 ? "1 小時內" : hours < 24 ? `${hours} 小時前` : `${Math.floor(hours / 24)} 天前`;
  const failed = Object.keys(DATA.errors || {});
  $("#freshness").innerHTML =
    `資料時間 ${esc(DATA.generated_at.replace("T", " ").slice(0, 16))}(<span class="${hours > 30 ? "old" : ""}">${ago}</span>)` +
    (failed.length ? ` · <span class="old">注意:${esc(failed.join("、"))} 本次抓取失敗,顯示的是舊資料</span>` : "");
}

/* ---------- controls ---------- */

function buildCurrencyChips() {
  const wrap = $("#currency-chips");
  wrap.innerHTML = Object.entries(DATA.currencies).map(([code, cur]) =>
    `<button role="tab" data-code="${code}" class="${code === state.code ? "active" : ""}">${esc(cur.name)}<span class="code">${code}</span></button>`
  ).join("");
  wrap.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
    state.code = btn.dataset.code;
    wrap.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    $("#amount").value = state.amounts[state.code] ?? "";
    render();
  }));
}

function bindSegmented(id, key) {
  const seg = $(id);
  seg.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
    state[key] = btn.dataset.value;
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    render();
  }));
}

async function init() {
  try {
    DATA = await loadData();
  } catch (err) {
    $("#freshness").textContent = "資料載入失敗——請透過網站或本機 HTTP server 開啟(不能直接開檔案)。";
    return;
  }
  state.code = Object.keys(DATA.currencies)[0];
  buildCurrencyChips();
  bindSegmented("#direction-seg", "direction");
  bindSegmented("#channel-seg", "channel");
  const amountInput = $("#amount");
  amountInput.value = state.amounts[state.code];
  amountInput.addEventListener("input", () => {
    state.amounts[state.code] = parseFloat(amountInput.value) || 0;
    render();
  });
  $("#show-stale").addEventListener("change", (e) => { state.showStale = e.target.checked; render(); });
  renderFreshness();
  render();
}

init();
