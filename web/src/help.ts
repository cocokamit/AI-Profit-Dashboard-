/**
 * Built-in guidance for people who are new to the dashboard:
 *  - a "?" button on every module: what it shows, how to read it, what the numbers say right now
 *  - a guided tour that spotlights each module in turn (offered on the first visit)
 *  - a Guide panel: how to read the dashboard in three questions + a glossary
 */
import type { Analysis } from "../../src/engine/profit.ts";
import type { Insight } from "../../src/engine/insights.ts";
import { GLOSSARY } from "../../src/ai/glossary.ts";

interface Ctx { analysis: Analysis; insights: Insight[]; days: number }
interface Help {
  /** element the tour highlights */
  target: string;
  title: string;
  what: string;
  read: string[];
  now?: (c: Ctx) => string;
  terms?: string[];
}

const fmt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number) => `CHF ${fmt.format(Math.round(n))}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const paidPoas = (a: Analysis) => {
  const paid = a.channels.filter((c) => c.adSpend > 0);
  return paid.reduce((s, c) => s + c.cm2, 0) / (paid.reduce((s, c) => s + c.adSpend, 0) || 1);
};

export const HELP: Record<string, Help> = {
  hero: {
    target: "hero-main",
    title: "Profit after ads",
    what: "The single most important number: how much money the shop really kept from selling in the chosen period, after paying for the products, shipping, payment fees, returns and advertising.",
    read: ["The big number is the profit (CM3). Fixed costs like rent and salaries are not deducted yet.", "The green or red badge compares it with the previous period of the same length.", "The line below shows the profit day by day. The chips show which data sources feed the numbers."],
    now: ({ analysis: a }) => `Out of every CHF 100 customers paid, about CHF ${Math.round((a.totals.cm3 / (a.totals.netSales || 1)) * 100)} is left as profit after ads.`,
    terms: ["cm3", "net-sales"],
  },
  focus: {
    target: "focus-card",
    title: "Today's focus",
    what: "The three findings with the biggest money impact right now, picked automatically from everything the system checks.",
    read: ["Each line shows what is going on and how many francs per month it is worth fixing.", "Click a line to jump to the full explanation and the recommended action.", "The ring fills up as you mark findings as done."],
    now: ({ insights }) => {
      const top = insights.filter((i) => i.kind !== "watch").sort((a, b) => b.impactMonthly - a.impactMonthly)[0];
      return top ? `Start with "${top.title}": worth about ${chf(top.impactMonthly)} per month.` : "Nothing urgent right now.";
    },
  },
  kpis: {
    target: "kpis",
    title: "Key figures",
    what: "Four health indicators of the shop, each compared with the previous period.",
    read: ["Net sales: what customers paid, after discounts and refunds.", "Ad spend: what you paid the ad platforms.", "Paid POAS: what one franc of ads brings back in margin. The line marks break-even (1.0): left of it, ads lose money.", "Return rate: share of sold items sent back. The line marks a 5% benchmark."],
    now: ({ analysis: a }) => {
      const p = paidPoas(a);
      return p >= 1 ? `Overall, every CHF 1 of ads brings back CHF ${p.toFixed(2)}: ads pay for themselves, but some campaigns lose money (see Campaigns).` : `Overall, every CHF 1 of ads brings back only CHF ${p.toFixed(2)}: advertising costs more than it earns.`;
    },
    terms: ["net-sales", "ad-spend", "poas", "return-rate"],
  },
  waterfall: {
    target: "wf-panel",
    title: "Where the money goes",
    what: "A step-by-step bridge from everything customers ordered (left, blue) to what is left as profit (right, green). Each grey bar is a cost that eats into the money.",
    read: ["Read it left to right like a staircase going down.", "The taller a grey bar, the bigger that cost.", "Hover a bar to see its amount and its share of net sales."],
    now: ({ analysis: a }) => {
      const t = a.totals;
      const costs = [["cost of goods", t.cogs], ["ad spend", t.adSpend], ["shipping", t.shipping], ["pick & pack", t.pickPack], ["payment fees", t.paymentFees], ["refunds", t.refunds]] as const;
      const [name, v] = [...costs].sort((x, y) => y[1] - x[1])[0]!;
      const [name2, v2] = [...costs].sort((x, y) => y[1] - x[1])[1]!;
      return `The biggest cost is ${name} (${chf(v)}), followed by ${name2} (${chf(v2)}).`;
    },
    terms: ["cogs", "shipping-subsidy", "cm3"],
  },
  daily: {
    target: "daily-panel",
    title: "Daily profit vs. ad spend",
    what: "Two lines per day: the profit after ads (blue) and the money spent on ads (orange).",
    read: ["Blue above orange means each day earns more than it spends on ads.", "Dips in blue often line up with weekends or a campaign that got more expensive.", "Hover the chart for one day's numbers; click a legend button to hide a line."],
    now: ({ analysis: a }) => {
      const neg = a.daily.filter((d) => d.cm3 < 0).length;
      return neg ? `${neg} of ${a.daily.length} days ended with a loss after ads.` : `Every day in this period ended with a profit after ads.`;
    },
  },
  chat: {
    target: "chat-panel",
    title: "Profit analyst",
    what: "An AI assistant you can ask questions in plain English or German. It looks up the answer in the same numbers you see on the page, so it does not guess.",
    read: ["Click a suggested question or type your own, e.g. \"Why is the Dyson battery losing money?\".", "The small labels under an answer show which data it checked.", "\"Rules mode\" means the AI is not connected here: you still get answers to the standard questions and to \"what does … mean?\"."],
  },
  actions: {
    target: "actions",
    title: "What to do now",
    what: "Everything the monitoring engine found: problems that cost money, opportunities to earn more, and things to watch. It re-checks all data every hour.",
    read: ["Red stripe = critical, orange = high, blue = medium.", "The amount on the right is the estimated profit per month if you follow the advice.", "Click a card for the exact action and the numbers behind it. Tick \"Mark as done\" to track progress."],
    now: ({ insights }) => `${insights.length} findings, ${insights.filter((i) => i.severity === "critical").length} of them critical.`,
  },
  simulator: {
    target: "simulator",
    title: "Budget simulator",
    what: "A safe playground: move the daily ad budget of any campaign and see what it would do to the monthly profit, before touching anything in Google or Meta.",
    read: ["Drag a slider left to spend less, right to spend more.", "Each row shows the profit change for that campaign; the box sums up all changes.", "\"Apply recommended plan\" sets the budgets the system suggests. It is an estimate: test real changes for 1 to 2 weeks."],
    terms: ["poas"],
  },
  campaigns: {
    target: "campaigns",
    title: "Campaigns: claims vs. real profit",
    what: "Every ad campaign, comparing what Google or Meta claim with what really happened in your shop.",
    read: ["Platform ROAS is the platform's claim; True ROAS is counted from real orders. A big gap means the platform over-reports.", "POAS is the deciding number: below 1.00 (red) the campaign loses money.", "Verdict: SCALE = give it more budget, KEEP = fine, FIX = near break-even, CUT = losing money. Click a row to try it in the simulator."],
    now: ({ analysis: a }) => {
      const losing = a.campaigns.filter((c) => c.poas < 1);
      return losing.length ? `${losing.length} of ${a.campaigns.length} campaigns lose money, together ${chf(-losing.reduce((s, c) => s + c.profit, 0))} in this period.` : "All campaigns earn more than they cost.";
    },
    terms: ["roas", "true-roas", "poas", "lost-is", "cpc"],
  },
  products: {
    target: "products",
    title: "Products after all costs",
    what: "Every product with its real profit after all costs, including its share of the ad spend that sold it.",
    read: ["Sorted with the biggest losers first; click a column title to sort differently.", "Red numbers flag a problem: a loss, high returns, a deep discount, or stock running out.", "Click a row to see where that product's money goes."],
    now: ({ analysis: a }) => {
      const losers = a.products.filter((p) => p.cm3 < 0);
      return losers.length ? `${losers.length} products lose money after all costs; the worst is ${losers.sort((x, y) => x.cm3 - y.cm3)[0]!.title}.` : "Every product is profitable after all costs.";
    },
    terms: ["cm2", "cm3", "return-rate", "stock-days"],
  },
  how: {
    target: "how",
    title: "How it works",
    what: "The building blocks behind the dashboard, from data sources to the AI. Mostly interesting for the technical team.",
    read: ["Data flows left to right: connectors pull data, the engine calculates profit, detectors find issues, the AI explains them.", "New data sources such as TikTok or Merchant Center plug into the first block without changing the rest."],
  },
};

const TOUR = ["hero", "focus", "kpis", "waterfall", "daily", "chat", "actions", "simulator", "campaigns", "products"];

let getCtx: () => Ctx | undefined = () => undefined;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const termById = (id: string) => GLOSSARY.find((t) => t.id === id);

function helpHtml(key: string, compact = false) {
  const h = HELP[key]!;
  const ctx = getCtx();
  const now = ctx && h.now ? h.now(ctx) : "";
  return `
    <p class="h-what">${esc(h.what)}</p>
    ${compact ? "" : `<div class="h-label">How to read it</div><ul class="h-read">${h.read.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`}
    ${now ? `<div class="h-now"><span>Right now</span>${esc(now)}</div>` : ""}
    ${!compact && h.terms?.length ? `<div class="h-terms">${h.terms.map((t) => `<button type="button" class="h-term" data-term="${t}">${esc(termById(t)?.term ?? t)}</button>`).join("")}</div>` : ""}`;
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

function openPop(anchor: HTMLElement, title: string, html: string) {
  if (popAnchor === anchor) return closePop();
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "pop";
    pop.setAttribute("role", "dialog");
    pop.hidden = true;
    document.body.appendChild(pop);
  }
  closePop();
  pop.innerHTML = `<div class="pop-head"><b>${esc(title)}</b><button type="button" class="pop-x" aria-label="Close">✕</button></div><div class="pop-body">${html}</div>`;
  pop.setAttribute("aria-label", title);
  pop.hidden = false;
  popAnchor = anchor;
  anchor.setAttribute("aria-expanded", "true");
  positionPop();
  pop.querySelector<HTMLButtonElement>(".pop-x")!.addEventListener("click", closePop);
  pop.querySelectorAll<HTMLButtonElement>(".h-term").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openGuide(b.dataset.term); }));
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

function infoButton(key: string, label: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info";
  b.dataset.help = key;
  b.setAttribute("aria-label", `What is "${label}"?`);
  b.setAttribute("aria-expanded", "false");
  b.textContent = "?";
  return b;
}

/** Puts a "?" next to each module title. Safe to call again after re-renders. */
export function attachInfoButtons() {
  const spots: [string, string | null][] = [
    ["hero", "hero-label"], ["focus", "focus-title"], ["waterfall", "wf-title"], ["daily", "daily-title"], ["chat", "chat-title"],
    ["actions", "act-title"], ["simulator", "sim-title"], ["campaigns", "camp-title"], ["products", "prod-title"], ["how", "arch-title"],
  ];
  for (const [key, id] of spots) {
    const el = id ? document.getElementById(id) : null;
    if (el && !el.querySelector(".info") && !el.parentElement?.querySelector(`.info[data-help="${key}"]`)) {
      if (key === "hero") el.after(infoButton(key, HELP[key]!.title));
      else el.appendChild(infoButton(key, HELP[key]!.title));
    }
  }
}

/** Small "?" for a single term, e.g. inside a KPI label. */
export function termButton(termId: string) {
  return `<button type="button" class="info sm" data-term-pop="${termId}" aria-label="What is ${esc(termById(termId)?.term ?? termId)}?" aria-expanded="false">?</button>`;
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
  const h = HELP[key]!;
  const target = document.getElementById(h.target);
  if (!target) return go(n + 1);
  // On phones the tour card sits at the bottom, so the highlighted module goes to the top.
  const tall = window.innerWidth < 640 || target.getBoundingClientRect().height > window.innerHeight * 0.6;
  target.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: tall ? "start" : "center" });
  const c = card!;
  c.innerHTML = `
    <div class="t-top"><span class="t-count">Step ${n + 1} of ${TOUR.length}</span><button type="button" class="pop-x" data-t="skip" aria-label="Close tour">✕</button></div>
    <div class="t-dots">${TOUR.map((_, i) => `<i class="${i === n ? "on" : i < n ? "past" : ""}"></i>`).join("")}</div>
    <h3>${esc(h.title)}</h3>
    ${helpHtml(key, true)}
    <div class="t-btns">
      <button type="button" class="btn ghost sm" data-t="back" ${n === 0 ? "disabled" : ""}>Back</button>
      <button type="button" class="btn sm" data-t="next">${n === TOUR.length - 1 ? "Finish" : "Next"}</button>
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
    card.setAttribute("aria-label", "Dashboard tour");
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

export function openGuide(termId?: string) {
  closePop();
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="drawer-bg" data-close></div>
      <aside class="drawer-panel" role="dialog" aria-label="Guide">
        <div class="drawer-head"><h2>Guide</h2><button type="button" class="pop-x" data-close aria-label="Close guide">✕</button></div>
        <div class="drawer-body">
          <p class="h-what">This dashboard answers three questions, from top to bottom:</p>
          <ol class="g-steps">
            <li><b>Are we making money?</b><span>Profit after ads, key figures and the daily chart at the top.</span></li>
            <li><b>Why, and where not?</b><span>"Where the money goes", Campaigns and Products show which costs, campaigns and products eat the profit.</span></li>
            <li><b>What should we do?</b><span>"What to do now" lists concrete actions, the simulator tests budget changes, and the analyst answers questions.</span></li>
          </ol>
          <button type="button" class="btn" id="g-tour">Take the 1-minute tour</button>
          <p class="h-what" style="margin-top:6px">Tip: every module has a <span class="info demo">?</span> button that explains it.</p>
          <div class="h-label" style="margin-top:18px">Glossary</div>
          <label class="search g-search" for="g-q"><input id="g-q" type="search" placeholder="Search a term, e.g. POAS"></label>
          <dl class="glossary">${GLOSSARY.map((t) => `<div id="term-${t.id}" data-q="${esc(`${t.term} ${t.aliases.join(" ")}`.toLowerCase())}"><dt>${esc(t.term)}</dt><dd>${esc(t.short)}${t.example ? `<em>${esc(t.example)}</em>` : ""}</dd></div>`).join("")}</dl>
        </div>
      </aside>`;
    document.body.appendChild(drawer);
    drawer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeGuide));
    drawer.querySelector("#g-tour")!.addEventListener("click", startTour);
    drawer.querySelector<HTMLInputElement>("#g-q")!.addEventListener("input", (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
      drawer!.querySelectorAll<HTMLElement>(".glossary > div").forEach((d) => (d.hidden = !!q && !d.dataset.q!.includes(q)));
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
  welcome.classList.add("out");
  window.setTimeout(() => welcome?.remove(), 300);
  store.set("apd-toured", "1");
}

function maybeWelcome() {
  if (store.get("apd-toured")) return;
  welcome = document.createElement("div");
  welcome.className = "welcome";
  welcome.setAttribute("role", "status");
  welcome.innerHTML = `<div class="bot sm" aria-hidden="true">?</div>
    <div><b>New here?</b><p>Take a 1-minute tour of what each part of the dashboard shows, or click any <span class="info demo">?</span> later.</p>
    <div class="t-btns"><button type="button" class="btn sm" id="w-go">Start the tour</button><button type="button" class="btn ghost sm" id="w-no">Not now</button></div></div>`;
  document.body.appendChild(welcome);
  welcome.querySelector("#w-go")!.addEventListener("click", startTour);
  welcome.querySelector("#w-no")!.addEventListener("click", hideWelcome);
}

export function initHelp(ctx: () => Ctx | undefined) {
  getCtx = ctx;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const info = t.closest<HTMLElement>(".info[data-help]");
    const term = t.closest<HTMLElement>(".info[data-term-pop]");
    if (info) { e.stopPropagation(); const h = HELP[info.dataset.help!]!; openPop(info, h.title, helpHtml(info.dataset.help!)); return; }
    if (term) {
      e.stopPropagation();
      const tm = termById(term.dataset.termPop!)!;
      openPop(term, tm.term, `<p class="h-what">${esc(tm.short)}</p>${tm.example ? `<div class="h-now"><span>Example</span>${esc(tm.example)}</div>` : ""}<div class="h-terms"><button type="button" class="h-term" data-term="${tm.id}">Open in glossary</button></div>`);
      return;
    }
    if (pop && !pop.hidden && !pop.contains(t)) closePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  window.addEventListener("resize", closePop);
  window.addEventListener("scroll", positionPop, { passive: true, capture: true });
  document.getElementById("guide")?.addEventListener("click", () => openGuide());
  attachInfoButtons();
  window.setTimeout(maybeWelcome, reduced() ? 0 : 1600);
}
