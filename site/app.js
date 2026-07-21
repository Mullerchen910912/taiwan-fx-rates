"use strict";

/* Sensible default amounts per currency (roughly a short-trip budget). */
const DEFAULT_AMOUNTS = {
  JPY: 100000, USD: 1000, KRW: 300000, EUR: 1000,
  THB: 10000, HKD: 5000, SGD: 1000, CNY: 5000,
};
const STALE_DAYS = 3; // quoted-rate older than this vs. snapshot date = stale
// When two rows' totals differ by less than this, a fee-unconfirmed ("?") bank
// is sorted behind a fee-confirmed one even if its (understated) total is
// nominally lower — its real cost could easily swing by this much.
const FEE_UNKNOWN_TIE_EPSILON_TWD = 150;

const state = {
  code: null,
  direction: "buy",   // "buy": you buy foreign currency (travel) | "sell": you sell it back
  channel: "cash",    // "cash" | "spot"
  showStale: false,
  amounts: { ...DEFAULT_AMOUNTS },
};
let DATA = null;
let PROMOS = null; // { as_of, note, banks: { <bank>: [ {channel, url, benefit, ...} ] } }

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const fmtTWD = (n) => "NT$" + Math.round(n).toLocaleString("zh-TW");

/* data/ sits next to index.html on the published site; one level up when
   serving the repo root during local development. */
async function loadJSON(name, bust = false) {
  // A cache-bust query param forces past GitHub Pages' CDN edge cache, so the
  // manual refresh button actually pulls the newest published snapshot.
  const q = bust ? `?t=${Date.now()}` : "";
  for (const path of [`./data/${name}`, `../data/${name}`]) {
    try {
      const resp = await fetch(path + q, { cache: "no-store" });
      if (resp.ok) return await resp.json();
    } catch (_) { /* try next */ }
  }
  return null;
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
  // Primary key: total cost. Secondary key: push fee-unconfirmed rows behind
  // fee-confirmed ones whenever the totals are within FEE_UNKNOWN_TIE_EPSILON_TWD
  // of each other, so an unverified "fee=0" guess can't outrank a real quote.
  rows.sort((a, b) => {
    const primary = buying ? a.total - b.total : b.total - a.total;
    if (Math.abs(primary) > FEE_UNKNOWN_TIE_EPSILON_TWD) return primary;
    return ((a.feeUnknown ? 1 : 0) - (b.feeUnknown ? 1 : 0)) || primary;
  });
  return { rows, noService, amount, buying };
}

/* Pick the bank to actually recommend: prefer the cheapest bank whose fee is
   confirmed (feeUnknown === false); only fall back to a fee-unconfirmed one
   if every fresh row is unconfirmed. `rows` must already be sorted by total
   (see computeRows) so the first match per bucket is the cheapest. */
function pickBestRow(rows, buying) {
  const confirmed = rows.filter((r) => !r.feeUnknown);
  const allUnknown = confirmed.length === 0;
  const best = allUnknown ? rows[0] : confirmed[0];
  const cheaperUnknownCount = allUnknown ? 0 : rows.filter((r) =>
    r.feeUnknown && (buying ? r.total < best.total : r.total > best.total)
  ).length;
  return { best, allUnknown, cheaperUnknownCount };
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
    ? "現鈔:臨櫃/機場分行直接領外幣現金,總成本已含各行牌告的現鈔手續費。部分分行現鈔需預約、且多數不收外幣硬幣,出發前建議先向分行確認或線上預約。"
    : "即期:需該行外幣帳戶(網銀換匯)。無現鈔手續費;多數銀行線上換匯另有讓分優惠,未計入。";

  const bestInfo = fresh.length ? pickBestRow(fresh, buying) : null;
  renderBest(fresh, amount, buying, bestInfo);
  renderTable(shown, buying, bestInfo, rows.length);

  const notes = [];
  if (!state.showStale && rows.length > fresh.length) {
    notes.push(`已排除 ${rows.length - fresh.length} 家超過 ${STALE_DAYS} 天未更新牌價的銀行(勾選右上角可顯示)。`);
    if (bestInfo) {
      const staleCheaperCount = rows.filter((r) =>
        r.stale && (buying ? r.total < bestInfo.best.total : r.total > bestInfo.best.total)
      ).length;
      if (staleCheaperCount > 0) {
        notes.push(`另有 ${staleCheaperCount} 家逾期未更新的銀行帳面${buying ? "更低" : "更高"}(勾選『顯示過舊資料』查看)。`);
      }
    }
  }
  if (noService) notes.push(`${noService} 家銀行無${state.channel === "cash" ? "現鈔" : "即期"}服務,未列出。`);
  if (shown.some((r) => r.feeUnknown)) notes.push("「?」= 手續費規則無法自動判讀,排名未計入該費用(總成本前的「≥」代表實際可能更高),請看原文備註。");
  $("#table-note").textContent = notes.join(" ");

  renderPromos();
}

// A promo entry applies to the current view only if both its currency list
// and its direction list (when present) include what's currently selected.
// Missing fields are treated as unrestricted (backward compatible).
function promoMatches(offer) {
  const curOk = !offer.currencies || offer.currencies.includes(state.code);
  const dirOk = !offer.directions || offer.directions.includes(state.direction);
  return curOk && dirOk;
}

function bankHasPromo(bank) {
  const offers = PROMOS && PROMOS.banks && PROMOS.banks[bank];
  return !!(offers && offers.some(promoMatches));
}

function renderPromos() {
  const card = $("#promos-card");
  if (!PROMOS || !PROMOS.banks || !Object.keys(PROMOS.banks).length) {
    card.hidden = true;
    return;
  }
  const filteredEntries = Object.entries(PROMOS.banks)
    .map(([bank, offers]) => [bank, offers.filter(promoMatches)])
    .filter(([, offers]) => offers.length);

  if (!filteredEntries.length) {
    // Nothing applies to this currency+direction. If the user is selling
    // (these promos are all buy-side), say so instead of the section just
    // vanishing with no explanation; otherwise (currency has no promo at
    // all) there's nothing useful to show, so hide the whole section.
    if (state.direction === "sell") {
      card.hidden = false;
      $("#promos-intro").textContent =
        "以下換匯優惠多適用於買外幣(結匯);賣出/結售請洽各行公告。";
      $("#promos-list").innerHTML = "";
      $("#promos-note").textContent = "";
    } else {
      card.hidden = true;
    }
    return;
  }

  card.hidden = false;
  $("#promos-intro").textContent =
    "上方排名是各行的官方牌告匯率。以下幾家另有更划算的換匯通路(線上結匯、外幣ATM、網銀即期)——這些優惠依通路/帳戶/時段而定、且會變動,所以列在這裡當參考,沒有折進上方排名。";
  $("#promos-list").innerHTML = filteredEntries.map(([bank, offers]) =>
    offers.map((o) => `
      <div class="promo">
        <div class="promo-head">
          <span class="promo-bank">${esc(bank)}</span>
          <span class="promo-channel">${esc(o.channel)}</span>
          ${o.requires_account ? `<span class="badge">需外幣帳戶</span>` : ""}
          ${o.expiry ? `<span class="promo-expiry">至 ${esc(o.expiry)}</span>` : ""}
        </div>
        <p class="promo-benefit">${esc(o.benefit)}</p>
        <a class="promo-link" href="${esc(o.url)}" target="_blank" rel="noopener">官方頁面 →</a>
      </div>`).join("")
  ).join("");
  $("#promos-note").textContent =
    `${PROMOS.note || ""} 資料整理於 ${PROMOS.as_of || "?"}。`;
}

function renderBest(fresh, amount, buying, bestInfo) {
  const card = $("#best-card");
  if (!fresh.length || !(amount > 0) || !bestInfo) { card.hidden = true; return; }
  const { best, allUnknown, cheaperUnknownCount } = bestInfo;
  const worst = fresh[fresh.length - 1];
  const gap = Math.abs(worst.total - best.total);
  card.hidden = false;
  const warnLine = allUnknown
    ? `<p class="best-warn">⚠ 這個組合下所有銀行的手續費規則都無法自動判讀,實際成本可能更高——以上是帳面最佳選項,請務必核對原文備註。</p>`
    : cheaperUnknownCount > 0
      ? `<p class="best-warn">另有 ${cheaperUnknownCount} 家帳面${buying ? "更低" : "更高"},但手續費未確認,實際可能沒有這麼划算。</p>`
      : "";
  card.innerHTML = `
    <div class="best-label">${buying ? "最省" : "換回最多"}</div>
    <div class="best-main">${esc(best.bank.bank)} — ${fmtTWD(best.total)}</div>
    <p class="best-sub">${state.code} ${amount.toLocaleString("zh-TW")}
      @ ${best.rate}${best.fee ? `,含手續費 ${fmtTWD(best.fee)}` : best.feeUnknown ? "(手續費未確認)" : ",免手續費"}
      ・跟最差的一家差 ${fmtTWD(gap)}</p>
    ${warnLine}`;
}

function renderTable(shown, buying, bestInfo, totalRowCount) {
  const body = $("#table-body");
  if (!shown.length) {
    // Distinguish "no data at all" from "there is data, but every row is
    // stale and hidden" — the two look identical from just an empty table.
    const msg = totalRowCount > 0
      ? `${totalRowCount} 家銀行牌價均超過 ${STALE_DAYS} 天未更新,已隱藏;勾選右上角『顯示過舊資料』可查看。`
      : "這個組合目前沒有可比較的銀行資料。";
    body.innerHTML = `<tr><td colspan="6" class="status-msg">${esc(msg)}</td></tr>`;
    return;
  }
  // The reference point for both the "最划算" badge and the delta column is
  // the recommended (fee-confirmed where possible) bank from bestInfo, not
  // simply whichever row happens to have the lowest raw total — otherwise a
  // fee-unconfirmed row could look like the winner again.
  const bestTotal = bestInfo ? bestInfo.best.total : shown[0].total;
  const maxTotal = Math.max(...shown.map((r) => r.total));
  const genDay = DATA.generated_at.slice(0, 10);
  let rank = 0;

  body.innerHTML = shown.map((r) => {
    const isBest = bestInfo && r === bestInfo.best;
    if (!r.stale) rank += 1;
    const delta = r.total - bestTotal; // vs. the recommended best; signed
    const deltaGood = buying ? delta < 0 : delta > 0;
    const upDate = r.bank.updated_at ? r.bank.updated_at.slice(0, 10) : null;
    const upTime = r.bank.updated_at ? r.bank.updated_at.slice(11, 16) : "?";
    const feeMain = r.feeUnknown
      ? `<span class="cost-unsure" title="手續費規則無法自動判讀,右側總成本未計入此費用,實際可能更高">?</span>`
      : (r.fee === 0 ? "免費" : fmtTWD(r.fee));
    const feeSub = state.channel !== "cash" ? ""
      : r.feeUnknown ? r.bank.fee.raw : (feeRuleLabel(r.feeRule) || r.bank.fee.notes);
    return `
    <tr class="${isBest ? "best-row" : ""} ${r.stale ? "stale-row" : ""}">
      <td class="col-rank">${r.stale ? "⚠" : rank}</td>
      <td>
        ${r.bank.bank_url ? `<a class="bank-link" href="${esc(r.bank.bank_url)}" target="_blank" rel="noopener">${esc(r.bank.bank)}</a>` : esc(r.bank.bank)}
        ${r.stale ? `<span class="badge" title="牌價更新日 ${esc(upDate)}">舊 ${esc(upDate ? upDate.slice(5) : "?")}</span>` : ""}
        ${isBest ? `<span class="badge badge-accent">最划算</span>` : ""}
        ${bankHasPromo(r.bank.bank) ? `<span class="badge badge-promo" title="此行另有換匯優惠,見下方情報">💡優惠</span>` : ""}
      </td>
      <td class="num" data-label="匯率">${r.rate}</td>
      <td class="num col-fee" data-label="手續費">${feeMain}${feeSub ? `<span class="fee-note" title="${esc(r.bank.fee.raw)}">${esc(feeSub)}</span>` : ""}</td>
      <td class="num total-cell">
        <span class="total-num ${r.feeUnknown ? "cost-unsure" : ""}" ${r.feeUnknown ? `title="手續費未確認,實際總成本可能更高"` : ""}>${r.feeUnknown ? "≥" : ""}${fmtTWD(r.total)}</span>
        <span class="diff ${Math.abs(delta) < 0.5 ? "zero" : deltaGood ? "good" : ""}">${
          Math.abs(delta) < 0.5 ? (buying ? "最低" : "最高")
            : (delta > 0 ? "+" : "−") + Math.round(Math.abs(delta)).toLocaleString("zh-TW") + " 元"}</span>
        <div class="bar" style="width:${maxTotal ? Math.max(3, (r.total / maxTotal) * 100) : 0}%"></div>
      </td>
      <td class="updated ${r.stale ? "stale" : ""} col-updated">${upDate === genDay ? `今天 ${upTime}` : esc(upDate ?? "?")}</td>
    </tr>`;
  }).join("");
}

// Precious-metals reference panel. Rendered once (independent of currency /
// direction). International spot price + an approximate NT$/gram conversion —
// explicitly NOT a bank gold-passbook (黃金存摺) quote.
function renderMetals() {
  const card = $("#metals-card");
  const metals = DATA.metals;
  if (!metals || !metals.items || !metals.items.length) { card.hidden = true; return; }
  card.hidden = false;
  $("#metals-grid").innerHTML = metals.items.map((m) => `
    <div class="metal">
      <div class="metal-name">${esc(m.name)}</div>
      <div class="metal-twd">${m.twd_per_gram != null ? "≈ NT$" + m.twd_per_gram.toLocaleString("zh-TW") : "—"}<span class="metal-unit"> /公克</span></div>
      <div class="metal-usd">$${m.usd_per_oz.toLocaleString("en-US")} / oz</div>
    </div>`).join("");
  const ref = metals.usd_twd_ref;
  $("#metals-note").innerHTML =
    `國際盤即時價,以 USD≈${ref ?? "?"} 換算約當台幣/公克(1 金衡盎司 = 31.1035 克)。` +
    `這是<strong>國際參考價,非銀行黃金存摺牌價</strong>——實際買賣有價差,黃金存摺請洽 ` +
    `<a href="https://rate.bot.com.tw/gold/passbook" target="_blank" rel="noopener">臺灣銀行黃金存摺 →</a>。` +
    `資料來源:<a href="${esc(metals.source?.url || "#")}" target="_blank" rel="noopener">${esc(metals.source?.name || "")}</a>`;
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

// Manual refresh: re-pull the newest PUBLISHED snapshot (cache-busted) and
// re-render. A static page can't scrape banks live (CORS + no server), so this
// fetches the latest auto-scraped data rather than triggering a new scrape.
async function refreshNow() {
  const btn = $("#refresh-btn");
  const flash = $("#refresh-flash");
  if (btn.disabled) return;
  const prevGenerated = DATA.generated_at;
  btn.disabled = true;
  btn.classList.add("loading");
  flash.textContent = "更新中…";
  flash.className = "refresh-flash";
  const fresh = await loadJSON("latest.json", true);
  if (fresh) {
    DATA = fresh;
    const promos = await loadJSON("promos.json", true);
    if (promos) PROMOS = promos;
    if (!DATA.currencies[state.code]) state.code = Object.keys(DATA.currencies)[0];
    buildCurrencyChips();
    $("#amount").value = state.amounts[state.code] ?? "";
    updateAmountFormatted();
    renderFreshness();
    renderMetals();
    render();
    const changed = DATA.generated_at !== prevGenerated;
    flash.textContent = changed
      ? `已更新到 ${DATA.generated_at.slice(11, 16)}`
      : "已是最新發布資料";
    flash.className = "refresh-flash show ok";
  } else {
    flash.textContent = "更新失敗,請稍後再試";
    flash.className = "refresh-flash show err";
  }
  btn.disabled = false;
  btn.classList.remove("loading");
  setTimeout(() => { flash.className = flash.className.replace(" show", ""); }, 4000);
}

/* ---------- controls ---------- */

// Small live "= 100,000" readout next to the amount input so large numbers
// (esp. JPY/KRW) are easy to eyeball at a glance — kept as a separate span
// rather than reformatting the input itself, so the cursor never jumps.
function updateAmountFormatted() {
  const val = state.amounts[state.code] || 0;
  $("#amount-formatted").textContent = val ? `= ${val.toLocaleString("zh-TW")}` : "";
}

function buildCurrencyChips() {
  const wrap = $("#currency-chips");
  wrap.innerHTML = Object.entries(DATA.currencies).map(([code, cur]) =>
    `<button role="tab" data-code="${code}" class="${code === state.code ? "active" : ""}">${esc(cur.name)}<span class="code">${code}</span></button>`
  ).join("");
  wrap.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
    state.code = btn.dataset.code;
    wrap.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    $("#amount").value = state.amounts[state.code] ?? "";
    updateAmountFormatted();
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
  // Cache-bust so a returning visitor (or CDN edge) never renders a stale
  // snapshot — the data changes every couple of hours.
  DATA = await loadJSON("latest.json", true);
  if (!DATA) {
    $("#freshness").textContent = "資料載入失敗——請透過網站或本機 HTTP server 開啟(不能直接開檔案)。";
    return;
  }
  PROMOS = await loadJSON("promos.json", true); // optional; site works without it
  state.code = Object.keys(DATA.currencies)[0];
  buildCurrencyChips();
  bindSegmented("#direction-seg", "direction");
  bindSegmented("#channel-seg", "channel");
  const amountInput = $("#amount");
  amountInput.value = state.amounts[state.code];
  updateAmountFormatted();
  amountInput.addEventListener("input", () => {
    state.amounts[state.code] = parseFloat(amountInput.value) || 0;
    updateAmountFormatted();
    render();
  });
  $("#show-stale").addEventListener("change", (e) => { state.showStale = e.target.checked; render(); });
  $("#refresh-btn").addEventListener("click", refreshNow);
  renderFreshness();
  renderMetals();
  render();
}

init();
