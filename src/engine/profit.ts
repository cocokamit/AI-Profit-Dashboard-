/**
 * Profit engine: turns canonical rows into true contribution margins.
 *
 *   Gross sales (after discounts)
 * − Refunds                                  = Net sales
 * − COGS (kept units + written-off returns)   = CM1  (gross margin)
 * − Shipping (carrier cost − shipping charged)
 * − Pick & pack, payment fees, return handling = CM2  (margin before marketing)
 * − Ad spend (allocated)                      = CM3  (contribution after marketing: the real profit lever)
 *
 * Ad spend is allocated to products by the revenue each campaign actually
 * drove in Shopify, not by what the platform claims. Refunds are attributed
 * to the order date (cohort view) so a campaign is charged for its own returns.
 *
 * Pure and browser-safe: the server, the monitor job and the hosted demo all
 * run exactly this code.
 */
import type { AdPlatform, AdSpendRow, ChannelKey, CostConfig, Dataset, DateRange, Order, Product } from "../core/types.ts";

export interface PnL {
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  cogs: number;
  cm1: number;
  shipping: number;
  pickPack: number;
  paymentFees: number;
  returnHandling: number;
  cm2: number;
  adSpend: number;
  cm3: number;
  orders: number;
  units: number;
  refundedUnits: number;
}

export interface ProductRow extends PnL {
  id: string;
  sku: string;
  title: string;
  brand: string;
  category: string;
  price: number;
  unitCost: number;
  inventory: number;
  returnRate: number;
  /** units/day over the last 14 days of the dataset */
  velocity: number;
  daysOfCover: number;
  cm3Margin: number;
  avgDiscountPct: number;
  /** ad spend by campaign id */
  adSpendByCampaign: Record<string, number>;
}

export interface CampaignRow {
  id: string;
  name: string;
  platform: AdPlatform;
  type: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  dailyBudget: number;
  lostIsBudget: number;
  platformConversions: number;
  platformValue: number;
  platformRoas: number;
  orders: number;
  netSales: number;
  cm2: number;
  /** Net sales / spend, measured in Shopify */
  trueRoas: number;
  /** Profit on ad spend: CM2 / spend. Above 1 = the campaign makes money. */
  poas: number;
  profit: number;
  breakEvenRoas: number;
  /** Platform-reported value vs Shopify gross sales, e.g. 0.4 = platform claims 40% more */
  overReporting: number;
  /** CPC of the last 7 days vs the rest of the range */
  cpcTrend: number;
  profitLast7: number;
  profitPrev7: number;
  topProducts: { id: string; title: string; share: number }[];
}

export interface ChannelRow extends PnL {
  channel: ChannelKey;
}

export interface DayRow {
  date: string;
  netSales: number;
  adSpend: number;
  cm2: number;
  cm3: number;
  orders: number;
}

export interface Analysis {
  range: DateRange;
  currency: string;
  totals: PnL;
  previous?: PnL;
  products: ProductRow[];
  campaigns: CampaignRow[];
  channels: ChannelRow[];
  daily: DayRow[];
  /** spend of campaigns with no attributable Shopify revenue in range */
  unattributedSpend: number;
  costs: CostConfig;
}

const zero = (): PnL => ({
  grossSales: 0, discounts: 0, refunds: 0, netSales: 0, cogs: 0, cm1: 0, shipping: 0, pickPack: 0,
  paymentFees: 0, returnHandling: 0, cm2: 0, adSpend: 0, cm3: 0, orders: 0, units: 0, refundedUnits: 0,
});

function finish(p: PnL): PnL {
  p.netSales = p.grossSales - p.refunds;
  p.cm1 = p.netSales - p.cogs;
  p.cm2 = p.cm1 - p.shipping - p.pickPack - p.paymentFees - p.returnHandling;
  p.cm3 = p.cm2 - p.adSpend;
  return p;
}

function add(into: PnL, from: Partial<PnL>, w = 1) {
  for (const k of Object.keys(from) as (keyof PnL)[]) into[k] += (from[k] ?? 0) * w;
}

const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

export function shiftRange(r: DateRange, days: number): DateRange {
  const s = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return { from: s(r.from), to: s(r.to) };
}

export function rangeLength(r: DateRange): number {
  return Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
}

/** Per-line cost split of one order. Order-level costs are spread by line revenue share. */
function orderLineEconomics(o: Order, productsById: Map<string, Product>, c: CostConfig) {
  const gross = o.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) || 1;
  const orderTotal = gross + o.shippingCharged;
  const shippingNet = o.shippingCost - o.shippingCharged;
  const fee = orderTotal * c.paymentFeePct + c.paymentFeeFixed;
  const refundedQty = new Map<string, number>();
  const refundedAmt = new Map<string, number>();
  for (const r of o.refunds) {
    refundedQty.set(r.productId, (refundedQty.get(r.productId) ?? 0) + r.qty);
    refundedAmt.set(r.productId, (refundedAmt.get(r.productId) ?? 0) + r.amount);
  }
  return o.lines.map((l) => {
    const p = productsById.get(l.productId);
    const unitCost = p?.unitCost ?? 0;
    const lineGross = l.unitPrice * l.qty;
    const share = lineGross / gross;
    const rq = Math.min(l.qty, refundedQty.get(l.productId) ?? 0);
    refundedQty.set(l.productId, (refundedQty.get(l.productId) ?? 0) - rq);
    const ra = Math.min(lineGross, refundedAmt.get(l.productId) ?? 0);
    refundedAmt.set(l.productId, (refundedAmt.get(l.productId) ?? 0) - ra);
    const pnl: Partial<PnL> = {
      grossSales: lineGross,
      discounts: l.discount * l.qty,
      refunds: ra,
      cogs: unitCost * (l.qty - rq) + unitCost * rq * (1 - c.returnResaleRate),
      shipping: shippingNet * share,
      pickPack: c.pickPackPerOrder * share,
      paymentFees: fee * share,
      returnHandling: rq * c.returnHandlingPerUnit,
      units: l.qty,
      refundedUnits: rq,
      orders: share,
    };
    return { productId: l.productId, pnl };
  });
}

function summarize(ds: Dataset, range: DateRange, costs: CostConfig, productsById: Map<string, Product>): PnL {
  const t = zero();
  for (const o of ds.orders) {
    if (!inRange(o.date, range)) continue;
    for (const { pnl } of orderLineEconomics(o, productsById, costs)) add(t, pnl);
  }
  for (const a of ds.adSpend) if (inRange(a.date, range)) t.adSpend += a.spend;
  return finish(t);
}

export function analyze(ds: Dataset, range: DateRange, costs: CostConfig): Analysis {
  const productsById = new Map(ds.products.map((p) => [p.id, p]));
  const productPnl = new Map<string, PnL>();
  const productDiscountBase = new Map<string, number>();
  const channelPnl = new Map<ChannelKey, PnL>();
  const daily = new Map<string, DayRow>();
  const totals = zero();

  // campaign -> product -> gross sales; campaign -> PnL (before ads)
  const campProductSales = new Map<string, Map<string, number>>();
  const campPnl = new Map<string, PnL>();

  for (const o of ds.orders) {
    if (!inRange(o.date, range)) continue;
    const day = daily.get(o.date) ?? { date: o.date, netSales: 0, adSpend: 0, cm2: 0, cm3: 0, orders: 0 };
    daily.set(o.date, day);
    day.orders++;
    const ch = channelPnl.get(o.channel) ?? zero();
    channelPnl.set(o.channel, ch);
    for (const { productId, pnl } of orderLineEconomics(o, productsById, costs)) {
      const pp = productPnl.get(productId) ?? zero();
      productPnl.set(productId, pp);
      add(pp, pnl);
      add(ch, pnl);
      add(totals, pnl);
      productDiscountBase.set(productId, (productDiscountBase.get(productId) ?? 0) + (pnl.grossSales ?? 0) + (pnl.discounts ?? 0));
      const tmp = finish({ ...zero(), ...pnl } as PnL);
      day.netSales += tmp.netSales;
      day.cm2 += tmp.cm2;
      if (o.campaignId) {
        const cps = campProductSales.get(o.campaignId) ?? new Map<string, number>();
        campProductSales.set(o.campaignId, cps);
        cps.set(productId, (cps.get(productId) ?? 0) + (pnl.grossSales ?? 0));
        const cp = campPnl.get(o.campaignId) ?? zero();
        campPnl.set(o.campaignId, cp);
        add(cp, pnl);
      }
    }
  }

  // Ad spend rows -> campaigns, days, channels
  const campRows = new Map<string, AdSpendRow[]>();
  for (const a of ds.adSpend) {
    if (!inRange(a.date, range)) continue;
    const list = campRows.get(a.campaignId) ?? [];
    list.push(a);
    campRows.set(a.campaignId, list);
    const day = daily.get(a.date) ?? { date: a.date, netSales: 0, adSpend: 0, cm2: 0, cm3: 0, orders: 0 };
    daily.set(a.date, day);
    day.adSpend += a.spend;
    totals.adSpend += a.spend;
    const ch = channelPnl.get(a.platform) ?? zero();
    channelPnl.set(a.platform, ch);
    ch.adSpend += a.spend;
  }

  // Allocate campaign spend to products by Shopify-attributed revenue share
  const productAdByCampaign = new Map<string, Record<string, number>>();
  let unattributedSpend = 0;
  for (const [cid, rows] of campRows) {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const sales = campProductSales.get(cid);
    const total = sales ? [...sales.values()].reduce((s, v) => s + v, 0) : 0;
    if (!sales || total === 0) { unattributedSpend += spend; continue; }
    for (const [pid, v] of sales) {
      const amt = spend * (v / total);
      const pp = productPnl.get(pid)!;
      pp.adSpend += amt;
      const rec = productAdByCampaign.get(pid) ?? {};
      rec[cid] = (rec[cid] ?? 0) + amt;
      productAdByCampaign.set(pid, rec);
    }
  }

  // Velocity over the last 14 days of available data
  const lastDate = ds.orders.reduce((m, o) => (o.date > m ? o.date : m), range.to);
  const velRange = { from: shiftRange({ from: lastDate, to: lastDate }, -13).from, to: lastDate };
  const units14 = new Map<string, number>();
  for (const o of ds.orders) if (inRange(o.date, velRange)) for (const l of o.lines) units14.set(l.productId, (units14.get(l.productId) ?? 0) + l.qty);

  const products: ProductRow[] = ds.products.map((p) => {
    const pnl = finish(productPnl.get(p.id) ?? zero());
    const velocity = (units14.get(p.id) ?? 0) / 14;
    const listValue = productDiscountBase.get(p.id) ?? 0;
    return {
      ...pnl,
      id: p.id, sku: p.sku, title: p.title, brand: p.brand, category: p.category,
      price: p.price, unitCost: p.unitCost, inventory: p.inventory,
      returnRate: pnl.units ? pnl.refundedUnits / pnl.units : 0,
      velocity,
      daysOfCover: velocity > 0 ? p.inventory / velocity : Infinity,
      cm3Margin: pnl.netSales ? pnl.cm3 / pnl.netSales : 0,
      avgDiscountPct: listValue ? pnl.discounts / listValue : 0,
      adSpendByCampaign: productAdByCampaign.get(p.id) ?? {},
    };
  }).filter((p) => p.units > 0 || p.adSpend > 0);

  const last7 = { from: shiftRange({ from: range.to, to: range.to }, -6).from, to: range.to };
  const prev7 = shiftRange(last7, -7);

  // Per-campaign 7-day profit windows need per-day CM2 of attributed orders
  const campDayCm2 = new Map<string, Map<string, number>>();
  for (const o of ds.orders) {
    if (!o.campaignId || !inRange(o.date, range)) continue;
    const m = campDayCm2.get(o.campaignId) ?? new Map<string, number>();
    campDayCm2.set(o.campaignId, m);
    const cm2 = orderLineEconomics(o, productsById, costs).reduce((s, { pnl }) => s + finish({ ...zero(), ...pnl } as PnL).cm2, 0);
    m.set(o.date, (m.get(o.date) ?? 0) + cm2);
  }

  const campaigns: CampaignRow[] = [...campRows.entries()].map(([cid, rows]) => {
    const first = rows[0]!;
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const pv = rows.reduce((s, r) => s + r.platformConversionValue, 0);
    const pc = rows.reduce((s, r) => s + r.platformConversions, 0);
    const pnl = finish(campPnl.get(cid) ?? zero());
    const sumWin = (w: DateRange, f: (r: AdSpendRow) => number) => rows.filter((r) => inRange(r.date, w)).reduce((s, r) => s + f(r), 0);
    const cm2Win = (w: DateRange) => [...(campDayCm2.get(cid) ?? new Map()).entries()].filter(([d]) => inRange(d, w)).reduce((s, [, v]) => s + v, 0);
    const lastSpend = sumWin(last7, (r) => r.spend);
    const lastClicks = sumWin(last7, (r) => r.clicks);
    const restSpend = spend - lastSpend;
    const restClicks = clicks - lastClicks;
    const cpcLast = lastClicks ? lastSpend / lastClicks : 0;
    const cpcRest = restClicks ? restSpend / restClicks : cpcLast;
    const sales = campProductSales.get(cid) ?? new Map<string, number>();
    const salesTotal = [...sales.values()].reduce((s, v) => s + v, 0) || 1;
    return {
      id: cid,
      name: first.campaignName,
      platform: first.platform,
      type: first.campaignType,
      spend, impressions, clicks,
      cpc: clicks ? spend / clicks : 0,
      dailyBudget: rows[rows.length - 1]!.dailyBudget ?? 0,
      lostIsBudget: rows.reduce((s, r) => s + (r.lostImpressionShareBudget ?? 0), 0) / rows.length,
      platformConversions: pc,
      platformValue: pv,
      platformRoas: spend ? pv / spend : 0,
      orders: Math.round(pnl.orders),
      netSales: pnl.netSales,
      cm2: pnl.cm2,
      trueRoas: spend ? pnl.netSales / spend : 0,
      poas: spend ? pnl.cm2 / spend : 0,
      profit: pnl.cm2 - spend,
      breakEvenRoas: pnl.cm2 > 0 ? pnl.netSales / pnl.cm2 : Infinity,
      overReporting: pnl.grossSales ? pv / pnl.grossSales - 1 : 0,
      cpcTrend: cpcRest ? cpcLast / cpcRest - 1 : 0,
      profitLast7: cm2Win(last7) - lastSpend,
      profitPrev7: cm2Win(prev7) - sumWin(prev7, (r) => r.spend),
      topProducts: [...sales.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, v]) => ({ id, title: productsById.get(id)?.title ?? id, share: v / salesTotal })),
    };
  }).sort((a, b) => b.spend - a.spend);

  const channels: ChannelRow[] = [...channelPnl.entries()].map(([channel, p]) => ({ channel, ...finish(p) })).sort((a, b) => b.netSales - a.netSales);

  const days = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) d.cm3 = d.cm2 - d.adSpend;

  // Previous period of equal length, only when data covers it
  const len = rangeLength(range);
  const prevRange = shiftRange(range, -len);
  const earliest = ds.orders.reduce((m, o) => (o.date < m ? o.date : m), range.from);
  const previous = prevRange.from >= earliest ? summarize(ds, prevRange, costs, productsById) : undefined;

  return { range, currency: ds.currency, totals: finish(totals), previous, products, campaigns, channels, daily: days, unattributedSpend, costs };
}
