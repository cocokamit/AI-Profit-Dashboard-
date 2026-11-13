/**
 * Insight detectors: the "monitoring" half of the system.
 *
 * Each detector is a small pure function over the Analysis that returns
 * findings with a CHF/month impact estimate and a concrete action. They are
 * deterministic so they can run every hour without an LLM, raise alerts, and
 * give the AI verified facts to reason over instead of letting it guess.
 * Adding a detector = adding a function to DETECTORS.
 */
import type { Dataset } from "../core/types.ts";
import { rangeLength, type Analysis, type CampaignRow, type ProductRow } from "./profit.ts";

export type InsightKind = "problem" | "opportunity" | "watch";
export type Severity = "critical" | "high" | "medium" | "low";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  area: "marketing" | "product" | "inventory" | "pricing" | "data" | "fulfillment";
  title: string;
  summary: string;
  recommendation: string;
  /** Estimated profit effect per month if the recommendation is followed (CHF). */
  impactMonthly: number;
  entity?: { type: "campaign" | "product" | "platform" | "store"; id: string; name: string };
  metrics: Record<string, string>;
}

type Detector = (a: Analysis, ds: Dataset) => Insight[];

const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("de-CH")}`;
const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;
const platformLabel = (p: string) => (p === "google_ads" ? "Google Ads" : p === "meta" ? "Meta" : p === "tiktok" ? "TikTok" : p);

function severityFor(monthly: number): Severity {
  if (monthly >= 3000) return "critical";
  if (monthly >= 1200) return "high";
  if (monthly >= 400) return "medium";
  return "low";
}

const perMonth = (a: Analysis) => 30 / rangeLength(a.range);

/** Campaigns whose Shopify-measured contribution does not cover their spend. */
const losingCampaigns: Detector = (a) => {
  const totalSpend = a.totals.adSpend || 1;
  return a.campaigns
    .filter((c) => c.poas < 1 && c.spend / totalSpend > 0.03)
    .map((c) => {
      const monthlyLoss = -c.profit * perMonth(a);
      const claims = c.overReporting > 0.25 ? ` ${platformLabel(c.platform)} reports a ROAS of ${x(c.platformRoas)}, but Shopify only confirms ${x(c.trueRoas)}.` : "";
      const top = c.topProducts[0];
      const lossProduct = top ? a.products.find((p) => p.id === top.id && p.cm3 < 0) : undefined;
      const action = c.poas < 0.6
        ? lossProduct
          ? `Pause it or exclude "${lossProduct.title}" (${pct(top!.share)} of its revenue, loss-making). Rebuild with a target ROAS of at least ${x(c.breakEvenRoas * 1.15)}.`
          : `Cut the budget by at least 50% or pause. Any restart needs a target ROAS of ${x(c.breakEvenRoas * 1.15)} or higher (break-even is ${x(c.breakEvenRoas)}).`
        : `Raise the target ROAS to ${x(c.breakEvenRoas * 1.1)} and exclude low-margin products; it is close to break-even (${x(c.breakEvenRoas)}).`;
      return {
        id: `campaign-loss-${c.id}`,
        kind: "problem",
        severity: severityFor(monthlyLoss),
        area: "marketing",
        title: `${c.name} loses money`,
        summary: `Spent ${chf(c.spend)} and generated ${chf(c.cm2)} contribution: every franc returns ${c.poas.toFixed(2)}.${claims}`,
        recommendation: action,
        impactMonthly: monthlyLoss,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { Spend: chf(c.spend), "Platform ROAS": x(c.platformRoas), "True ROAS": x(c.trueRoas), POAS: x(c.poas), "Break-even ROAS": x(c.breakEvenRoas), Profit: chf(c.profit) },
      } satisfies Insight;
    });
};

/** Highly profitable campaigns that are capped by budget. */
const scalableCampaigns: Detector = (a) =>
  a.campaigns
    .filter((c) => c.poas > 1.6 && c.lostIsBudget > 0.12)
    .map((c) => {
      // Recover part of the lost impression share; assume diminishing returns (marginal POAS at 70% of average).
      const extraDaily = c.dailyBudget * (c.lostIsBudget / (1 - c.lostIsBudget)) * 0.8;
      const marginalPoas = c.poas * 0.7;
      const monthlyGain = extraDaily * 30 * (marginalPoas - 1);
      return {
        id: `campaign-scale-${c.id}`,
        kind: "opportunity",
        severity: severityFor(monthlyGain),
        area: "marketing",
        title: `Scale ${c.name}`,
        summary: `Earns ${x(c.poas)} its cost in contribution but loses ${pct(c.lostIsBudget)} of impressions to budget.`,
        recommendation: `Raise the daily budget from ${chf(c.dailyBudget)} to about ${chf(c.dailyBudget + extraDaily)} and review after 7 days. Expected marginal POAS ~${x(marginalPoas)}.`,
        impactMonthly: monthlyGain,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { POAS: x(c.poas), "Lost IS (budget)": pct(c.lostIsBudget), "Daily budget": chf(c.dailyBudget), Profit: chf(c.profit) },
      } satisfies Insight;
    });

/** Sudden cost increases in the last 7 days. */
const cpcSpikes: Detector = (a) =>
  a.campaigns
    .filter((c) => c.cpcTrend > 0.3 && c.spend > 300)
    .map((c) => {
      const dailySpend = c.spend / rangeLength(a.range);
      const monthlyExtra = dailySpend * 30 * (c.cpcTrend / (1 + c.cpcTrend));
      return {
        id: `cpc-spike-${c.id}`,
        kind: "watch",
        severity: severityFor(monthlyExtra),
        area: "marketing",
        title: `CPC up ${pct(c.cpcTrend)} on ${c.name}`,
        summary: `Cost per click jumped in the last 7 days. The campaign made ${chf(c.profitLast7)} in the last 7 days.`,
        recommendation: `Check the auction insights for a new competitor and the search terms report for broad-match drift. Set a max CPC or switch to target ROAS ${x(c.breakEvenRoas * 1.15)} until the CPC normalises.`,
        impactMonthly: monthlyExtra,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { "CPC change (7d)": `+${pct(c.cpcTrend)}`, "Avg CPC": `CHF ${c.cpc.toFixed(2)}`, "Profit last 7d": chf(c.profitLast7) },
      } satisfies Insight;
    });

/** Products that lose money after all costs, with the main cause. */
const losingProducts: Detector = (a) => {
  const avgReturn = a.totals.units ? a.totals.refundedUnits / a.totals.units : 0;
  return a.products
    .filter((p) => p.cm3 < 0 && p.netSales > a.totals.netSales * 0.01)
    .map((p) => {
      const monthly = -p.cm3 * perMonth(a);
      const returnCost = p.refunds - p.refundedUnits * p.unitCost * a.costs.returnResaleRate + p.returnHandling;
      const causes: { label: string; size: number; action: string }[] = [
        { label: `returns (${pct(p.returnRate)} vs ${pct(avgReturn, 1)} store average)`, size: p.returnRate > avgReturn * 2 ? returnCost : 0,
          action: "Check the return reasons; if it is quality, switch supplier or delist. Add compatibility info to the product page." },
        { label: `discounting (${pct(p.avgDiscountPct)} average)`, size: p.avgDiscountPct > 0.12 ? p.discounts : 0,
          action: `Stop the discount: at ${pct(p.avgDiscountPct)} off, the unit margin after fees is gone.` },
        { label: "ad spend above its contribution", size: p.adSpend > p.cm2 ? p.adSpend - Math.max(0, p.cm2) : 0,
          action: `Exclude it from ${Object.keys(p.adSpendByCampaign).length} campaign(s) or set a product-level ROAS floor.` },
      ].sort((m, n) => n.size - m.size);
      const main = causes[0]!.size > 0 ? causes[0]! : { label: "thin margin", action: "Review the purchase price or raise the selling price.", size: 0 };
      return {
        id: `product-loss-${p.id}`,
        kind: "problem",
        severity: severityFor(monthly),
        area: "product",
        title: `${p.title} loses ${chf(-p.cm3)}`,
        summary: `Net sales ${chf(p.netSales)}, margin before ads ${chf(p.cm2)}, allocated ad spend ${chf(p.adSpend)}. Main driver: ${main.label}.`,
        recommendation: main.action,
        impactMonthly: monthly,
        entity: { type: "product", id: p.id, name: p.title },
        metrics: { "Net sales": chf(p.netSales), CM2: chf(p.cm2), "Ad spend": chf(p.adSpend), CM3: chf(p.cm3), "Return rate": pct(p.returnRate, 1), Discount: pct(p.avgDiscountPct) },
      } satisfies Insight;
    });
};

/** Advertised products about to run out of stock. */
const stockoutRisk: Detector = (a) =>
  a.products
    .filter((p) => p.daysOfCover < 10 && p.velocity > 0.5)
    .map((p) => {
      const unitCm2 = p.units ? p.cm2 / p.units : 0;
      const leadTime = 14;
      const daysOut = Math.max(0, leadTime - p.daysOfCover);
      const monthlyRisk = Math.min(30, daysOut) * p.velocity * unitCm2;
      const dailyAds = p.adSpend / rangeLength(a.range);
      return {
        id: `stockout-${p.id}`,
        kind: "problem",
        severity: p.daysOfCover < 4 ? "critical" : "high",
        area: "inventory",
        title: `${p.title}: ${p.daysOfCover.toFixed(1)} days of stock left`,
        summary: `${p.inventory} units left, selling ${p.velocity.toFixed(1)}/day. Ads still spend about ${chf(dailyAds)}/day on it.`,
        recommendation: `Reorder now (assumed lead time ${leadTime} days). When stock drops below 3 days, exclude it from Shopping/PMax so the budget moves to products that can ship.`,
        impactMonthly: monthlyRisk,
        entity: { type: "product", id: p.id, name: p.title },
        metrics: { Stock: `${p.inventory} units`, "Sales/day": p.velocity.toFixed(1), "Days of cover": p.daysOfCover.toFixed(1), "Ad spend/day": chf(dailyAds) },
      } satisfies Insight;
    });

/** Ad platforms claiming much more revenue than Shopify confirms. */
const attributionGap: Detector = (a) => {
  const by = new Map<string, { pv: number; sales: number; spend: number }>();
  for (const c of a.campaigns) {
    const v = by.get(c.platform) ?? { pv: 0, sales: 0, spend: 0 };
    v.pv += c.platformValue;
    v.sales += c.netSales;
    v.spend += c.spend;
    by.set(c.platform, v);
  }
  return [...by.entries()]
    .filter(([, v]) => v.sales > 0 && v.pv / v.sales - 1 > 0.25)
    .map(([platform, v]) => ({
      id: `attribution-${platform}`,
      kind: "watch",
      severity: v.pv / v.sales - 1 > 0.5 ? "high" : "medium",
      area: "data",
      title: `${platformLabel(platform)} over-reports revenue by ${pct(v.pv / v.sales - 1)}`,
      summary: `${platformLabel(platform)} claims ${chf(v.pv)} revenue; Shopify confirms ${chf(v.sales)} for the same campaigns.`,
      recommendation: `Steer ${platformLabel(platform)} budgets on Shopify-confirmed POAS from this dashboard, not on the in-platform ROAS. Feed margin-based conversion values back via the Conversions API.`,
      impactMonthly: 0,
      entity: { type: "platform", id: platform, name: platformLabel(platform) },
      metrics: { "Platform revenue": chf(v.pv), "Shopify revenue": chf(v.sales), "Platform ROAS": x(v.pv / v.spend), "True ROAS": x(v.sales / v.spend) },
    }) satisfies Insight);
};

/** One combined budget move: from campaigns that lose money to campaigns that are capped. */
const budgetReallocation: Detector = (a) => {
  const losers = a.campaigns.filter((c) => c.poas < 0.6 && c.spend > 300);
  const winners = a.campaigns.filter((c) => c.poas > 1.6 && c.lostIsBudget > 0.12);
  if (!losers.length || !winners.length) return [];
  const days = rangeLength(a.range);
  const freed = losers.reduce((s, c) => s + (c.spend / days) * 0.5, 0);
  const capacity = winners.reduce((s, c) => s + c.dailyBudget * (c.lostIsBudget / (1 - c.lostIsBudget)) * 0.8, 0);
  const moved = Math.min(freed, capacity);
  const lossAvoided = losers.reduce((s, c) => s + (c.spend / days) * 0.5 * (1 - c.poas), 0);
  const avgWinnerPoas = winners.reduce((s, c) => s + c.poas * c.spend, 0) / winners.reduce((s, c) => s + c.spend, 0);
  const gain = moved * (avgWinnerPoas * 0.7 - 1);
  const monthly = (lossAvoided + gain) * 30;
  return [{
    id: "budget-reallocation",
    kind: "opportunity",
    severity: severityFor(monthly),
    area: "marketing",
    title: `Move ${chf(moved)}/day from losing to capped campaigns`,
    summary: `Halve ${losers.map((c) => c.name).join(", ")} and give ${winners.map((c) => c.name).join(", ")} the budget they are missing.`,
    recommendation: `Cut ${chf(freed)}/day across the losing campaigns; add ${chf(moved)}/day to the capped ones. Keep the rest of the freed budget as savings.`,
    impactMonthly: monthly,
    entity: { type: "store", id: "budget", name: "Ad budget" },
    metrics: { "Budget freed": `${chf(freed)}/day`, "Budget moved": `${chf(moved)}/day`, "Loss avoided": `${chf(lossAvoided * 30)}/mo`, "Extra profit": `${chf(gain * 30)}/mo` },
  }];
};

/** Free-shipping threshold set so that many orders land just above it. */
const shippingThreshold: Detector = (a, ds) => {
  const orders = ds.orders.filter((o) => o.date >= a.range.from && o.date <= a.range.to);
  const subsidy = a.totals.shipping;
  if (!orders.length || subsidy / (a.totals.netSales || 1) < 0.04) return [];
  const gross = (o: (typeof orders)[number]) => o.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const free = orders.filter((o) => o.shippingCharged === 0);
  const threshold = Math.min(...free.map(gross));
  const nearBand = free.filter((o) => gross(o) < threshold + 15);
  const avgShipCost = orders.reduce((s, o) => s + o.shippingCost, 0) / orders.length;
  // Conservative: half of those orders would pay shipping, 10% would be lost.
  const monthly = (nearBand.length * 0.5 * 7.9 - nearBand.length * 0.1 * (a.totals.cm2 / a.totals.orders)) * perMonth(a);
  if (monthly <= 0) return [];
  return [{
    id: "shipping-threshold",
    kind: "opportunity",
    severity: severityFor(monthly),
    area: "fulfillment",
    title: `Shipping subsidy costs ${chf(subsidy * perMonth(a))} per month`,
    summary: `${pct(free.length / orders.length)} of orders ship free (threshold ~CHF ${Math.floor(threshold)}). ${nearBand.length} orders landed within CHF 15 above it. Average carrier cost is ${chf(avgShipCost)}.`,
    recommendation: `Test raising the free-shipping threshold to CHF ${Math.floor(threshold) + 15} for 2 weeks (A/B), with a "you are CHF X away" cart message pointing to consumables.`,
    impactMonthly: monthly,
    entity: { type: "store", id: "shipping", name: "Shipping policy" },
    metrics: { "Net shipping cost": chf(subsidy), "Free-shipping orders": pct(free.length / orders.length), "Orders near threshold": String(nearBand.length) },
  }];
};

export const DETECTORS: Record<string, Detector> = {
  losingCampaigns, scalableCampaigns, cpcSpikes, losingProducts, stockoutRisk, attributionGap, budgetReallocation, shippingThreshold,
};

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function detectInsights(a: Analysis, ds: Dataset): Insight[] {
  const all = Object.values(DETECTORS).flatMap((d) => d(a, ds));
  return all.sort((m, n) => SEV_ORDER[m.severity] - SEV_ORDER[n.severity] || n.impactMonthly - m.impactMonthly);
}

/** Helpers the AI tools reuse. */
export type { CampaignRow, ProductRow };
