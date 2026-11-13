/**
 * Canonical data model.
 *
 * Every connector maps its source API into these shapes. The profit engine,
 * the insight detectors and the AI tools only ever see this model, never a
 * vendor payload. Adding GA4, TikTok or Merchant Center means writing one
 * connector that emits these rows - nothing downstream changes.
 *
 * All money is in the store currency (CHF), net of VAT.
 */

export type ISODate = string; // "2026-11-13"

export type AdPlatform = "google_ads" | "meta" | "tiktok" | "microsoft_ads";

/** Where an order came from, resolved from UTM / click ids by the commerce connector. */
export type ChannelKey = AdPlatform | "organic" | "email" | "direct" | "referral";

export interface Product {
  id: string;
  sku: string;
  title: string;
  brand: string;
  category: string;
  /** Current list price, net. */
  price: number;
  /** Landed unit cost (purchase price + inbound freight + duties). */
  unitCost: number;
  inventory: number;
  /** Average units sold per day, used for days-of-cover. Filled by the engine if absent. */
  velocity?: number;
}

export interface OrderLine {
  productId: string;
  qty: number;
  /** Net unit price actually charged after discounts. */
  unitPrice: number;
  /** Discount per unit, net. */
  discount: number;
}

export interface Refund {
  productId: string;
  qty: number;
  amount: number;
  date: ISODate;
}

export interface Order {
  id: string;
  date: ISODate;
  channel: ChannelKey;
  /** Platform campaign id when the click is attributable (UTM / gclid / fbclid). */
  campaignId?: string;
  country: string;
  lines: OrderLine[];
  shippingCharged: number;
  /** Carrier cost actually paid. */
  shippingCost: number;
  refunds: Refund[];
  customerType: "new" | "returning";
}

/** One row per campaign per day, as reported by the ad platform. */
export interface AdSpendRow {
  date: ISODate;
  platform: AdPlatform;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** What the platform claims. Compared against Shopify truth by the engine. */
  platformConversions: number;
  platformConversionValue: number;
  dailyBudget?: number;
  /** Share of impressions lost because of budget (Google Ads). 0..1 */
  lostImpressionShareBudget?: number;
}

/** Traffic & behaviour (GA4). Optional in the PoC. */
export interface TrafficRow {
  date: ISODate;
  source: ChannelKey;
  sessions: number;
  engagedSessions: number;
  addToCarts: number;
  checkouts: number;
  purchases: number;
}

export interface Dataset {
  currency: string;
  products: Product[];
  orders: Order[];
  adSpend: AdSpendRow[];
  traffic: TrafficRow[];
  /** Which connector delivered what, for the UI and for the AI's answers. */
  sources: SourceStatus[];
  generatedAt: string;
}

export interface SourceStatus {
  id: string;
  label: string;
  kind: "commerce" | "ads" | "analytics" | "feed";
  state: "connected" | "demo" | "planned" | "error";
  detail?: string;
  rows?: number;
}

/**
 * Costs that live outside the source systems. In production these come from
 * the ERP / a settings screen; in the PoC from env or defaults.
 */
export interface CostConfig {
  paymentFeePct: number;
  paymentFeeFixed: number;
  pickPackPerOrder: number;
  returnHandlingPerUnit: number;
  /** Share of a returned unit that can be resold (0..1). Rest is written off at cost. */
  returnResaleRate: number;
}

export const DEFAULT_COSTS: CostConfig = {
  paymentFeePct: 0.029,
  paymentFeeFixed: 0.3,
  pickPackPerOrder: 3.2,
  returnHandlingPerUnit: 6.5,
  returnResaleRate: 0.6,
};

export interface DateRange {
  from: ISODate;
  to: ISODate;
}
