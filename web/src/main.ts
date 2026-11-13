/**
 * Dashboard UI. Two runtimes, one code base:
 *  - server mode: data from GET /api/dashboard, AI via POST /api/chat
 *  - embedded mode (hosted demo, built with EMBEDDED=true): the profit engine
 *    runs in the browser on the demo dataset, and the AI analyst runs through
 *    the artifact's `sample` capability with the same tools as the server.
 */
import type { Analysis, CampaignRow, ProductRow } from "../../src/engine/profit.ts";
import type { Insight } from "../../src/engine/insights.ts";
import type { SourceStatus } from "../../src/core/types.ts";
import { SYSTEM_PROMPT, TOOLS, runTool, type ToolContext } from "../../src/ai/tools.ts";

declare const EMBEDDED: boolean;

interface DashboardData {
  analysis: Analysis;
  insights: Insight[];
  sources: SourceStatus[];
  ctx?: ToolContext;
}

// ---------- formatting ----------
const fmtInt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number) => `CHF ${fmtInt.format(Math.round(n))}`;
const chfShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return fmtInt.format(Math.round(n));
};
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const fin = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const platformShort = (p: string) => (p === "google_ads" ? "GOOGLE" : p === "meta" ? "META" : p.toUpperCase());

// ---------- state ----------
let days = 30;
let data: DashboardData | undefined;
let actionFilter = "all";
let productSort: { key: keyof ProductRow; dir: 1 | -1 } = { key: "cm3", dir: 1 };
let aiMode: "sample" | "server" | "none" = "none";
let sampleFn: any = null;

try {
  const saved = Number(localStorage.getItem("apd-days"));
  if ([7, 30, 90].includes(saved)) days = saved;
} catch { /* storage unavailable */ }

// ---------- data loading ----------
async function loadData(d: number): Promise<DashboardData> {
  if (EMBEDDED) {
    const { generateDemoData, addDays, isoDay } = await import("../../src/connectors/demo-data.ts");
    const { analyze } = await import("../../src/engine/profit.ts");
    const { detectInsights } = await import("../../src/engine/insights.ts");
    const { DEFAULT_COSTS } = await import("../../src/core/types.ts");
    const to = addDays(isoDay(new Date()), -1);
    const world = (loadData as any).world ?? ((loadData as any).world = generateDemoData(to, 180));
    const sources: SourceStatus[] = [
      { id: "shopify", label: "Shopify", kind: "commerce", state: "demo", rows: world.orders.length },
      { id: "google_ads", label: "Google Ads", kind: "ads", state: "demo" },
      { id: "meta", label: "Meta Ads", kind: "ads", state: "demo" },
      { id: "ga4", label: "GA4", kind: "analytics", state: "demo" },
      { id: "merchant_center", label: "Merchant Center", kind: "feed", state: "planned" },
      { id: "tiktok", label: "TikTok Ads", kind: "ads", state: "planned" },
    ];
    const dataset = { currency: "CHF", ...world, sources, generatedAt: new Date().toISOString() };
    const analysis = analyze(dataset, { from: addDays(to, -(d - 1)), to }, DEFAULT_COSTS);
    const insights = detectInsights(analysis, dataset);
    return { analysis, insights, sources, ctx: { analysis, insights, dataset } };
  }
  const res = await fetch(`api/dashboard?days=${d}`);
  if (!res.ok) throw new Error(`Dashboard API returned ${res.status}`);
  const body = await res.json();
  aiMode = body.ai === "server" ? "server" : aiMode;
  return body;
}

// ---------- header ----------
function renderSources(sources: SourceStatus[]) {
  const label: Record<string, string> = { connected: "live", demo: "demo data", planned: "planned", error: "error" };
  $("sources").innerHTML = sources.map((s) =>
    `<span class="chip" data-state="${s.state}" title="${esc(s.detail ?? `${s.label}: ${label[s.state]}`)}"><i></i>${esc(s.label)}</span>`).join("");
  const live = sources.some((s) => s.state === "connected");
  $("banner").hidden = live;
}

// ---------- KPIs ----------
function delta(cur: number, prev: number | undefined, goodWhenUp = true) {
  if (prev === undefined || prev === 0) return `<span class="delta flat">no comparison</span>`;
  const ch = (cur - prev) / Math.abs(prev);
  const cls = Math.abs(ch) < 0.005 ? "flat" : (ch > 0) === goodWhenUp ? "up" : "down";
  return `<span class="delta ${cls}">${ch > 0 ? "+" : ""}${(ch * 100).toFixed(1)}%</span>`;
}

function renderKpis(a: Analysis) {
  const t = a.totals;
  const p = a.previous;
  const paid = a.channels.filter((c) => c.adSpend > 0);
  const poas = paid.reduce((s, c) => s + c.cm2, 0) / (paid.reduce((s, c) => s + c.adSpend, 0) || 1);
  const ret = t.units ? t.refundedUnits / t.units : 0;
  const retPrev = p && p.units ? p.refundedUnits / p.units : undefined;
  const tiles = [
    { label: "Net sales", value: chf(t.netSales), sub: `${fmtInt.format(Math.round(t.orders))} orders`, d: delta(t.netSales, p?.netSales) },
    { label: "Profit after ads (CM3)", value: chf(t.cm3), sub: `${pct(t.cm3 / (t.netSales || 1), 1)} of net sales`, d: delta(t.cm3, p?.cm3), hero: true },
    { label: "Ad spend", value: chf(t.adSpend), sub: `${pct(t.adSpend / (t.netSales || 1), 1)} of net sales`, d: delta(t.adSpend, p?.adSpend, false) },
    { label: "Paid POAS", value: `${poas.toFixed(2)}x`, sub: "contribution per CHF of ads", d: "" },
    { label: "Return rate (units)", value: pct(ret, 1), sub: `${chf(t.refunds)} refunded`, d: retPrev !== undefined ? delta(ret, retPrev, false) : "" },
  ];
  $("kpis").innerHTML = tiles.map((k) => `
    <div class="kpi${k.hero ? " hero" : ""}">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      <div class="sub">${k.d}<span>${k.sub}</span></div>
    </div>`).join("");
}

// ---------- tooltip helper ----------
function attachTip(container: HTMLElement) {
  let tip = container.querySelector<HTMLDivElement>(".tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; container.appendChild(tip); }
  return {
    show(x: number, y: number, html: string) {
      tip!.innerHTML = html;
      tip!.hidden = false;
      const w = container.clientWidth;
      const half = tip!.offsetWidth / 2;
      tip!.style.left = `${Math.min(Math.max(x, half), w - half)}px`;
      tip!.style.top = `${y}px`;
    },
    hide() { tip!.hidden = true; },
  };
}

// ---------- waterfall ----------
function renderWaterfall(a: Analysis) {
  const t = a.totals;
  const steps = [
    { label: "Gross sales", v: t.grossSales, kind: "total" },
    { label: "Refunds", v: -t.refunds },
    { label: "Cost of goods", v: -t.cogs },
    { label: "Shipping", v: -t.shipping },
    { label: "Pick & pack", v: -t.pickPack },
    { label: "Payment fees", v: -t.paymentFees },
    { label: "Return handling", v: -t.returnHandling },
    { label: "Ad spend", v: -t.adSpend },
    { label: "Profit", v: t.cm3, kind: "result" },
  ];
  const W = 760, H = 300, L = 8, R = 8, T = 24, B = 46;
  const max = t.grossSales * 1.04;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const n = steps.length;
  const slot = (W - L - R) / n;
  const bw = Math.min(56, slot * 0.62);
  let run = 0;
  const bars = steps.map((s, i) => {
    let top: number, bottom: number;
    if (s.kind === "total") { top = s.v; bottom = 0; run = s.v; }
    else if (s.kind === "result") { top = Math.max(s.v, 0); bottom = Math.min(s.v, 0); }
    else { top = run; bottom = run + s.v; run = bottom; }
    return { ...s, i, x: L + slot * i + (slot - bw) / 2, y1: y(top), y2: y(bottom) };
  });
  const grid = [0.25, 0.5, 0.75, 1].map((f) => max * f / 1.04).map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profit bridge from gross sales to profit after ads">
    ${grid}
    <line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    ${bars.slice(0, -1).map((b) => `<line x1="${b.x + bw}" x2="${bars[b.i + 1]!.x}" y1="${b.kind === "total" ? b.y1 : b.y2}" y2="${b.kind === "total" ? b.y1 : b.y2}" stroke="var(--line)" stroke-dasharray="3 3"/>`).join("")}
    ${bars.map((b) => {
      const h = Math.max(2, b.y2 - b.y1);
      const fill = b.kind === "total" ? "var(--series-1)" : b.kind === "result" ? (b.v >= 0 ? "var(--good)" : "var(--bad)") : "var(--bar-cost)";
      const valY = b.y1 - 6;
      return `<g data-i="${b.i}">
        <rect x="${b.x}" y="${b.y1}" width="${bw}" height="${h}" rx="3" fill="${fill}"/>
        <text x="${b.x + bw / 2}" y="${valY}" text-anchor="middle" class="${b.kind ? "lbl-strong" : ""}">${b.v < 0 ? "−" : ""}${chfShort(Math.abs(b.v))}</text>
        <text x="${b.x + bw / 2}" y="${H - B + 18}" text-anchor="middle">${b.label.split(" ")[0]}</text>
        ${b.label.includes(" ") ? `<text x="${b.x + bw / 2}" y="${H - B + 32}" text-anchor="middle">${b.label.split(" ").slice(1).join(" ")}</text>` : ""}
        <rect x="${L + slot * b.i}" y="${T - 20}" width="${slot}" height="${H - T}" fill="transparent" class="hit"/>
      </g>`;
    }).join("")}
  </svg>`;
  const el = $("waterfall");
  el.innerHTML = svg;
  const tip = attachTip(el);
  el.querySelectorAll<SVGGElement>("g[data-i]").forEach((g) => {
    const b = bars[Number(g.dataset.i)]!;
    g.addEventListener("pointerenter", () => {
      const scale = el.clientWidth / W;
      tip.show((b.x + bw / 2) * scale, b.y1 * scale, `${esc(b.label)}<br><span class="num">${chf(b.v)} · ${pct(Math.abs(b.v) / (t.netSales || 1), 1)} of net sales</span>`);
    });
    g.addEventListener("pointerleave", () => tip.hide());
  });
}

// ---------- daily line chart ----------
function renderDaily(a: Analysis) {
  const rows = a.daily;
  const W = 760, H = 240, L = 44, R = 70, T = 12, B = 26;
  const vals = rows.flatMap((r) => [r.cm3, r.adSpend]);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.08;
  const x = (i: number) => L + (W - L - R) * (rows.length > 1 ? i / (rows.length - 1) : 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4 || 1)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => (hi - lo) / s <= 5)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) ticks.push(v);
  const path = (k: "cm3" | "adSpend") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
  const labelEvery = Math.ceil(rows.length / 6);
  const last = rows[rows.length - 1]!;
  let lyA = y(last.cm3), lyB = y(last.adSpend);
  if (Math.abs(lyA - lyB) < 14) { const mid = (lyA + lyB) / 2; lyA = mid + (lyA >= lyB ? 7 : -7); lyB = mid + (lyB > lyA ? 7 : -7); }
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily profit after ads and ad spend">
    ${ticks.map((v) => `<line class="${v === 0 ? "zero" : "grid"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${chfShort(v)}</text>`).join("")}
    ${rows.map((r, i) => (i % labelEvery === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.date.slice(8, 10)}.${r.date.slice(5, 7)}.</text>` : "")).join("")}
    <path d="${path("adSpend")}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
    <path d="${path("cm3")}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(rows.length - 1)}" cy="${y(last.cm3)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>
    <circle cx="${x(rows.length - 1)}" cy="${y(last.adSpend)}" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"/>
    <text x="${W - R + 8}" y="${lyA + 4}" class="lbl-strong">${chfShort(last.cm3)}</text>
    <text x="${W - R + 8}" y="${lyB + 4}">${chfShort(last.adSpend)}</text>
    <line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" visibility="hidden"/>
    <circle id="xh-a" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <circle id="xh-b" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hit"/>
  </svg>`;
  const el = $("daily");
  el.innerHTML = svg;
  const tip = attachTip(el);
  const s = el.querySelector("svg")!;
  const xh = s.querySelector("#xh")!, ca = s.querySelector("#xh-a")!, cb = s.querySelector("#xh-b")!;
  const hit = s.querySelector("#hit")!;
  hit.addEventListener("pointermove", (ev) => {
    const e = ev as PointerEvent;
    const box = s.getBoundingClientRect();
    const scale = box.width / W;
    const vx = (e.clientX - box.left) / scale;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(((vx - L) / (W - L - R)) * (rows.length - 1))));
    const r = rows[i]!;
    for (const [elx, v] of [[ca, r.cm3], [cb, r.adSpend]] as const) { elx.setAttribute("cx", String(x(i))); elx.setAttribute("cy", String(y(v))); elx.setAttribute("visibility", "visible"); }
    xh.setAttribute("x1", String(x(i))); xh.setAttribute("x2", String(x(i))); xh.setAttribute("visibility", "visible");
    tip.show(x(i) * scale, Math.min(y(r.cm3), y(r.adSpend)) * scale,
      `${new Date(r.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}<br>
       <span class="num">Profit after ads ${chf(r.cm3)}<br>Ad spend ${chf(r.adSpend)}<br>Net sales ${chf(r.netSales)}</span>`);
  });
  hit.addEventListener("pointerleave", () => { tip.hide(); [xh, ca, cb].forEach((n) => n.setAttribute("visibility", "hidden")); });
}

// ---------- actions ----------
function renderActions(list: Insight[]) {
  const shown = list.filter((i) => actionFilter === "all" || i.kind === actionFilter);
  const total = list.filter((i) => i.kind !== "watch").reduce((s, i) => s + Math.max(0, i.impactMonthly), 0);
  $("act-sub").textContent = `${list.length} findings, about ${chf(total)} per month at stake. Found automatically, ranked by severity and impact.`;
  $("actions").innerHTML = shown.map((i) => `
    <article class="card" data-sev="${i.severity}">
      <div class="card-top">
        <div>
          <div class="tags"><span class="tag ${i.kind}">${i.kind}</span><span class="tag area">${i.area}</span><span class="tag area">${i.severity}</span></div>
          <h3 style="margin-top:6px">${esc(i.title)}</h3>
        </div>
        ${i.impactMonthly > 0 ? `<div class="impact"><b>${chf(i.impactMonthly)}</b><small>per month</small></div>` : ""}
      </div>
      <p>${esc(i.summary)}</p>
      <div class="rec"><b>Do this:</b> ${esc(i.recommendation)}</div>
      <div class="metrics">${Object.entries(i.metrics).map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("")}</div>
      <button type="button" class="ask" data-q="${esc(`Explain this finding and what exactly I should change: "${i.title}"`)}">Ask the analyst about this →</button>
    </article>`).join("") || `<p class="foot">Nothing in this category for the selected period.</p>`;
  $("actions").querySelectorAll<HTMLButtonElement>(".ask").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q!)));
}

// ---------- campaigns ----------
function verdict(c: CampaignRow) {
  if (c.poas >= 1.6 && c.lostIsBudget > 0.12) return `<span class="pill scale">SCALE</span>`;
  if (c.poas >= 1.05) return `<span class="pill keep">KEEP</span>`;
  if (c.poas >= 0.6) return `<span class="pill fix">FIX</span>`;
  return `<span class="pill cut">CUT</span>`;
}

function renderCampaigns(list: CampaignRow[]) {
  const maxPoas = Math.max(2, ...list.map((c) => c.poas));
  $("campaigns").innerHTML = `
    <thead><tr><th>Campaign</th><th>Spend</th><th>Platform ROAS</th><th>True ROAS</th><th>POAS</th><th>Profit after ads</th><th>CPC 7d</th><th>Lost IS budget</th><th>Verdict</th></tr></thead>
    <tbody>${list.map((c) => `
      <tr>
        <td><span class="plat">${platformShort(c.platform)}</span>${esc(c.name)}<span class="meta">${esc(c.type)} · ${chf(c.dailyBudget)}/day budget</span></td>
        <td>${chf(c.spend)}</td>
        <td>${c.platformRoas.toFixed(2)}x</td>
        <td>${c.trueRoas.toFixed(2)}x${c.overReporting > 0.25 ? `<span class="meta">platform +${pct(c.overReporting)}</span>` : ""}</td>
        <td class="${c.poas < 1 ? "neg" : "pos"}">${c.poas.toFixed(2)}x<span class="bar-cell" aria-hidden="true"><i style="width:${Math.min(100, (c.poas / maxPoas) * 100)}%;background:${c.poas < 1 ? "var(--bad)" : "var(--good)"}"></i></span></td>
        <td class="${c.profit < 0 ? "neg" : "pos"}">${chf(c.profit)}</td>
        <td class="${c.cpcTrend > 0.3 ? "neg" : ""}">${c.cpcTrend >= 0 ? "+" : ""}${pct(c.cpcTrend)}</td>
        <td>${c.lostIsBudget > 0.01 ? pct(c.lostIsBudget) : "–"}</td>
        <td>${verdict(c)}</td>
      </tr>`).join("")}</tbody>`;
}

// ---------- products ----------
const PRODUCT_COLS: { key: keyof ProductRow; label: string; fmt: (p: ProductRow) => string; cls?: (p: ProductRow) => string }[] = [
  { key: "netSales", label: "Net sales", fmt: (p) => chf(p.netSales) },
  { key: "cm2", label: "Margin before ads", fmt: (p) => chf(p.cm2), cls: (p) => (p.cm2 < 0 ? "neg" : "") },
  { key: "adSpend", label: "Ad spend", fmt: (p) => chf(p.adSpend) },
  { key: "cm3", label: "Profit (CM3)", fmt: (p) => chf(p.cm3), cls: (p) => (p.cm3 < 0 ? "neg" : "pos") },
  { key: "cm3Margin", label: "Margin", fmt: (p) => pct(p.cm3Margin, 1), cls: (p) => (p.cm3Margin < 0 ? "neg" : "") },
  { key: "returnRate", label: "Returns", fmt: (p) => pct(p.returnRate, 1), cls: (p) => (p.returnRate > 0.1 ? "neg" : "") },
  { key: "avgDiscountPct", label: "Discount", fmt: (p) => pct(p.avgDiscountPct), cls: (p) => (p.avgDiscountPct > 0.12 ? "neg" : "") },
  { key: "daysOfCover", label: "Stock days", fmt: (p) => (fin(p.daysOfCover) === null ? "–" : (p.daysOfCover as number).toFixed(p.daysOfCover < 10 ? 1 : 0)), cls: (p) => (fin(p.daysOfCover) !== null && p.daysOfCover < 10 ? "neg" : "") },
];

function renderProducts(list: ProductRow[]) {
  const { key, dir } = productSort;
  const val = (p: ProductRow) => { const v = p[key] as number; return fin(v) ?? 1e12; };
  const rows = [...list].sort((a, b) => (val(a) - val(b)) * dir);
  $("products").innerHTML = `
    <thead><tr><th>Product</th>${PRODUCT_COLS.map((c) => `<th><button type="button" data-k="${String(c.key)}" ${c.key === key ? `aria-sort="${dir === 1 ? "ascending" : "descending"}"` : ""}>${c.label}${c.key === key ? (dir === 1 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead>
    <tbody>${rows.map((p) => `<tr><td>${esc(p.title)}<span class="meta">${esc(p.brand)} · ${esc(p.category)} · ${fmtInt.format(p.units)} units</span></td>${PRODUCT_COLS.map((c) => `<td class="${c.cls?.(p) ?? ""}">${c.fmt(p)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("products").querySelectorAll<HTMLButtonElement>("th button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k as keyof ProductRow;
    productSort = { key: k, dir: productSort.key === k ? (productSort.dir === 1 ? -1 : 1) : -1 };
    renderProducts(list);
  }));
}

// ---------- chat ----------
const turns: { role: "user" | "assistant"; content: string }[] = [];
let busy = false;
let ctl: AbortController | undefined;

const SUGGESTIONS = [
  "Which products are the most profitable after deducting all costs?",
  "Where are we currently losing money?",
  "Which marketing budgets should we optimize, and by how much?",
  "Was sollten wir diese Woche als Erstes tun?",
];

function mdLite(text: string): string {
  const lines = esc(text).split(/\n/);
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(\S.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const m = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
    if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<p><b>${h[1]}</b></p>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? "</ul>" : "");
}

function addMsg(role: "user" | "ai", html: string) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  $("msgs").appendChild(div);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return div;
}

function renderSuggestions() {
  $("suggest").hidden = turns.length > 0;
  $("suggest").innerHTML = SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join("");
  $("suggest").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => ask(b.textContent!)));
}

function setAiState() {
  const el = $("ai-state");
  if (aiMode === "none") { el.textContent = "offline"; el.setAttribute("data-off", ""); }
  else { el.textContent = aiMode === "sample" ? "Claude" : "Claude · server"; el.removeAttribute("data-off"); }
}

async function ask(question: string) {
  if (busy) return;
  if (!data) return;
  question = question.trim();
  if (!question) return;
  if (aiMode === "none") {
    addMsg("user", esc(question));
    addMsg("ai", `<p>The AI analyst is not connected here. On the server, set <code>ANTHROPIC_API_KEY</code>. The findings below are computed without AI and are always available.</p>`);
    return;
  }
  busy = true;
  $<HTMLButtonElement>("send").textContent = "Stop";
  turns.push({ role: "user", content: question });
  renderSuggestions();
  addMsg("user", esc(question));
  const bubble = addMsg("ai", `<span class="thinking">Analysing…</span>`);
  const trace: string[] = [];
  const showTrace = () => (trace.length ? `<div class="trace">checked: ${[...new Set(trace)].join(", ")}</div>` : "");
  try {
    let text = "";
    if (aiMode === "sample") {
      ctl = new AbortController();
      const ctx = data.ctx!;
      const tools = TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
        execute: (input: Record<string, unknown>) => {
          trace.push(t.name);
          bubble.innerHTML = `<span class="thinking">Analysing… </span>${showTrace()}`;
          return runTool(ctx, t.name, input ?? {});
        },
      }));
      const period = `Selected period: last ${days} days (${data.analysis.range.from} to ${data.analysis.range.to}).`;
      const input = [{ role: "user" as const, content: `${SYSTEM_PROMPT}\n\n${period}\nUse the tools to answer. The conversation follows.` }, ...turns.slice(-10)];
      const res = await sampleFn(input, {
        tools,
        signal: ctl.signal,
        onText: ({ text: t }: { text: string }) => { bubble.innerHTML = mdLite(t) + showTrace(); $("msgs").scrollTop = $("msgs").scrollHeight; },
      });
      text = res.text;
    } else {
      const r = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, messages: turns.slice(-10) }) });
      const body = await r.json();
      if (!r.ok) throw { code: "server", message: body.error ?? `HTTP ${r.status}` };
      text = body.text;
      trace.push(...(body.toolCalls ?? []).map((t: { name: string }) => t.name));
    }
    turns.push({ role: "assistant", content: text });
    bubble.innerHTML = mdLite(text) + showTrace();
  } catch (e: any) {
    turns.pop();
    const copy: Record<string, string> = {
      cancelled: "Stopped.",
      not_granted: "Claude access was not allowed for this page, so the analyst is off. The findings below still work.",
      rate_limited: "Too many questions in a short time. Try again in a minute.",
      tools_unavailable: "This viewer cannot run the analyst's tools. Open the page in claude.ai in a browser.",
      sampling_disabled: "Claude is not available for this account.",
      refused: "Claude declined this question. Try rephrasing it.",
    };
    const msg = copy[e?.code] ?? (e?.message ? esc(String(e.message)) : "Something went wrong. Try again.");
    bubble.innerHTML = (e?.text ? mdLite(e.text) : "") + `<p class="thinking">${msg}</p>`;
    if (e?.code === "not_granted" || e?.code === "sampling_disabled" || e?.code === "tools_unavailable") { aiMode = "none"; setAiState(); }
  } finally {
    busy = false;
    ctl = undefined;
    $<HTMLButtonElement>("send").textContent = "Ask";
    renderSuggestions();
  }
}

function wireChat() {
  const q = $<HTMLTextAreaElement>("q");
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) { ctl?.abort(); return; }
    const v = q.value;
    q.value = "";
    ask(v);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").dispatchEvent(new Event("submit", { cancelable: true })); }
  });
  addMsg("ai", `<p>I watch sales, costs and ad spend across all connected sources. Ask me anything about profitability, or pick a question below.</p>`);
  renderSuggestions();
}

async function initAi() {
  if (!EMBEDDED) return setAiState();
  const claude = (window as any).claude;
  if (!claude?.use) return setAiState();
  try {
    const s = await claude.use("sample");
    if (s) {
      const lim = await s.limits().catch(() => null);
      if (!lim || lim.tools) { sampleFn = s; aiMode = "sample"; }
    }
  } catch { /* absent */ }
  setAiState();
}

// ---------- boot ----------
async function render() {
  try {
    data = await loadData(days);
  } catch (e) {
    $("kpis").innerHTML = `<div class="banner">Could not load data: ${esc(String((e as Error).message))}</div>`;
    return;
  }
  const a = data.analysis;
  renderSources(data.sources);
  renderKpis(a);
  renderWaterfall(a);
  renderDaily(a);
  renderActions(data.insights);
  renderCampaigns(a.campaigns);
  renderProducts(a.products);
  $("foot").textContent = `Period ${a.range.from} to ${a.range.to}. Cost assumptions: payment ${pct(a.costs.paymentFeePct, 1)} + CHF ${a.costs.paymentFeeFixed.toFixed(2)}, pick & pack CHF ${a.costs.pickPackPerOrder.toFixed(2)}/order, return handling CHF ${a.costs.returnHandlingPerUnit.toFixed(2)}/unit, ${pct(a.costs.returnResaleRate)} of returns resellable. Refunds are counted on the order date.`;
  setAiState();
}

function wireControls() {
  document.querySelectorAll<HTMLButtonElement>(".top .seg button").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days));
    b.addEventListener("click", () => {
      days = Number(b.dataset.days);
      try { localStorage.setItem("apd-days", String(days)); } catch { /* ignore */ }
      document.querySelectorAll<HTMLButtonElement>(".top .seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("#act-filter button").forEach((b) => b.addEventListener("click", () => {
    actionFilter = b.dataset.k!;
    document.querySelectorAll<HTMLButtonElement>("#act-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (data) renderActions(data.insights);
  }));
}

wireControls();
wireChat();
render();
initAi();
