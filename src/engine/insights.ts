/**
 * Insight detectors: the "monitoring" half of the system.
 *
 * Each detector is a small pure function over the Analysis that returns
 * findings with a CHF/month impact estimate and a concrete action. They are
 * deterministic so they can run every hour without an LLM, raise alerts, and
 * give the AI verified facts to reason over instead of letting it guess.
 * Adding a detector = adding a function to DETECTORS. Texts come from the
 * i18n dictionaries, so findings are produced in the viewer's language.
 */
import type { Dataset } from "../core/types.ts";
import { rangeLength, type Analysis, type CampaignRow, type ProductRow } from "./profit.ts";
import { makeT, type Lang, type T } from "../i18n/index.ts";

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

type Detector = (a: Analysis, ds: Dataset, t: T) => Insight[];

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
const losingCampaigns: Detector = (a, _ds, t) => {
  const totalSpend = a.totals.adSpend || 1;
  return a.campaigns
    .filter((c) => c.poas < 1 && c.spend / totalSpend > 0.03)
    .map((c) => {
      const monthlyLoss = -c.profit * perMonth(a);
      const claims = c.overReporting > 0.25 ? t("ins.lc.claims", { platform: platformLabel(c.platform), p: x(c.platformRoas), t: x(c.trueRoas) }) : "";
      const top = c.topProducts[0];
      const lossProduct = top ? a.products.find((p) => p.id === top.id && p.cm3 < 0) : undefined;
      const action = c.poas < 0.6
        ? lossProduct
          ? t("ins.lc.pauseExclude", { product: lossProduct.title, share: pct(top!.share), target: x(c.breakEvenRoas * 1.15) })
          : t("ins.lc.cut", { target: x(c.breakEvenRoas * 1.15), be: x(c.breakEvenRoas) })
        : t("ins.lc.raise", { target: x(c.breakEvenRoas * 1.1), be: x(c.breakEvenRoas) });
      return {
        id: `campaign-loss-${c.id}`,
        kind: "problem",
        severity: severityFor(monthlyLoss),
        area: "marketing",
        title: t("ins.lc.title", { name: c.name }),
        summary: t("ins.lc.summary", { spend: chf(c.spend), cm2: chf(c.cm2), poas: c.poas.toFixed(2), claims }),
        recommendation: action,
        impactMonthly: monthlyLoss,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { [t("m.spend")]: chf(c.spend), [t("m.platformRoas")]: x(c.platformRoas), [t("m.trueRoas")]: x(c.trueRoas), [t("m.poas")]: x(c.poas), [t("m.breakEven")]: x(c.breakEvenRoas), [t("m.profit")]: chf(c.profit) },
      } satisfies Insight;
    });
};

/** Highly profitable campaigns that are capped by budget. */
const scalableCampaigns: Detector = (a, _ds, t) =>
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
        title: t("ins.sc.title", { name: c.name }),
        summary: t("ins.sc.summary", { poas: x(c.poas), lost: pct(c.lostIsBudget) }),
        recommendation: t("ins.sc.rec", { from: chf(c.dailyBudget), to: chf(c.dailyBudget + extraDaily), mp: x(marginalPoas) }),
        impactMonthly: monthlyGain,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { [t("m.poas")]: x(c.poas), [t("m.lostIs")]: pct(c.lostIsBudget), [t("m.dailyBudget")]: chf(c.dailyBudget), [t("m.profit")]: chf(c.profit) },
      } satisfies Insight;
    });

/** Sudden cost increases in the last 7 days. */
const cpcSpikes: Detector = (a, _ds, t) =>
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
        title: t("ins.cpc.title", { pct: pct(c.cpcTrend), name: c.name }),
        summary: t("ins.cpc.summary", { profit: chf(c.profitLast7) }),
        recommendation: t("ins.cpc.rec", { target: x(c.breakEvenRoas * 1.15) }),
        impactMonthly: monthlyExtra,
        entity: { type: "campaign", id: c.id, name: c.name },
        metrics: { [t("m.cpcChange")]: `+${pct(c.cpcTrend)}`, [t("m.avgCpc")]: `CHF ${c.cpc.toFixed(2)}`, [t("m.profit7")]: chf(c.profitLast7) },
      } satisfies Insight;
    });

/** Products that lose money after all costs, with the main cause. */
const losingProducts: Detector = (a, _ds, t) => {
  const avgReturn = a.totals.units ? a.totals.refundedUnits / a.totals.units : 0;
  return a.products
    .filter((p) => p.cm3 < 0 && p.netSales > a.totals.netSales * 0.01)
    .map((p) => {
      const monthly = -p.cm3 * perMonth(a);
      const returnCost = p.refunds - p.refundedUnits * p.unitCost * a.costs.returnResaleRate + p.returnHandling;
      const causes: { label: string; size: number; action: string }[] = [
        { label: t("ins.lp.cReturns", { rate: pct(p.returnRate), avg: pct(avgReturn, 1) }), size: p.returnRate > avgReturn * 2 ? returnCost : 0, action: t("ins.lp.aReturns") },
        { label: t("ins.lp.cDiscount", { pct: pct(p.avgDiscountPct) }), size: p.avgDiscountPct > 0.12 ? p.discounts : 0, action: t("ins.lp.aDiscount", { pct: pct(p.avgDiscountPct) }) },
        { label: t("ins.lp.cAds"), size: p.adSpend > p.cm2 ? p.adSpend - Math.max(0, p.cm2) : 0, action: t("ins.lp.aAds", { n: Object.keys(p.adSpendByCampaign).length }) },
      ].sort((m, n) => n.size - m.size);
      const main = causes[0]!.size > 0 ? causes[0]! : { label: t("ins.lp.cThin"), action: t("ins.lp.aThin"), size: 0 };
      return {
        id: `product-loss-${p.id}`,
        kind: "problem",
        severity: severityFor(monthly),
        area: "product",
        title: t("ins.lp.title", { name: p.title, amt: chf(-p.cm3) }),
        summary: t("ins.lp.summary", { sales: chf(p.netSales), cm2: chf(p.cm2), ads: chf(p.adSpend), cause: main.label }),
        recommendation: main.action,
        impactMonthly: monthly,
        entity: { type: "product", id: p.id, name: p.title },
        metrics: { [t("m.netSales")]: chf(p.netSales), [t("m.cm2")]: chf(p.cm2), [t("m.adSpend")]: chf(p.adSpend), [t("m.cm3")]: chf(p.cm3), [t("m.returnRate")]: pct(p.returnRate, 1), [t("m.discount")]: pct(p.avgDiscountPct) },
      } satisfies Insight;
    });
};

/** Advertised products about to run out of stock. */
const stockoutRisk: Detector = (a, _ds, t) =>
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
        title: t("ins.so.title", { name: p.title, days: p.daysOfCover.toFixed(1) }),
        summary: t("ins.so.summary", { inv: p.inventory, vel: p.velocity.toFixed(1), ads: chf(dailyAds) }),
        recommendation: t("ins.so.rec", { lead: leadTime }),
        impactMonthly: monthlyRisk,
        entity: { type: "product", id: p.id, name: p.title },
        metrics: { [t("m.stock")]: t("u.units", { n: p.inventory }), [t("m.salesDay")]: p.velocity.toFixed(1), [t("m.cover")]: p.daysOfCover.toFixed(1), [t("m.adsDay")]: chf(dailyAds) },
      } satisfies Insight;
    });

/** Ad platforms claiming much more revenue than Shopify confirms. */
const attributionGap: Detector = (a, _ds, t) => {
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
      title: t("ins.at.title", { platform: platformLabel(platform), pct: pct(v.pv / v.sales - 1) }),
      summary: t("ins.at.summary", { platform: platformLabel(platform), pv: chf(v.pv), sales: chf(v.sales) }),
      recommendation: t("ins.at.rec", { platform: platformLabel(platform) }),
      impactMonthly: 0,
      entity: { type: "platform", id: platform, name: platformLabel(platform) },
      metrics: { [t("m.platformRev")]: chf(v.pv), [t("m.shopifyRev")]: chf(v.sales), [t("m.platformRoas")]: x(v.pv / v.spend), [t("m.trueRoas")]: x(v.sales / v.spend) },
    }) satisfies Insight);
};

/** One combined budget move: from campaigns that lose money to campaigns that are capped. */
const budgetReallocation: Detector = (a, _ds, t) => {
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
  const list = (cs: CampaignRow[]) => cs.length > 1 ? `${cs.slice(0, -1).map((c) => c.name).join(", ")}${t("u.and")}${cs[cs.length - 1]!.name}` : cs[0]!.name;
  return [{
    id: "budget-reallocation",
    kind: "opportunity",
    severity: severityFor(monthly),
    area: "marketing",
    title: t("ins.re.title", { amt: chf(moved) }),
    summary: t("ins.re.summary", { losers: list(losers), winners: list(winners) }),
    recommendation: t("ins.re.rec", { freed: chf(freed), moved: chf(moved) }),
    impactMonthly: monthly,
    entity: { type: "store", id: "budget", name: t("ent.budget") },
    metrics: { [t("m.freed")]: t("u.perDay", { v: chf(freed) }), [t("m.moved")]: t("u.perDay", { v: chf(moved) }), [t("m.lossAvoided")]: t("u.perMo", { v: chf(lossAvoided * 30) }), [t("m.extra")]: t("u.perMo", { v: chf(gain * 30) }) },
  }];
};

/** Free-shipping threshold set so that many orders land just above it. */
const shippingThreshold: Detector = (a, ds, t) => {
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
    title: t("ins.sh.title", { amt: chf(subsidy * perMonth(a)) }),
    summary: t("ins.sh.summary", { pct: pct(free.length / orders.length), thr: Math.floor(threshold), n: nearBand.length, avg: chf(avgShipCost) }),
    recommendation: t("ins.sh.rec", { new: Math.floor(threshold) + 15 }),
    impactMonthly: monthly,
    entity: { type: "store", id: "shipping", name: t("ent.shipping") },
    metrics: { [t("m.netShip")]: chf(subsidy), [t("m.freeOrders")]: pct(free.length / orders.length), [t("m.nearThr")]: String(nearBand.length) },
  }];
};

export const DETECTORS: Record<string, Detector> = {
  losingCampaigns, scalableCampaigns, cpcSpikes, losingProducts, stockoutRisk, attributionGap, budgetReallocation, shippingThreshold,
};

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Text is produced in `lang`; ids, numbers and ranking are language-independent. */
export function detectInsights(a: Analysis, ds: Dataset, lang: Lang = "en"): Insight[] {
  const t = makeT(lang);
  const all = Object.values(DETECTORS).flatMap((d) => d(a, ds, t));
  return all.sort((m, n) => SEV_ORDER[m.severity] - SEV_ORDER[n.severity] || n.impactMonthly - m.impactMonthly);
}

/** Helpers the AI tools reuse. */
export type { CampaignRow, ProductRow };
