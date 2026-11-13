/**
 * Deterministic demo dataset for a Swiss spare-parts shop.
 *
 * Used when a connector has no credentials (and by the hosted demo). It is a
 * simulation, not random noise: ad spend drives clicks, clicks drive orders,
 * orders drive returns, and the platforms over-report conversions the way
 * they do in reality. A handful of real-world problems are planted so the
 * insight engine and the AI have something true to find:
 *
 *  - a replica Dyson battery with a 24% return rate pushed by a Meta catalog campaign
 *  - Meta prospecting that looks fine in Ads Manager (ROAS ~2.4) but loses money
 *  - a brand search campaign capped by budget while it earns 6x its cost
 *  - a CPC spike on generic search in the last 12 days
 *  - a top seller with 3 days of stock left that is still being advertised
 *  - a Kärcher battery sold at a discount so deep it loses money on every unit
 *
 * Browser-safe: no Node imports. Same code powers the server and the hosted demo.
 */
import type { AdPlatform, AdSpendRow, ChannelKey, Order, OrderLine, Product, TrafficRow } from "../core/types.ts";

interface DemoProduct extends Product {
  returnRate: number;
  /** organic orders/day weight */
  popularity: number;
  /** share of units sold with a discount, and the discount depth */
  discountShare: number;
  discountDepth: number;
  multiQty?: boolean;
}

interface DemoCampaign {
  id: string;
  platform: AdPlatform;
  name: string;
  type: string;
  budget: number;
  cpc: number;
  cvr: number;
  /** platform over-reporting factor vs Shopify truth */
  inflation: number;
  mix: Record<string, number>;
  lostIsBudget?: number;
  /** optional CPC multiplier for the last N days */
  cpcShock?: { days: number; factor: number };
  ctr: number;
}

const P = (
  id: string, sku: string, title: string, brand: string, category: string,
  price: number, unitCost: number, inventory: number, returnRate: number, popularity: number,
  discountShare = 0.1, discountDepth = 0.1, multiQty = false,
): DemoProduct => ({ id, sku, title, brand, category, price, unitCost, inventory, returnRate, popularity, discountShare, discountDepth, multiQty });

export const DEMO_PRODUCTS: DemoProduct[] = [
  P("p01", "DY-V11-BAT-R", "Dyson V11 Akku 4000 mAh (Nachbau)", "Dyson", "Staubsauger", 59.0, 31.5, 420, 0.24, 1.0),
  P("p02", "DY-V10-FLT", "Dyson V10 Filter waschbar", "Dyson", "Staubsauger", 19.9, 5.1, 880, 0.03, 1.6, 0.1, 0.1, true),
  P("p03", "MI-FJM-10", "Miele Staubsaugerbeutel FJM 10 Stk.", "Miele", "Staubsauger", 24.9, 9.8, 1500, 0.01, 3.2, 0.1, 0.1, true),
  P("p04", "MI-GSD-PMP", "Miele Geschirrspüler Umwälzpumpe", "Miele", "Geschirrspüler", 189.0, 92.0, 60, 0.04, 0.35),
  P("p05", "BO-SMS-LP", "Bosch SMS Laugenpumpe 00620774", "Bosch", "Geschirrspüler", 49.0, 29.5, 310, 0.09, 1.1),
  P("p06", "BO-SMS-DIC", "Bosch Türdichtung Geschirrspüler", "Bosch", "Geschirrspüler", 29.9, 8.4, 540, 0.03, 0.9),
  P("p07", "JU-BG-DIC", "Jura Brühgruppe Dichtungsset", "Jura", "Kaffeemaschine", 24.9, 6.2, 14, 0.02, 1.9),
  P("p08", "JU-CLR-6", "Jura Claris Smart Filterpatrone 3er", "Jura", "Kaffeemaschine", 54.9, 31.0, 720, 0.02, 1.7, 0.15, 0.1, true),
  P("p09", "NE-ENT-2", "Nespresso Entkalker 2er-Pack", "Nespresso", "Kaffeemaschine", 17.9, 6.9, 2100, 0.01, 2.4, 0.1, 0.1, true),
  P("p10", "DE-ECAM-BG", "De'Longhi ECAM Brühgruppe", "De'Longhi", "Kaffeemaschine", 79.0, 38.0, 140, 0.07, 0.6),
  P("p11", "SI-KS-DIC", "Siemens Kühlschrank Türdichtung 1080mm", "Siemens", "Kühlen", 69.0, 22.0, 190, 0.08, 0.5),
  P("p12", "VZ-BO-LMP", "V-Zug Backofenlampe 25W 300°C", "V-Zug", "Backen", 14.9, 2.9, 1300, 0.02, 1.4),
  P("p13", "VZ-BO-DIC", "V-Zug Backofen Türdichtung", "V-Zug", "Backen", 46.0, 12.5, 210, 0.03, 0.45),
  P("p14", "EL-WM-KB", "Electrolux Waschmaschine Kohlebürsten", "Electrolux", "Waschen", 21.9, 4.8, 610, 0.04, 0.8),
  P("p15", "SA-WM-STO", "Samsung Waschmaschine Stossdämpfer 2 Stk.", "Samsung", "Waschen", 34.9, 11.2, 330, 0.05, 0.7),
  P("p16", "SC-TR-RIE", "Schulthess Trockner Antriebsriemen", "Schulthess", "Waschen", 39.0, 9.9, 260, 0.03, 0.4),
  P("p17", "PH-SC-BK4", "Philips Sonicare Bürstenköpfe 4 Stk.", "Philips", "Körperpflege", 29.9, 14.5, 980, 0.02, 2.0, 0.25, 0.15, true),
  P("p18", "BR-S9-SK", "Braun Series 9 Scherkopf 92S", "Braun", "Körperpflege", 49.9, 27.0, 400, 0.04, 0.9, 0.2, 0.1),
  P("p19", "KA-36V-AK", "Kärcher Battery Power+ 36V Akku", "Kärcher", "Garten", 119.0, 78.0, 160, 0.06, 0.55, 0.85, 0.27),
  P("p20", "KA-HD-DUE", "Kärcher Hochdruck Dreckfräser", "Kärcher", "Garten", 39.9, 15.0, 350, 0.03, 0.6),
  P("p21", "GA-MÄ-MES", "Gardena Mähroboter Ersatzmesser 9 Stk.", "Gardena", "Garten", 22.9, 6.1, 780, 0.02, 0.9, 0.1, 0.1, true),
  P("p22", "TH-TM6-DIC", "Thermomix TM6 Dichtring Messer", "Vorwerk", "Küche", 16.9, 3.2, 950, 0.02, 1.2),
  P("p23", "KI-KM-RUE", "KitchenAid Rührbesen Edelstahl", "KitchenAid", "Küche", 44.9, 16.8, 230, 0.04, 0.5),
  P("p24", "IR-RB-BUE", "iRobot Roomba Seitenbürsten 6 Stk.", "iRobot", "Staubsauger", 19.9, 4.2, 870, 0.03, 1.1, 0.1, 0.1, true),
];

export const DEMO_CAMPAIGNS: DemoCampaign[] = [
  {
    id: "gads-1001", platform: "google_ads", name: "PMax – Haushaltsgeräte Ersatzteile", type: "Performance Max",
    budget: 260, cpc: 0.52, cvr: 0.031, inflation: 1.18, ctr: 0.012,
    mix: { p07: 5, p03: 3, p09: 2, p06: 2, p11: 1.5, p12: 1.5, p14: 1.5, p15: 1, p16: 1, p22: 2, p24: 1, p10: 1, p02: 1, p05: 1 },
  },
  {
    id: "gads-1002", platform: "google_ads", name: "Search – Brand Ersatzteilstore", type: "Search",
    budget: 40, cpc: 0.24, cvr: 0.088, inflation: 1.05, ctr: 0.21, lostIsBudget: 0.41,
    mix: { p03: 2, p09: 2, p07: 1, p08: 1, p17: 1, p12: 1, p06: 1, p04: 0.5, p13: 0.5 },
  },
  {
    id: "gads-1003", platform: "google_ads", name: "Search – Generic Ersatzteile", type: "Search",
    budget: 180, cpc: 1.08, cvr: 0.058, inflation: 1.12, ctr: 0.045, cpcShock: { days: 12, factor: 1.85 },
    mix: { p05: 1, p06: 1, p11: 1, p14: 1, p15: 1, p16: 1, p10: 1, p13: 1, p20: 1, p23: 0.5 },
  },
  {
    id: "gads-1004", platform: "google_ads", name: "Shopping – Miele & V-Zug", type: "Shopping",
    budget: 90, cpc: 0.44, cvr: 0.036, inflation: 1.1, ctr: 0.016, lostIsBudget: 0.33,
    mix: { p04: 1.2, p03: 3, p13: 2, p12: 2 },
  },
  {
    id: "meta-2001", platform: "meta", name: "Prospecting – Broad CH", type: "Advantage+ Shopping",
    budget: 220, cpc: 0.55, cvr: 0.018, inflation: 1.7, ctr: 0.011,
    mix: { p05: 3, p19: 2, p18: 1.5, p17: 1, p23: 1, p10: 1, p21: 1 },
  },
  {
    id: "meta-2002", platform: "meta", name: "Retargeting – Warenkorb 7 Tage", type: "Retargeting",
    budget: 70, cpc: 0.61, cvr: 0.047, inflation: 1.35, ctr: 0.018,
    mix: { p03: 1, p08: 1, p09: 1, p17: 1, p18: 1, p02: 1, p21: 1, p22: 1 },
  },
  {
    id: "meta-2003", platform: "meta", name: "Catalog – Dyson Akkus", type: "Catalog Sales",
    budget: 120, cpc: 0.66, cvr: 0.024, inflation: 1.4, ctr: 0.014,
    mix: { p01: 6, p02: 1 },
  },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

export interface DemoData {
  products: Product[];
  orders: Order[];
  adSpend: AdSpendRow[];
  traffic: TrafficRow[];
}

/**
 * @param endDate last day of data (inclusive), usually yesterday
 * @param days    history length
 */
export function generateDemoData(endDate: string, days = 90, seed = 4207): DemoData {
  const rnd = mulberry32(seed);
  const poisson = (lambda: number) => {
    // Knuth for small lambda, normal approx for large
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
  };
  const gauss = () => {
    const u = Math.max(rnd(), 1e-9);
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pickWeighted = (weights: Record<string, number>): string => {
    const entries = Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = rnd() * total;
    for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
    return entries[entries.length - 1]![0];
  };

  const byId = new Map(DEMO_PRODUCTS.map((p) => [p.id, p]));
  const popularity = Object.fromEntries(DEMO_PRODUCTS.map((p) => [p.id, p.popularity]));
  const start = addDays(endDate, -(days - 1));

  const orders: Order[] = [];
  const adSpend: AdSpendRow[] = [];
  const traffic: TrafficRow[] = [];
  let orderSeq = 100000;

  const makeOrder = (date: string, channel: ChannelKey, campaignId: string | undefined, mix: Record<string, number>): Order => {
    const nLines = rnd() < 0.22 ? 2 : 1;
    const lines: OrderLine[] = [];
    for (let i = 0; i < nLines; i++) {
      const pid = i === 0 ? pickWeighted(mix) : pickWeighted(popularity);
      const p = byId.get(pid)!;
      const qty = p.multiQty && rnd() < 0.3 ? 2 : 1;
      const discounted = rnd() < p.discountShare;
      const discount = discounted ? r2(p.price * p.discountDepth) : 0;
      lines.push({ productId: pid, qty, unitPrice: r2(p.price - discount), discount });
    }
    const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const shippingCharged = gross >= 50 ? 0 : 7.9;
    const shippingCost = r2(7.4 + rnd() * 2.2);
    const refunds = [];
    for (const l of lines) {
      const p = byId.get(l.productId)!;
      if (rnd() < p.returnRate) {
        refunds.push({ productId: l.productId, qty: l.qty, amount: r2(l.unitPrice * l.qty), date: addDays(date, 4 + Math.floor(rnd() * 12)) });
      }
    }
    return {
      id: `#${orderSeq++}`,
      date,
      channel,
      campaignId,
      country: rnd() < 0.93 ? "CH" : "LI",
      lines,
      shippingCharged,
      shippingCost,
      refunds,
      customerType: channel === "email" || rnd() < 0.28 ? "returning" : "new",
    };
  };

  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    const weekday = dow === 0 ? 0.8 : dow === 6 ? 0.88 : dow === 1 ? 1.12 : 1;
    const growth = 0.92 + (d / days) * 0.16;
    const daysLeft = days - d;

    // Paid
    for (const c of DEMO_CAMPAIGNS) {
      const limited = c.lostIsBudget !== undefined;
      const spend = r2(c.budget * (limited ? 0.97 + rnd() * 0.05 : 0.82 + rnd() * 0.22) * (limited ? 1 : weekday));
      const shock = c.cpcShock && daysLeft <= c.cpcShock.days ? c.cpcShock.factor : 1;
      const cpc = c.cpc * shock * (0.9 + rnd() * 0.2);
      const clicks = Math.max(1, Math.round(spend / cpc));
      const n = poisson(clicks * c.cvr * weekday);
      let attributedRevenue = 0;
      for (let i = 0; i < n; i++) {
        const o = makeOrder(date, c.platform, c.id, c.mix);
        attributedRevenue += o.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
        orders.push(o);
      }
      adSpend.push({
        date,
        platform: c.platform,
        campaignId: c.id,
        campaignName: c.name,
        campaignType: c.type,
        spend,
        impressions: Math.round(clicks / c.ctr),
        clicks,
        platformConversions: r2(n * c.inflation * (0.9 + rnd() * 0.2)),
        platformConversionValue: r2(attributedRevenue * c.inflation * (0.9 + rnd() * 0.2)),
        dailyBudget: c.budget,
        lostImpressionShareBudget: c.lostIsBudget !== undefined ? r2(c.lostIsBudget * (0.85 + rnd() * 0.3)) : 0,
      });
    }

    // Unpaid
    const unpaid: [ChannelKey, number][] = [["organic", 34], ["direct", 14], ["email", 9], ["referral", 3]];
    for (const [channel, base] of unpaid) {
      const n = poisson(base * weekday * growth);
      for (let i = 0; i < n; i++) orders.push(makeOrder(date, channel, undefined, popularity));
    }
  }

  // GA4-style traffic, derived from orders per source
  const perDaySource = new Map<string, number>();
  for (const o of orders) perDaySource.set(`${o.date}|${o.channel}`, (perDaySource.get(`${o.date}|${o.channel}`) ?? 0) + 1);
  for (const [key, purchases] of perDaySource) {
    const [date, source] = key.split("|") as [string, ChannelKey];
    const cr = source === "meta" ? 0.011 : source === "email" ? 0.045 : 0.026;
    const sessions = Math.round(purchases / cr);
    traffic.push({
      date, source, sessions,
      engagedSessions: Math.round(sessions * (source === "meta" ? 0.38 : 0.61)),
      addToCarts: Math.round(sessions * 0.071),
      checkouts: Math.round(purchases * 1.9),
      purchases,
    });
  }

  // Inventory snapshot: product velocity over the last 14 days
  const products: Product[] = DEMO_PRODUCTS.map(({ returnRate: _r, popularity: _p, discountShare: _s, discountDepth: _d, multiQty: _m, ...p }) => ({ ...p }));

  return { products, orders, adSpend, traffic };
}
