/**
 * Dashboard UI. Two runtimes, one code base:
 *  - server mode (local server, Vercel): data from GET /api/dashboard, AI via POST /api/chat
 *  - embedded mode (hosted demo, built with EMBEDDED=true): the profit engine runs in
 *    the browser on the demo dataset; the AI analyst runs through the artifact's
 *    `sample` capability with the same tools as the server.
 * No framework: small render functions per section, CSS does the motion.
 */
import type { Analysis, CampaignRow, ProductRow } from "../../src/engine/profit.ts";
import type { Insight } from "../../src/engine/insights.ts";
import type { Dataset, SourceStatus } from "../../src/core/types.ts";
import { SYSTEM_PROMPT, TOOLS, runTool, type ToolContext } from "../../src/ai/tools.ts";
import { answerOffline } from "../../src/ai/offline.ts";
import { initHelp, termButton } from "./help.ts";
import { mountGear3D } from "./gear3d.ts";

declare const EMBEDDED: boolean;

interface DashboardData {
  analysis: Analysis;
  insights: Insight[];
  sources: SourceStatus[];
  ctx: ToolContext;
}

// ---------- utils ----------
const fmtInt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number) => `CHF ${fmtInt.format(Math.round(n))}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${chf(Math.abs(n))}`;
const chfShort = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(0)}k`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${fmtInt.format(Math.round(a))}`;
};
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const fin = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const platformShort = (p: string) => (p === "google_ads" ? "GOOGLE" : p === "meta" ? "META" : p.toUpperCase());
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/** Animated number: tweens from the last shown value of `key` to `to`. */
const shown = new Map<string, number>();
function countTo(el: Element | null, key: string, to: number, format: (n: number) => string, ms = 900) {
  if (!el) return;
  const from = shown.get(key) ?? (reduced() ? to : to * 0.6);
  shown.set(key, to);
  if (reduced() || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- state ----------
let days = Number(store.get("apd-days")) || 30;
if (![7, 30, 90].includes(days)) days = 30;
let data: DashboardData | undefined;
let actionFilter = "all";
const expanded = new Set<string>();
const done = new Set<string>(JSON.parse(store.get("apd-done") ?? "[]") as string[]);
let productSort: { key: keyof ProductRow; dir: 1 | -1 } = { key: "cm3", dir: 1 };
let productQuery = "";
let productCat = "All";
const openProducts = new Set<string>();
const seriesOn: Record<string, boolean> = { cm3: true, adSpend: true };
const simBudget = new Map<string, number>();
let aiMode: "sample" | "server" | "offline" = "offline";
let sampleFn: any = null;

// ---------- data ----------
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
    const dataset: Dataset = { currency: "CHF", ...world, sources, generatedAt: new Date().toISOString() };
    const analysis = analyze(dataset, { from: addDays(to, -(d - 1)), to }, DEFAULT_COSTS);
    const insights = detectInsights(analysis, dataset);
    return { analysis, insights, sources, ctx: { analysis, insights, dataset } };
  }
  const res = await fetch(`api/dashboard?days=${d}`);
  if (!res.ok) throw new Error(`Dashboard API returned ${res.status}`);
  const body = await res.json();
  aiMode = body.ai === "server" ? "server" : "offline";
  // Infinity travels as null over JSON
  for (const p of body.analysis.products) if (p.daysOfCover === null) p.daysOfCover = Infinity;
  // Simulator and rules-mode answers only need the analysis, not raw rows.
  return { ...body, ctx: { analysis: body.analysis, insights: body.insights, dataset: { sources: body.sources } as Dataset } };
}

// ---------- segmented controls ----------
function placeThumb(seg: HTMLElement) {
  const on = seg.querySelector<HTMLElement>('button[aria-pressed="true"]');
  const thumb = seg.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.left = `${on.offsetLeft}px`;
  thumb.style.width = `${on.offsetWidth}px`;
}

// ---------- tooltip ----------
function attachTip(container: HTMLElement) {
  let tip = container.querySelector<HTMLDivElement>(".tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; container.appendChild(tip); }
  return {
    show(x: number, y: number, html: string) {
      tip!.innerHTML = html;
      tip!.hidden = false;
      const half = tip!.offsetWidth / 2;
      tip!.style.left = `${Math.min(Math.max(x, half), container.clientWidth - half)}px`;
      tip!.style.top = `${y}px`;
    },
    hide() { tip!.hidden = true; },
  };
}

// ---------- hero ----------
function renderHero(a: Analysis, sources: SourceStatus[]) {
  const t = a.totals;
  $("hero-label").textContent = `Profit after ads · last ${days} days`;
  const numEl = $("hero-num").querySelector("span")!;
  countTo(numEl, "hero", t.cm3, (n) => fmtInt.format(Math.round(n)), 1100);
  const p = a.previous;
  const d = p && p.cm3 ? (t.cm3 - p.cm3) / Math.abs(p.cm3) : null;
  $("hero-meta").innerHTML = `
    ${d === null ? "" : `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)}% vs previous ${days}d</span>`}
    <span><b class="num">${pct(t.cm3 / (t.netSales || 1), 1)}</b> margin on <b class="num">${chf(t.netSales)}</b> net sales</span>
    <span><b class="num">${fmtInt.format(Math.round(t.orders))}</b> orders</span>`;
  const label: Record<string, string> = { connected: "live", demo: "demo data", planned: "planned", error: "error" };
  $("sources").innerHTML = sources.map((s) => `<span class="chip" data-state="${s.state}" title="${esc(s.detail ?? `${s.label}: ${label[s.state]}`)}"><i></i>${esc(s.label)}</span>`).join("");
  $("banner").hidden = sources.some((s) => s.state === "connected");
  renderHeroSpark(a);
}

function renderHeroSpark(a: Analysis) {
  const rows = a.daily;
  const el = $("hero-spark");
  const W = 600, H = 110;
  const vals = rows.map((r) => r.cm3);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.1 || 1;
  const x = (i: number) => (rows.length > 1 ? (i / (rows.length - 1)) * W : W / 2);
  const y = (v: number) => 8 + (H - 8) * (1 - (v - lo) / (hi - lo));
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.cm3).toFixed(1)}`).join("");
  el.innerHTML = `<svg class="wipe" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily profit after ads">
    <defs><linearGradient id="hg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${W},${H}L0,${H}Z" fill="url(#hg)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>`;
}

// ---------- focus ----------
const sevColor: Record<string, string> = { critical: "var(--bad)", high: "var(--warn)", medium: "var(--info)", low: "var(--muted)" };

function renderFocus(list: Insight[]) {
  const top = list.filter((i) => i.kind !== "watch" && !done.has(i.id)).sort((a, b) => b.impactMonthly - a.impactMonthly).slice(0, 3);
  $("focus-list").innerHTML = top.map((i, n) => `
    <button type="button" class="focus-item rise" style="--i:${n + 2}" data-id="${esc(i.id)}">
      <span class="sev" style="background:${sevColor[i.severity]}"></span>
      <span><b>${esc(i.title)}</b><small>${esc(i.kind)} · ${esc(i.area)}</small></span>
      <span class="amt">${chf(i.impactMonthly)}<small style="display:block;text-align:right">/ month</small></span>
    </button>`).join("") || `<p class="empty">All top findings are done. Nice work.</p>`;
  $("focus-list").querySelectorAll<HTMLButtonElement>(".focus-item").forEach((b) => b.addEventListener("click", () => openFinding(b.dataset.id!)));
  updateRing(list);
}

function updateRing(list: Insight[]) {
  const atStake = list.filter((i) => i.kind !== "watch").reduce((s, i) => s + Math.max(0, i.impactMonthly), 0);
  const captured = list.filter((i) => i.kind !== "watch" && done.has(i.id)).reduce((s, i) => s + Math.max(0, i.impactMonthly), 0);
  const share = atStake ? captured / atStake : 0;
  $("ring-val").setAttribute("stroke-dashoffset", String(100 - share * 100));
  $("ring-txt").textContent = pct(share);
  $("focus-sub").textContent = `${chf(atStake)}/month at stake · ${chf(captured)} handled`;
  $("progress").innerHTML = `<span><b class="num">${chf(captured)}</b> of <b class="num">${chf(atStake)}</b> per month handled</span><span class="bar"><i style="width:${(share * 100).toFixed(1)}%"></i></span><span>${list.filter((i) => done.has(i.id)).length} / ${list.length} done</span>`;
}

function openFinding(id: string) {
  actionFilter = "all";
  document.querySelectorAll<HTMLButtonElement>("#act-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === "all")));
  placeThumb($("act-filter"));
  expanded.add(id);
  if (data) renderActions(data.insights);
  const card = document.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  card?.classList.remove("flash");
  void card?.offsetWidth;
  card?.classList.add("flash");
}

// ---------- KPIs ----------
function delta(cur: number, prev: number | undefined, goodWhenUp = true) {
  if (prev === undefined || prev === 0) return "";
  const ch = (cur - prev) / Math.abs(prev);
  const cls = Math.abs(ch) < 0.005 ? "flat" : (ch > 0) === goodWhenUp ? "up" : "down";
  return `<span class="delta ${cls}">${ch > 0 ? "+" : ""}${(ch * 100).toFixed(1)}%</span>`;
}

function spark(values: number[], color: string) {
  const W = 200, H = 38;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const y = (v: number) => 3 + (H - 6) * (1 - (v - lo) / (hi - lo || 1));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const id = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="wipe" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H}L0,${H}Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1]!)}" r="3" fill="${color}"/>
  </svg>`;
}

function renderKpis(a: Analysis) {
  const t = a.totals, p = a.previous;
  const paid = a.channels.filter((c) => c.adSpend > 0);
  const poas = paid.reduce((s, c) => s + c.cm2, 0) / (paid.reduce((s, c) => s + c.adSpend, 0) || 1);
  const ret = t.units ? t.refundedUnits / t.units : 0;
  const retPrev = p && p.units ? p.refundedUnits / p.units : undefined;
  $("kpis").innerHTML = `
    <div class="card-s kpi rise" style="--i:2"><div class="label"><span>Net sales${termButton("net-sales")}</span>${delta(t.netSales, p?.netSales)}</div><div class="value" id="k-sales"></div><div class="sub">after discounts and refunds</div><div class="spark">${spark(a.daily.map((d) => d.netSales), "var(--series-1)")}</div></div>
    <div class="card-s kpi rise" style="--i:3"><div class="label"><span>Ad spend${termButton("ad-spend")}</span>${delta(t.adSpend, p?.adSpend, false)}</div><div class="value" id="k-ads"></div><div class="sub">${pct(t.adSpend / (t.netSales || 1), 1)} of net sales</div><div class="spark">${spark(a.daily.map((d) => d.adSpend), "var(--series-2)")}</div></div>
    <div class="card-s kpi rise" style="--i:4"><div class="label"><span>Paid POAS${termButton("poas")}</span></div><div class="value" id="k-poas"></div><div class="sub">contribution per CHF 1 of ads</div>
      <div class="meter"><i style="width:${Math.min(100, (poas / 3) * 100)}%;background:${poas >= 1 ? "var(--good)" : "var(--bad)"}"></i><span class="mark" style="left:33.3%" title="break-even 1.00x"></span></div><div class="meter-cap"><span>0</span><span>break-even 1.0x</span><span>3.0x</span></div></div>
    <div class="card-s kpi rise" style="--i:5"><div class="label"><span>Return rate${termButton("return-rate")}</span>${retPrev !== undefined ? delta(ret, retPrev, false) : ""}</div><div class="value" id="k-ret"></div><div class="sub">${chf(t.refunds)} refunded</div>
      <div class="meter"><i style="width:${Math.min(100, (ret / 0.1) * 100)}%;background:${ret > 0.06 ? "var(--warn)" : "var(--accent)"}"></i><span class="mark" style="left:50%" title="5% benchmark"></span></div><div class="meter-cap"><span>0%</span><span>5%</span><span>10%</span></div></div>`;
  countTo($("k-sales"), "k-sales", t.netSales, chf);
  countTo($("k-ads"), "k-ads", t.adSpend, chf);
  countTo($("k-poas"), "k-poas", poas, (n) => `${n.toFixed(2)}x`);
  countTo($("k-ret"), "k-ret", ret, (n) => pct(n, 1));
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
  const slot = (W - L - R) / steps.length;
  const bw = Math.min(58, slot * 0.64);
  let run = 0;
  const bars = steps.map((s, i) => {
    let top: number, bottom: number;
    if (s.kind === "total") { top = s.v; bottom = 0; run = s.v; }
    else if (s.kind === "result") { top = Math.max(s.v, 0); bottom = Math.min(s.v, 0); }
    else { top = run; bottom = run + s.v; run = bottom; }
    return { ...s, i, x: L + slot * i + (slot - bw) / 2, y1: y(top), y2: y(bottom) };
  });
  const grid = [0.25, 0.5, 0.75, 1].map((f) => (max * f) / 1.04).map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join("");
  const el = $("waterfall");
  el.innerHTML = `<svg class="wf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profit bridge from gross sales to profit after ads">
    <defs>
      <linearGradient id="wf-total" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0.75"/></linearGradient>
      <linearGradient id="wf-res" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--good)"/></linearGradient>
    </defs>
    ${grid}
    <line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    ${bars.slice(0, -1).map((b) => { const yy = b.kind === "total" ? b.y1 : b.y2; return `<line x1="${b.x + bw}" x2="${bars[b.i + 1]!.x}" y1="${yy}" y2="${yy}" stroke="var(--line-strong)" stroke-dasharray="3 3"/>`; }).join("")}
    ${bars.map((b) => {
      const h = Math.max(2, b.y2 - b.y1);
      const fill = b.kind === "total" ? "url(#wf-total)" : b.kind === "result" ? (b.v >= 0 ? "url(#wf-res)" : "var(--bad)") : "var(--bar-cost)";
      const cls = b.kind ? "wf-bar" : "wf-bar neg";
      const words = b.label.split(" ");
      return `<g class="wf-g" data-i="${b.i}" style="--i:${b.i}">
        <rect class="${cls}" x="${b.x}" y="${b.y1}" width="${bw}" height="${h}" rx="4" fill="${fill}"/>
        <text x="${b.x + bw / 2}" y="${b.y1 - 7}" text-anchor="middle" class="${b.kind ? "lbl-strong" : ""}">${b.v < 0 ? "−" : ""}${chfShort(Math.abs(b.v))}</text>
        <text x="${b.x + bw / 2}" y="${H - B + 18}" text-anchor="middle">${words[0]}</text>
        ${words.length > 1 ? `<text x="${b.x + bw / 2}" y="${H - B + 32}" text-anchor="middle">${words.slice(1).join(" ")}</text>` : ""}
        <rect x="${L + slot * b.i}" y="0" width="${slot}" height="${H}" fill="transparent"/>
      </g>`;
    }).join("")}
  </svg>`;
  const tip = attachTip(el);
  el.querySelectorAll<SVGGElement>("g[data-i]").forEach((g) => {
    const b = bars[Number(g.dataset.i)]!;
    g.addEventListener("pointerenter", () => {
      const scale = el.clientWidth / W;
      tip.show((b.x + bw / 2) * scale, b.y1 * scale, `<b>${esc(b.label)}</b><br><span class="num">${chf(b.v)} · ${pct(Math.abs(b.v) / (t.netSales || 1), 1)} of net sales</span>`);
    });
    g.addEventListener("pointerleave", () => tip.hide());
  });
}

// ---------- daily chart ----------
function renderDaily(a: Analysis) {
  const rows = a.daily;
  const W = 760, H = 250, L = 44, R = 64, T = 12, B = 26;
  const keys = (["cm3", "adSpend"] as const).filter((k) => seriesOn[k]);
  const vals = rows.flatMap((r) => (keys.length ? keys : (["cm3"] as const)).map((k) => r[k]));
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.1 || 1;
  const x = (i: number) => L + (W - L - R) * (rows.length > 1 ? i / (rows.length - 1) : 0.5);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const raw = (hi - lo) / 4 || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= 5)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) ticks.push(v);
  const path = (k: "cm3" | "adSpend") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
  const labelEvery = Math.ceil(rows.length / 6);
  const last = rows[rows.length - 1]!;
  let lyA = y(last.cm3), lyB = y(last.adSpend);
  if (Math.abs(lyA - lyB) < 14) { const mid = (lyA + lyB) / 2; const up = lyA <= lyB; lyA = mid + (up ? -7 : 7); lyB = mid + (up ? 7 : -7); }
  const el = $("daily");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily profit after ads and ad spend">
    <defs><linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity="0.2"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((v) => `<line class="${v === 0 ? "zero" : "grid"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${chfShort(v)}</text>`).join("")}
    ${rows.map((r, i) => (i % labelEvery === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.date.slice(8, 10)}.${r.date.slice(5, 7)}.</text>` : "")).join("")}
    <g class="series ${seriesOn.adSpend ? "" : "off"}">
      <path class="line-draw" pathLength="1" d="${path("adSpend")}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${x(rows.length - 1)}" cy="${y(last.adSpend)}" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"/>
      <text x="${W - R + 8}" y="${lyB + 4}">${chfShort(last.adSpend)}</text>
    </g>
    <g class="series ${seriesOn.cm3 ? "" : "off"}">
      <path class="area-fade" d="${path("cm3")}L${x(rows.length - 1)},${y(Math.max(lo, 0))}L${x(0)},${y(Math.max(lo, 0))}Z" fill="url(#dg)"/>
      <path class="line-draw" pathLength="1" d="${path("cm3")}" fill="none" stroke="var(--series-1)" stroke-width="2.25" stroke-linejoin="round"/>
      <circle cx="${x(rows.length - 1)}" cy="${y(last.cm3)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>
      <text x="${W - R + 8}" y="${lyA + 4}" class="lbl-strong">${chfShort(last.cm3)}</text>
    </g>
    <line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 3" visibility="hidden"/>
    <circle id="xh-a" r="5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <circle id="xh-b" r="5" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hit"/>
  </svg>`;
  const tip = attachTip(el);
  const s = el.querySelector("svg")!;
  const xh = s.querySelector("#xh")!, ca = s.querySelector("#xh-a")!, cb = s.querySelector("#xh-b")!;
  s.querySelector("#hit")!.addEventListener("pointermove", (ev) => {
    const e = ev as PointerEvent;
    const box = s.getBoundingClientRect();
    const scale = box.width / W;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round((((e.clientX - box.left) / scale - L) / (W - L - R)) * (rows.length - 1))));
    const r = rows[i]!;
    for (const [c, v, on] of [[ca, r.cm3, seriesOn.cm3], [cb, r.adSpend, seriesOn.adSpend]] as const) {
      c.setAttribute("cx", String(x(i))); c.setAttribute("cy", String(y(v))); c.setAttribute("visibility", on ? "visible" : "hidden");
    }
    xh.setAttribute("x1", String(x(i))); xh.setAttribute("x2", String(x(i))); xh.setAttribute("visibility", "visible");
    tip.show(x(i) * scale, Math.min(y(r.cm3), y(r.adSpend)) * scale,
      `<b>${new Date(r.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</b><br>
       <span class="num"><i style="background:var(--series-1)"></i>Profit after ads ${chf(r.cm3)}<br><i style="background:var(--series-2)"></i>Ad spend ${chf(r.adSpend)}<br>Net sales ${chf(r.netSales)} · ${r.orders} orders</span>`);
  });
  s.querySelector("#hit")!.addEventListener("pointerleave", () => { tip.hide(); [xh, ca, cb].forEach((n) => n.setAttribute("visibility", "hidden")); });
}

// ---------- findings ----------
const chevron = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

function renderActions(list: Insight[]) {
  const shown = list.filter((i) => actionFilter === "all" || i.kind === actionFilter)
    .sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id)));
  $("action-list").innerHTML = shown.map((i, n) => {
    const open = expanded.has(i.id);
    const isCampaign = i.entity?.type === "campaign";
    return `
    <article class="card rise" style="--i:${Math.min(n, 8)}" data-sev="${i.severity}" data-id="${esc(i.id)}" aria-expanded="${open}">
      <button type="button" class="card-btn" aria-controls="b-${esc(i.id)}">
        <div>
          <div class="tags"><span class="tag ${i.kind}">${i.kind}</span><span class="tag area">${i.area}</span><span class="tag area">${i.severity}</span></div>
          <h3>${esc(i.title)}</h3>
          <p class="lead">${esc(i.summary)}</p>
        </div>
        <div>${i.impactMonthly > 0 ? `<div class="impact"><b>${chf(i.impactMonthly)}</b><small>per month</small></div>` : ""}${chevron}</div>
      </button>
      <div class="card-body" id="b-${esc(i.id)}"><div><div class="card-inner">
        <div class="rec"><b>Do this:</b> ${esc(i.recommendation)}</div>
        <div class="metrics">${Object.entries(i.metrics).map(([k, v]) => `<div>${esc(k)}<b title="${esc(v)}">${esc(v)}</b></div>`).join("")}</div>
        <div class="card-actions">
          <label class="check"><input type="checkbox" data-done="${esc(i.id)}" ${done.has(i.id) ? "checked" : ""}> Mark as done</label>
          ${isCampaign ? `<button type="button" class="btn ghost sm" data-sim="${esc(i.entity!.id)}">Simulate budget</button>` : ""}
          <button type="button" class="btn sm" data-ask="${esc(`Explain this finding and what exactly I should change: "${i.title}"`)}">Ask the analyst</button>
        </div>
      </div></div></div>
    </article>`;
  }).join("") || `<p class="empty">Nothing in this category for the selected period.</p>`;

  const root = $("action-list");
  root.querySelectorAll<HTMLButtonElement>(".card-btn").forEach((b) => b.addEventListener("click", () => {
    const card = b.closest<HTMLElement>(".card")!;
    const id = card.dataset.id!;
    const open = card.getAttribute("aria-expanded") !== "true";
    card.setAttribute("aria-expanded", String(open));
    if (open) expanded.add(id); else expanded.delete(id);
  }));
  root.querySelectorAll<HTMLInputElement>("input[data-done]").forEach((c) => c.addEventListener("change", () => {
    if (c.checked) done.add(c.dataset.done!); else done.delete(c.dataset.done!);
    store.set("apd-done", JSON.stringify([...done]));
    c.closest(".card")!.classList.toggle("done", c.checked);
    renderFocus(list);
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-ask]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.ask!)));
  root.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((b) => b.addEventListener("click", () => focusSim(b.dataset.sim!)));
  for (const id of done) root.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add("done");
  updateRing(list);
}

// ---------- simulator ----------
function currentDaily(c: CampaignRow, a: Analysis) {
  const len = Math.round((Date.parse(a.range.to) - Date.parse(a.range.from)) / 86400000) + 1;
  return c.spend / len;
}

function recommended(c: CampaignRow, a: Analysis) {
  const cur = currentDaily(c, a);
  if (c.poas < 0.6) return Math.round(cur * 0.5);
  if (c.poas < 1) return Math.round(cur * 0.8);
  if (c.poas > 1.6 && c.lostIsBudget > 0.12) return Math.round(c.dailyBudget * (1 + c.lostIsBudget));
  return Math.round(cur);
}

function simChange(c: CampaignRow, budget: number): number {
  const r = runTool(data!.ctx, "simulate_budget_change", { campaign: c.id, new_daily_budget: budget }) as { monthly_profit_change: number };
  return r.monthly_profit_change ?? 0;
}

function renderSimulator(a: Analysis) {
  simBudget.clear();
  const rows = a.campaigns.map((c) => {
    const cur = Math.round(currentDaily(c, a));
    simBudget.set(c.id, cur);
    const max = Math.max(50, Math.ceil((cur * 3) / 10) * 10);
    return `<div class="sim-row" data-id="${esc(c.id)}">
      <div class="name"><span class="plat">${platformShort(c.platform)}</span>${esc(c.name)}<small>now ${chf(cur)}/day · POAS ${c.poas.toFixed(2)}x</small></div>
      <input type="range" id="sim-${esc(c.id)}" min="0" max="${max}" step="1" value="${cur}" aria-label="Daily budget for ${esc(c.name)}">
      <output for="sim-${esc(c.id)}">${chf(cur)}/d</output>
      <span class="chg">±CHF 0</span>
    </div>`;
  });
  $("sim-rows").innerHTML = rows.join("");
  $("sim-rows").querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => {
    const id = inp.closest<HTMLElement>(".sim-row")!.dataset.id!;
    inp.addEventListener("input", () => { simBudget.set(id, Number(inp.value)); updateSim(a); });
  });
  updateSim(a);
}

function updateSim(a: Analysis) {
  let total = 0, spendDelta = 0;
  for (const c of a.campaigns) {
    const row = $("sim-rows").querySelector<HTMLElement>(`.sim-row[data-id="${CSS.escape(c.id)}"]`);
    if (!row) continue;
    const b = simBudget.get(c.id)!;
    const inp = row.querySelector<HTMLInputElement>("input")!;
    inp.style.setProperty("--p", `${(Number(inp.value) / Number(inp.max)) * 100}%`);
    const cur = Math.round(currentDaily(c, a));
    const chg = b === cur ? 0 : simChange(c, b);
    total += chg;
    spendDelta += (b - currentDaily(c, a)) * 30;
    row.querySelector("output")!.textContent = `${chf(b)}/d`;
    const el = row.querySelector<HTMLElement>(".chg")!;
    el.textContent = chg === 0 ? "±CHF 0" : signed(chg);
    el.className = `chg ${chg > 0 ? "pos" : chg < 0 ? "neg" : ""}`;
  }
  const big = $("sim-big");
  big.className = `big num ${total > 0 ? "pos" : total < 0 ? "neg" : ""}`;
  countTo(big, "sim", total, (n) => `${signed(n)}`, 400);
  const newProfit = a.totals.cm3 * (30 / Math.max(1, a.daily.length)) + total;
  $("sim-sum").innerHTML = `
    <div><span>Ad spend change</span><b>${signed(spendDelta)}/mo</b></div>
    <div><span>Profit after ads now</span><b>${chf(a.totals.cm3 * (30 / Math.max(1, a.daily.length)))}/mo</b></div>
    <div><span>Projected</span><b>${chf(newProfit)}/mo</b></div>`;
}

function applyPlan(a: Analysis) {
  for (const c of a.campaigns) {
    const v = recommended(c, a);
    const inp = $<HTMLInputElement>(`sim-${c.id}`);
    if (!inp) continue;
    if (v > Number(inp.max)) inp.max = String(Math.ceil(v / 10) * 10);
    inp.value = String(v);
    simBudget.set(c.id, Number(inp.value));
  }
  updateSim(a);
}

function focusSim(campaignId: string) {
  const row = $("sim-rows").querySelector<HTMLElement>(`.sim-row[data-id="${CSS.escape(campaignId)}"]`);
  $("simulator").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  if (row) { row.style.background = "var(--accent-soft)"; setTimeout(() => (row.style.background = ""), 1600); row.querySelector("input")?.focus({ preventScroll: true }); }
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
  $("campaign-table").innerHTML = `
    <thead><tr><th>Campaign</th><th>Spend</th><th>Platform ROAS</th><th>True ROAS</th><th>POAS</th><th>Profit after ads</th><th>CPC 7d</th><th>Lost IS budget</th><th>Verdict</th></tr></thead>
    <tbody>${list.map((c, n) => `
      <tr class="row rise" style="--i:${n}" data-id="${esc(c.id)}" title="Open in simulator">
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
  $("campaign-table").querySelectorAll<HTMLTableRowElement>("tr.row").forEach((r) => r.addEventListener("click", () => focusSim(r.dataset.id!)));
}

// ---------- products ----------
const PRODUCT_COLS: { key: keyof ProductRow; label: string; fmt: (p: ProductRow, max: number) => string; cls?: (p: ProductRow) => string }[] = [
  { key: "netSales", label: "Net sales", fmt: (p) => chf(p.netSales) },
  { key: "cm2", label: "Before ads", fmt: (p) => chf(p.cm2), cls: (p) => (p.cm2 < 0 ? "neg" : "") },
  { key: "adSpend", label: "Ad spend", fmt: (p) => chf(p.adSpend) },
  { key: "cm3", label: "Profit (CM3)", cls: (p) => (p.cm3 < 0 ? "neg" : "pos"),
    fmt: (p, max) => { const w = Math.min(50, (Math.abs(p.cm3) / max) * 50); return `${chf(p.cm3)}<span class="div-cell" aria-hidden="true"><i style="${p.cm3 < 0 ? `right:50%;transform-origin:right` : `left:50%;transform-origin:left`};width:${w}%;background:${p.cm3 < 0 ? "var(--bad)" : "var(--good)"}"></i></span>`; } },
  { key: "cm3Margin", label: "Margin", fmt: (p) => pct(p.cm3Margin, 1), cls: (p) => (p.cm3Margin < 0 ? "neg" : "") },
  { key: "returnRate", label: "Returns", fmt: (p) => pct(p.returnRate, 1), cls: (p) => (p.returnRate > 0.1 ? "neg" : "") },
  { key: "avgDiscountPct", label: "Discount", fmt: (p) => pct(p.avgDiscountPct), cls: (p) => (p.avgDiscountPct > 0.12 ? "neg" : "") },
  { key: "daysOfCover", label: "Stock days", fmt: (p) => (fin(p.daysOfCover) === null ? "–" : p.daysOfCover.toFixed(p.daysOfCover < 10 ? 1 : 0)), cls: (p) => (fin(p.daysOfCover) !== null && p.daysOfCover < 10 ? "neg" : "") },
];

function costBreakdown(p: ProductRow) {
  const parts = [
    { k: "Cost of goods", v: p.cogs, c: "var(--bar-cost)" },
    { k: "Shipping + pick & pack", v: p.shipping + p.pickPack, c: "var(--info)" },
    { k: "Payment fees", v: p.paymentFees, c: "var(--accent-2)" },
    { k: "Return handling", v: p.returnHandling, c: "var(--warn)" },
    { k: "Ad spend", v: p.adSpend, c: "var(--series-2)" },
    { k: "Profit", v: Math.max(0, p.cm3), c: "var(--good)" },
  ].filter((x) => x.v > 0.5);
  // The bar is net sales split into costs and profit; for a loss-maker it is the costs alone.
  const total = parts.reduce((s, x) => s + x.v, 0) || 1;
  return `<div class="stackbar" title="${p.cm3 < 0 ? "Costs (exceed net sales)" : "Net sales split into costs and profit"}">${parts.map((x) => `<span style="width:${(x.v / total) * 100}%;background:${x.c}" title="${esc(x.k)}: ${chf(x.v)}"></span>`).join("")}</div>
    <div class="stack-legend">${parts.map((x) => `<span><i style="background:${x.c}"></i>${esc(x.k)}<b>${chf(x.v)}</b></span>`).join("")}<span>Unit price <b>${chf(p.price)}</b></span><span>Landed cost <b>CHF ${p.unitCost.toFixed(2)}</b></span><span>Units <b>${fmtInt.format(p.units)}</b></span></div>
    ${p.cm3 < 0 ? `<p class="note">Costs exceed net sales of ${chf(p.netSales)}: a loss of ${chf(-p.cm3)} in this period.</p>` : ""}`;
}

function renderProductFilters(list: ProductRow[]) {
  const cats = ["All", ...[...new Set(list.map((p) => p.category))].sort()];
  if (!cats.includes(productCat)) productCat = "All";
  $("cats").innerHTML = cats.map((c) => `<button type="button" aria-pressed="${c === productCat}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  $("cats").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => {
    productCat = b.dataset.c!;
    $("cats").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderProducts(list);
  }));
}

function renderProducts(list: ProductRow[]) {
  const { key, dir } = productSort;
  const q = productQuery.toLowerCase();
  const val = (p: ProductRow) => fin(p[key] as number) ?? 1e12;
  const rows = list
    .filter((p) => productCat === "All" || p.category === productCat)
    .filter((p) => !q || `${p.title} ${p.brand} ${p.sku}`.toLowerCase().includes(q))
    .sort((a, b) => (val(a) - val(b)) * dir);
  const max = Math.max(1, ...list.map((p) => Math.abs(p.cm3)));
  const cols = PRODUCT_COLS.length + 1;
  $("product-table").innerHTML = `
    <thead><tr><th>Product</th>${PRODUCT_COLS.map((c) => `<th><button type="button" data-k="${String(c.key)}" ${c.key === key ? `aria-sort="${dir === 1 ? "ascending" : "descending"}"` : ""}>${c.label}${c.key === key ? (dir === 1 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead>
    <tbody>${rows.map((p, n) => `
      <tr class="row rise" style="--i:${Math.min(n, 20)}" data-id="${esc(p.id)}" aria-expanded="${openProducts.has(p.id)}"><td>${esc(p.title)}<span class="meta">${esc(p.brand)} · ${esc(p.category)} · ${esc(p.sku)}</span></td>${PRODUCT_COLS.map((c) => `<td class="${c.cls?.(p) ?? ""}">${c.fmt(p, max)}</td>`).join("")}</tr>
      ${openProducts.has(p.id) ? `<tr class="detail"><td colspan="${cols}">${costBreakdown(p)}</td></tr>` : ""}`).join("") || `<tr><td colspan="${cols}" class="empty">No product matches.</td></tr>`}</tbody>`;
  $("product-table").querySelectorAll<HTMLButtonElement>("th button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k as keyof ProductRow;
    productSort = { key: k, dir: productSort.key === k ? (productSort.dir === 1 ? -1 : 1) : -1 };
    renderProducts(list);
  }));
  $("product-table").querySelectorAll<HTMLTableRowElement>("tr.row").forEach((r) => r.addEventListener("click", () => {
    const id = r.dataset.id!;
    if (openProducts.has(id)) openProducts.delete(id); else openProducts.add(id);
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
  "Which marketing budgets should we optimize?",
  "Was sollten wir diese Woche als Erstes tun?",
  "What does POAS mean?",
];
const TOOL_LABEL: Record<string, string> = {
  get_overview: "store P&L", list_products: "products", list_campaigns: "campaigns", get_insights: "findings",
  get_product_detail: "product detail", simulate_budget_change: "budget simulation",
};

function mdLite(text: string): string {
  const lines = esc(text).split(/\n/);
  let html = "", list: "ul" | "ol" | "" = "";
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(\S.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const ul = line.match(/^\s*[-•*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    const m = ul ?? ol;
    if (m) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { if (list) html += `</${list}>`; html += `<${kind}>`; list = kind; }
      html += `<li>${m[1]}</li>`;
      continue;
    }
    if (list) { html += `</${list}>`; list = ""; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<p><b>${h[1]}</b></p>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (list ? `</${list}>` : "");
}

function addMsg(role: "user" | "ai", html: string) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  $("msgs").appendChild(div);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return div;
}

const typing = (label = "Analysing") => `<span class="typing"><i></i><i></i><i></i><span>${label}…</span></span>`;
const stepsHtml = (trace: string[]) => (trace.length ? `<div class="steps">${[...new Set(trace)].map((t) => `<span class="step">${esc(TOOL_LABEL[t] ?? t)}</span>`).join("")}</div>` : "");

function renderSuggestions() {
  $("suggest").hidden = turns.length > 0;
  $("suggest").innerHTML = SUGGESTIONS.map((s, i) => `<button type="button" style="--i:${i}">${esc(s)}</button>`).join("");
  $("suggest").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => ask(b.textContent!)));
}

function setAiState() {
  const el = $("ai-state");
  if (aiMode === "offline") { el.textContent = "rules mode"; el.setAttribute("data-off", ""); el.title = "Claude is not connected in this view; answers come from fixed rules over the profit engine."; }
  else { el.textContent = aiMode === "sample" ? "Claude" : "Claude · live"; el.removeAttribute("data-off"); el.title = ""; }
}

async function ask(question: string) {
  if (busy || !data) return;
  question = question.trim();
  if (!question) return;
  if (window.matchMedia("(max-width: 1180px)").matches) $("msgs").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  addMsg("user", esc(question));
  turns.push({ role: "user", content: question });
  renderSuggestions();

  if (aiMode === "offline" && EMBEDDED) {
    const bubble = addMsg("ai", typing("Checking the numbers"));
    await new Promise((r) => setTimeout(r, reduced() ? 0 : 450));
    const text = answerOffline(question, data.ctx);
    bubble.innerHTML = mdLite(text);
    turns.push({ role: "assistant", content: text });
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return;
  }

  busy = true;
  $<HTMLButtonElement>("send").textContent = "Stop";
  const bubble = addMsg("ai", typing());
  const trace: string[] = [];
  try {
    let text = "";
    if (aiMode === "sample") {
      ctl = new AbortController();
      const ctx = data.ctx;
      const tools = TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
        execute: (input: Record<string, unknown>) => {
          trace.push(t.name);
          bubble.innerHTML = typing(`Checking ${TOOL_LABEL[t.name] ?? t.name}`) + stepsHtml(trace);
          return runTool(ctx, t.name, input ?? {});
        },
      }));
      const period = `Selected period: last ${days} days (${data.analysis.range.from} to ${data.analysis.range.to}).`;
      const input = [{ role: "user" as const, content: `${SYSTEM_PROMPT}\n\n${period}\nUse the tools to answer. The conversation follows.` }, ...turns.slice(-10)];
      const res = await sampleFn(input, {
        tools,
        signal: ctl.signal,
        onText: ({ text: t }: { text: string }) => { bubble.innerHTML = mdLite(t) + stepsHtml(trace); $("msgs").scrollTop = $("msgs").scrollHeight; },
      });
      text = res.text;
    } else {
      ctl = new AbortController();
      const r = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, messages: turns.slice(-10) }), signal: ctl.signal });
      const body = await r.json();
      if (!r.ok) throw { code: "server", message: body.error ?? `HTTP ${r.status}` };
      text = body.text;
      trace.push(...(body.toolCalls ?? []).map((t: { name: string }) => t.name));
    }
    turns.push({ role: "assistant", content: text });
    bubble.innerHTML = mdLite(text) + stepsHtml(trace);
  } catch (e: any) {
    const code = e?.name === "AbortError" ? "cancelled" : e?.code;
    const copy: Record<string, string> = {
      cancelled: "Stopped.",
      not_granted: "Claude access was not allowed for this page. Switching to rules-based answers.",
      rate_limited: "Too many questions in a short time. Try again in a minute.",
      tools_unavailable: "This viewer cannot run the analyst's tools. Switching to rules-based answers.",
      sampling_disabled: "Claude is not available for this account. Switching to rules-based answers.",
      refused: "Claude declined this question. Try rephrasing it.",
    };
    const msg = copy[code] ?? (e?.message ? esc(String(e.message)) : "Something went wrong. Try again.");
    const permanent = code === "not_granted" || code === "sampling_disabled" || code === "tools_unavailable";
    if (permanent) {
      aiMode = "offline";
      setAiState();
      const text = answerOffline(question, data.ctx);
      bubble.innerHTML = `<p class="note">${msg}</p>` + mdLite(text);
      turns.push({ role: "assistant", content: text });
    } else {
      turns.pop();
      bubble.innerHTML = (e?.text ? mdLite(e.text) : "") + `<p class="note">${msg}</p>`;
    }
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
    q.style.height = "";
    ask(v);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").dispatchEvent(new Event("submit", { cancelable: true })); }
  });
  q.addEventListener("input", () => { q.style.height = "auto"; q.style.height = `${Math.min(120, q.scrollHeight)}px`; });
  addMsg("ai", `<p>Hi! I watch sales, costs and ad spend across all connected sources. Ask me anything about profitability, or start with one of these:</p>`);
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

// ---------- theme (standalone deployments only; inside Claude the host sets it) ----------
function wireTheme() {
  if (EMBEDDED) return;
  const btn = $("theme");
  btn.hidden = false;
  const saved = store.get("apd-theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("apd-theme", next);
  });
}

// ---------- scroll spy ----------
function wireNav() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".nav a")];
  const sections = links.map((l) => document.querySelector<HTMLElement>(l.getAttribute("href")!)!).filter(Boolean);
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      links.forEach((l) => l.setAttribute("aria-current", String(l.getAttribute("href") === `#${e.target.id}`)));
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  sections.forEach((s) => io.observe(s));
}

// ---------- boot ----------
async function render() {
  try {
    data = await loadData(days);
  } catch (e) {
    $("hero-meta").innerHTML = `<span class="neg">Could not load data: ${esc(String((e as Error).message))}</span>`;
    return;
  }
  const a = data.analysis;
  renderHero(a, data.sources);
  renderFocus(data.insights);
  renderKpis(a);
  renderWaterfall(a);
  renderDaily(a);
  renderActions(data.insights);
  renderSimulator(a);
  renderCampaigns(a.campaigns);
  renderProductFilters(a.products);
  renderProducts(a.products);
  $("foot").textContent = `Period ${a.range.from} to ${a.range.to}. Cost assumptions: payment ${pct(a.costs.paymentFeePct, 1)} + CHF ${a.costs.paymentFeeFixed.toFixed(2)}, pick & pack CHF ${a.costs.pickPackPerOrder.toFixed(2)}/order, return handling CHF ${a.costs.returnHandlingPerUnit.toFixed(2)}/unit, ${pct(a.costs.returnResaleRate)} of returns resellable. Refunds are counted on the order date.`;
  setAiState();
}

function wireControls() {
  const range = $("range");
  range.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days));
    b.addEventListener("click", () => {
      if (Number(b.dataset.days) === days) return;
      days = Number(b.dataset.days);
      store.set("apd-days", String(days));
      range.querySelectorAll<HTMLButtonElement>("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      placeThumb(range);
      render();
    });
  });
  const filter = $("act-filter");
  filter.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => {
    actionFilter = b.dataset.k!;
    filter.querySelectorAll<HTMLButtonElement>("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    placeThumb(filter);
    if (data) renderActions(data.insights);
  }));
  $("daily-legend").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.s!;
    const others = Object.entries(seriesOn).filter(([key, on]) => key !== k && on).length;
    if (seriesOn[k] && others === 0) return; // keep at least one series visible
    seriesOn[k] = !seriesOn[k];
    b.setAttribute("aria-pressed", String(seriesOn[k]));
    if (data) renderDaily(data.analysis);
  }));
  $("sim-ai").addEventListener("click", () => data && applyPlan(data.analysis));
  $("sim-reset").addEventListener("click", () => data && renderSimulator(data.analysis));
  $<HTMLInputElement>("psearch").addEventListener("input", (e) => {
    productQuery = (e.target as HTMLInputElement).value;
    if (data) renderProducts(data.analysis.products);
  });
  const place = () => { placeThumb(range); placeThumb(filter); };
  window.addEventListener("resize", place);
  document.fonts?.ready.then(place);
  place();
}

wireTheme();
initHelp(() => (data ? { analysis: data.analysis, insights: data.insights, days } : undefined));
wireControls();
wireNav();
wireChat();
render().then(() => {
  // The 3D part is decoration: load it after the numbers are on screen.
  const host = document.getElementById("gear3d");
  if (host) window.setTimeout(() => mountGear3D(host).catch(() => { host.hidden = true; }), 250);
});
initAi();
