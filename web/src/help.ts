/**
 * Built-in guidance for people who are new to the dashboard:
 *  - a "?" button on every module: what it shows, how to read it, what the numbers say right now
 *  - a guided tour that spotlights each module in turn (offered on the first visit)
 *  - a Guide panel: how to read the dashboard in three questions + a glossary
 * All text comes from the i18n dictionaries (keys h.*, help.*, tour.*, guide.*, g.*).
 */
import type { Analysis } from "../../src/engine/profit.ts";
import type { Insight } from "../../src/engine/insights.ts";
import { GLOSSARY } from "../../src/ai/glossary.ts";
import type { Key, T } from "../../src/i18n/index.ts";

interface Ctx { analysis: Analysis; insights: Insight[]; days: number }
interface Help {
  /** element the tour highlights */
  target: string;
  now?: (c: Ctx, t: T) => string;
  terms?: string[];
}

const fmt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number) => `CHF ${fmt.format(Math.round(n))}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const paidPoas = (a: Analysis) => {
  const paid = a.channels.filter((c) => c.adSpend > 0);
  return paid.reduce((s, c) => s + c.cm2, 0) / (paid.reduce((s, c) => s + c.adSpend, 0) || 1);
};

export const HELP: Record<string, Help> = {
  hero: { target: "hero-main", terms: ["cm3", "net-sales"], now: ({ analysis: a }, t) => t("h.hero.now", { n: Math.round((a.totals.cm3 / (a.totals.netSales || 1)) * 100) }) },
  focus: {
    target: "focus-card",
    now: ({ insights }, t) => {
      const top = insights.filter((i) => i.kind !== "watch").sort((a, b) => b.impactMonthly - a.impactMonthly)[0];
      return top ? t("h.focus.now", { title: top.title, amt: chf(top.impactMonthly) }) : t("h.focus.none");
    },
  },
  kpis: {
    target: "kpis", terms: ["net-sales", "ad-spend", "poas", "return-rate"],
    now: ({ analysis: a }, t) => { const p = paidPoas(a); return t(p >= 1 ? "h.kpis.good" : "h.kpis.bad", { p: p.toFixed(2) }); },
  },
  waterfall: {
    target: "wf-panel", terms: ["cogs", "shipping-subsidy", "cm3"],
    now: ({ analysis: a }, t) => {
      const tt = a.totals;
      const costs = ([["hc.cogs", tt.cogs], ["hc.ads", tt.adSpend], ["hc.shipping", tt.shipping], ["hc.pick", tt.pickPack], ["hc.fees", tt.paymentFees], ["hc.refunds", tt.refunds]] as [Key, number][])
        .sort((x, y) => y[1] - x[1]);
      return t("h.waterfall.now", { a: t(costs[0]![0]), av: chf(costs[0]![1]), b: t(costs[1]![0]), bv: chf(costs[1]![1]) });
    },
  },
  daily: {
    target: "daily-panel",
    now: ({ analysis: a }, t) => { const neg = a.daily.filter((d) => d.cm3 < 0).length; return neg ? t("h.daily.neg", { neg, total: a.daily.length }) : t("h.daily.pos"); },
  },
  chat: { target: "chat-panel" },
  actions: { target: "actions", now: ({ insights }, t) => t("h.actions.now", { n: insights.length, c: insights.filter((i) => i.severity === "critical").length }) },
  simulator: { target: "simulator", terms: ["poas"] },
  campaigns: {
    target: "campaigns", terms: ["roas", "true-roas", "poas", "lost-is", "cpc"],
    now: ({ analysis: a }, t) => {
      const losing = a.campaigns.filter((c) => c.poas < 1);
      return losing.length ? t("h.campaigns.now", { n: losing.length, total: a.campaigns.length, amt: chf(-losing.reduce((s, c) => s + c.profit, 0)) }) : t("h.campaigns.none");
    },
  },
  products: {
    target: "products", terms: ["cm2", "cm3", "return-rate", "stock-days"],
    now: ({ analysis: a }, t) => {
      const losers = a.products.filter((p) => p.cm3 < 0).sort((x, y) => x.cm3 - y.cm3);
      return losers.length ? t("h.products.now", { n: losers.length, title: losers[0]!.title }) : t("h.products.none");
    },
  },
  how: { target: "how" },
};

const TOUR = ["hero", "focus", "kpis", "waterfall", "daily", "chat", "actions", "simulator", "campaigns", "products"];

let getCtx: () => Ctx | undefined = () => undefined;
let t: T = (k) => String(k);
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const title = (key: string) => t(`h.${key}.title` as Key);
const termName = (id: string) => t(`g.${id}.term` as Key);

function helpHtml(key: string, compact = false) {
  const h = HELP[key]!;
  const ctx = getCtx();
  const now = ctx && h.now ? h.now(ctx, t) : "";
  const read = t(`h.${key}.read` as Key).split("\n");
  return `
    <p class="h-what">${esc(t(`h.${key}.what` as Key))}</p>
    ${compact ? "" : `<div class="h-label">${esc(t("help.read"))}</div><ul class="h-read">${read.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`}
    ${now ? `<div class="h-now"><span>${esc(t("help.now"))}</span>${esc(now)}</div>` : ""}
    ${!compact && h.terms?.length ? `<div class="h-terms">${h.terms.map((id) => `<button type="button" class="h-term" data-term="${id}">${esc(termName(id))}</button>`).join("")}</div>` : ""}`;
}

// ---------- popover ----------
let pop: HTMLDivElement | undefined;
let popAnchor: HTMLElement | undefined;

function closePop() {
  if (!pop) return;
  pop.hidden = true;
  popAnchor?.setAttribute("aria-expanded", "false");
  popAnchor = undefined;
}

/** Keeps the popover attached to its button (also while the page scrolls). */
function positionPop() {
  if (!pop || pop.hidden || !popAnchor) return;
  const r = popAnchor.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return closePop();
  const w = Math.min(360, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
  const below = r.bottom + 10 + pop.offsetHeight < window.innerHeight || r.top < pop.offsetHeight + 20;
  pop.style.left = `${left}px`;
  pop.style.top = below ? `${r.bottom + 10}px` : `${r.top - pop.offsetHeight - 10}px`;
  pop.dataset.side = below ? "below" : "above";
}

function openPop(anchor: HTMLElement, heading: string, html: string) {
  if (popAnchor === anchor) return closePop();
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "pop";
    pop.setAttribute("role", "dialog");
    pop.hidden = true;
    document.body.appendChild(pop);
  }
  closePop();
  pop.innerHTML = `<div class="pop-head"><b>${esc(heading)}</b><button type="button" class="pop-x" aria-label="${esc(t("help.close"))}">✕</button></div><div class="pop-body">${html}</div>`;
  pop.setAttribute("aria-label", heading);
  pop.hidden = false;
  popAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  positionPop();
  pop.querySelector<HTMLButtonElement>(".pop-x")!.addEventListener("click", closePop);
  pop.querySelectorAll<HTMLButtonElement>(".h-term").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openGuide(b.dataset.term); }));
}

function infoButton(key: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info";
  b.dataset.help = key;
  b.setAttribute("aria-label", t("help.whatIs", { x: title(key) }));
  b.setAttribute("aria-expanded", "false");
  b.textContent = "?";
  return b;
}

/** Puts a "?" next to each module title; on a language change it refreshes their labels. */
export function attachInfoButtons() {
  const spots: [string, string][] = [
    ["hero", "hero-label"], ["focus", "focus-title"], ["waterfall", "wf-title"], ["daily", "daily-title"], ["chat", "chat-title"],
    ["actions", "act-title"], ["simulator", "sim-title"], ["campaigns", "camp-title"], ["products", "prod-title"], ["how", "arch-title"],
  ];
  for (const [key, id] of spots) {
    const el = document.getElementById(id);
    if (!el) continue;
    const existing = (key === "hero" ? el.parentElement : el)?.querySelector<HTMLElement>(`.info[data-help="${key}"]`);
    if (existing) { existing.setAttribute("aria-label", t("help.whatIs", { x: title(key) })); continue; }
    if (key === "hero") el.after(infoButton(key)); else el.appendChild(infoButton(key));
  }
}

/** Small "?" for a single term, e.g. inside a KPI label. */
export function termButton(termId: string) {
  return `<button type="button" class="info sm" data-term-pop="${termId}" aria-label="${esc(t("help.whatIs", { x: termName(termId) }))}" aria-expanded="false">?</button>`;
}

// ---------- tour ----------
let step = -1;
let spot: HTMLDivElement | undefined;
let card: HTMLDivElement | undefined;
let tourTimer: number | undefined;

function endTour() {
  step = -1;
  spot?.remove(); card?.remove();
  spot = card = undefined;
  store.set("apd-toured", "1");
  document.removeEventListener("keydown", tourKeys);
  window.removeEventListener("resize", placeTour);
  window.removeEventListener("scroll", placeTour, true);
}

function tourKeys(e: KeyboardEvent) {
  if (e.key === "Escape") endTour();
  else if (e.key === "ArrowRight") go(step + 1);
  else if (e.key === "ArrowLeft") go(step - 1);
}

function placeTour() {
  if (step < 0 || !spot || !card) return;
  const target = document.getElementById(HELP[TOUR[step]!]!.target);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const pad = 8;
  const top = Math.max(8, r.top - pad);
  const bottom = Math.min(window.innerHeight - 8, r.bottom + pad);
  spot.style.top = `${top}px`;
  spot.style.left = `${Math.max(4, r.left - pad)}px`;
  spot.style.width = `${Math.min(window.innerWidth - 8, r.width + pad * 2)}px`;
  spot.style.height = `${Math.max(40, bottom - top)}px`;
  const mobile = window.innerWidth < 640;
  if (mobile) { card.style.left = "12px"; card.style.right = "12px"; card.style.top = "auto"; card.style.bottom = "12px"; card.style.width = "auto"; return; }
  const w = 360;
  card.style.width = `${w}px`;
  card.style.bottom = "auto";
  card.style.right = "auto";
  const spaceRight = window.innerWidth - r.right;
  if (spaceRight > w + 32) { card.style.left = `${r.right + 20}px`; card.style.top = `${Math.min(Math.max(16, r.top), window.innerHeight - card.offsetHeight - 16)}px`; }
  else if (r.left > w + 32) { card.style.left = `${r.left - w - 20}px`; card.style.top = `${Math.min(Math.max(16, r.top), window.innerHeight - card.offsetHeight - 16)}px`; }
  else {
    card.style.left = `${Math.min(Math.max(16, r.left + r.width / 2 - w / 2), window.innerWidth - w - 16)}px`;
    const below = bottom + 16 + card.offsetHeight < window.innerHeight;
    card.style.top = below ? `${bottom + 16}px` : `${Math.max(16, top - card.offsetHeight - 16)}px`;
  }
}

function go(n: number) {
  if (n < 0 || n >= TOUR.length) return endTour();
  step = n;
  const key = TOUR[n]!;
  const target = document.getElementById(HELP[key]!.target);
  if (!target) return go(n + 1);
  // On phones the tour card sits at the bottom, so the highlighted module goes to the top.
  const tall = window.innerWidth < 640 || target.getBoundingClientRect().height > window.innerHeight * 0.6;
  target.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: tall ? "start" : "center" });
  const c = card!;
  c.setAttribute("aria-label", t("tour.aria"));
  c.innerHTML = `
    <div class="t-top"><span class="t-count">${esc(t("tour.step", { n: n + 1, total: TOUR.length }))}</span><button type="button" class="pop-x" data-t="skip" aria-label="${esc(t("tour.close"))}">✕</button></div>
    <div class="t-dots">${TOUR.map((_, i) => `<i class="${i === n ? "on" : i < n ? "past" : ""}"></i>`).join("")}</div>
    <h3>${esc(title(key))}</h3>
    ${helpHtml(key, true)}
    <div class="t-btns">
      <button type="button" class="btn ghost sm" data-t="back" ${n === 0 ? "disabled" : ""}>${esc(t("tour.back"))}</button>
      <button type="button" class="btn sm" data-t="next">${esc(t(n === TOUR.length - 1 ? "tour.finish" : "tour.next"))}</button>
    </div>`;
  c.querySelector<HTMLButtonElement>('[data-t="next"]')!.addEventListener("click", () => go(step + 1));
  c.querySelector<HTMLButtonElement>('[data-t="back"]')!.addEventListener("click", () => go(step - 1));
  c.querySelector<HTMLButtonElement>('[data-t="skip"]')!.addEventListener("click", endTour);
  c.classList.remove("swap"); void c.offsetWidth; c.classList.add("swap");
  placeTour();
  window.clearTimeout(tourTimer);
  tourTimer = window.setTimeout(() => { placeTour(); card?.querySelector<HTMLButtonElement>('[data-t="next"]')?.focus({ preventScroll: true }); }, reduced() ? 0 : 480);
}

export function startTour() {
  closePop(); closeGuide(); hideWelcome();
  if (!spot) {
    spot = document.createElement("div");
    spot.className = "t-spot";
    card = document.createElement("div");
    card.className = "t-card";
    card.setAttribute("role", "dialog");
    document.body.append(spot, card);
    spot.addEventListener("click", endTour);
    document.addEventListener("keydown", tourKeys);
    window.addEventListener("resize", placeTour);
    window.addEventListener("scroll", placeTour, true);
  }
  go(0);
}

// ---------- guide panel ----------
let drawer: HTMLDivElement | undefined;

function closeGuide() {
  if (!drawer) return;
  drawer.classList.remove("open");
  window.setTimeout(() => { if (drawer && !drawer.classList.contains("open")) drawer.hidden = true; }, reduced() ? 0 : 300);
}

/** Inserts the "?" chip into a translated sentence at its {q} placeholder. */
const withChip = (text: string) => esc(text).replace("\u0000", `<span class="info demo">?</span>`);

export function openGuide(termId?: string) {
  closePop();
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="drawer-bg" data-close></div>
      <aside class="drawer-panel" role="dialog" aria-label="${esc(t("guide.title"))}">
        <div class="drawer-head"><h2>${esc(t("guide.title"))}</h2><button type="button" class="pop-x" data-close aria-label="${esc(t("guide.close"))}">✕</button></div>
        <div class="drawer-body">
          <p class="h-what">${esc(t("guide.intro"))}</p>
          <ol class="g-steps">
            <li><b>${esc(t("guide.q1"))}</b><span>${esc(t("guide.a1"))}</span></li>
            <li><b>${esc(t("guide.q2"))}</b><span>${esc(t("guide.a2"))}</span></li>
            <li><b>${esc(t("guide.q3"))}</b><span>${esc(t("guide.a3"))}</span></li>
          </ol>
          <button type="button" class="btn" id="g-tour">${esc(t("guide.tour"))}</button>
          <p class="h-what" style="margin-top:6px">${withChip(t("guide.tip", { q: "\u0000" }))}</p>
          <div class="h-label" style="margin-top:18px">${esc(t("guide.glossary"))}</div>
          <label class="search g-search" for="g-q"><input id="g-q" type="search" placeholder="${esc(t("guide.search"))}"></label>
          <dl class="glossary">${GLOSSARY.map((g) => {
            const ex = t(`g.${g.id}.ex` as Key);
            return `<div id="term-${g.id}" data-q="${esc(`${termName(g.id)} ${g.term} ${g.aliases.join(" ")}`.toLowerCase())}"><dt>${esc(termName(g.id))}</dt><dd>${esc(t(`g.${g.id}.short` as Key))}${ex ? `<em>${esc(ex)}</em>` : ""}</dd></div>`;
          }).join("")}</dl>
        </div>
      </aside>`;
    document.body.appendChild(drawer);
    drawer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeGuide));
    drawer.querySelector("#g-tour")!.addEventListener("click", startTour);
    drawer.querySelector<HTMLInputElement>("#g-q")!.addEventListener("input", (e) => {
      const v = (e.target as HTMLInputElement).value.toLowerCase().trim();
      drawer!.querySelectorAll<HTMLElement>(".glossary > div").forEach((d) => (d.hidden = !!v && !d.dataset.q!.includes(v)));
    });
    drawer.addEventListener("keydown", (e) => { if (e.key === "Escape") closeGuide(); });
  }
  drawer.hidden = false;
  requestAnimationFrame(() => drawer!.classList.add("open"));
  drawer.querySelectorAll(".glossary > div.hl").forEach((d) => d.classList.remove("hl"));
  if (termId) {
    const el = drawer.querySelector<HTMLElement>(`#term-${termId}`);
    if (el) { el.hidden = false; el.classList.add("hl"); window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }), 200); }
  }
  window.setTimeout(() => drawer?.querySelector<HTMLButtonElement>(".pop-x")?.focus({ preventScroll: true }), 50);
}

// ---------- first-visit welcome ----------
let welcome: HTMLDivElement | undefined;
function hideWelcome() {
  if (!welcome) return;
  const w = welcome;
  welcome = undefined;
  w.classList.add("out");
  window.setTimeout(() => w.remove(), 300);
  store.set("apd-toured", "1");
}

function renderWelcome() {
  if (!welcome) return;
  welcome.innerHTML = `<div class="bot sm" aria-hidden="true">?</div>
    <div><b>${esc(t("welcome.title"))}</b><p>${withChip(t("welcome.text", { q: "\u0000" }))}</p>
    <div class="t-btns"><button type="button" class="btn sm" id="w-go">${esc(t("welcome.go"))}</button><button type="button" class="btn ghost sm" id="w-no">${esc(t("welcome.no"))}</button></div></div>`;
  welcome.querySelector("#w-go")!.addEventListener("click", startTour);
  welcome.querySelector("#w-no")!.addEventListener("click", hideWelcome);
}

function maybeWelcome() {
  if (store.get("apd-toured")) return;
  welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.setAttribute("role", "status");
  renderWelcome();
  document.body.appendChild(welcome);
}

/** Called on a language change: rebuilds everything the help layer has rendered. */
export function setHelpLanguage(next: T) {
  t = next;
  attachInfoButtons();
  closePop();
  if (drawer) { const open = drawer.classList.contains("open"); drawer.remove(); drawer = undefined; if (open) openGuide(); }
  if (step >= 0) go(step);
  renderWelcome();
}

export function initHelp(ctx: () => Ctx | undefined, translate: T) {
  getCtx = ctx;
  t = translate;
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const info = el.closest<HTMLElement>(".info[data-help]");
    const term = el.closest<HTMLElement>(".info[data-term-pop]");
    if (info) { e.stopPropagation(); openPop(info, title(info.dataset.help!), helpHtml(info.dataset.help!)); return; }
    if (term) {
      e.stopPropagation();
      const id = term.dataset.termPop!;
      const ex = t(`g.${id}.ex` as Key);
      openPop(term, termName(id), `<p class="h-what">${esc(t(`g.${id}.short` as Key))}</p>${ex ? `<div class="h-now"><span>${esc(t("help.example"))}</span>${esc(ex)}</div>` : ""}<div class="h-terms"><button type="button" class="h-term" data-term="${id}">${esc(t("help.openGlossary"))}</button></div>`);
      return;
    }
    if (pop && !pop.hidden && !pop.contains(el)) closePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  window.addEventListener("resize", closePop);
  window.addEventListener("scroll", positionPop, { passive: true, capture: true });
  document.getElementById("guide")?.addEventListener("click", () => openGuide());
  attachInfoButtons();
  window.setTimeout(maybeWelcome, reduced() ? 0 : 1600);
}
