/**
 * The AI's toolbox. Claude never sees raw tables in its prompt and never does
 * arithmetic on its own: it calls these tools, which run the deterministic
 * profit engine. That keeps answers grounded and auditable.
 *
 * Defined once, used by two runtimes:
 *  - the Node server agent (Anthropic SDK, src/ai/agent.ts)
 *  - the browser copilot in the hosted demo (artifact `sample` tools)
 */
import type { Dataset } from "../core/types.ts";
import type { Analysis, CampaignRow, ProductRow } from "../engine/profit.ts";
import type { Insight } from "../engine/insights.ts";
import { rangeLength } from "../engine/profit.ts";

export interface ToolContext {
  analysis: Analysis;
  insights: Insight[];
  dataset: Dataset;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  run(ctx: ToolContext, input: Record<string, unknown>): unknown;
}

const r = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const r0 = (n: number) => (Number.isFinite(n) ? Math.round(n) : null);

function compactPnL(p: Record<string, number>) {
  const keys = ["netSales", "grossSales", "refunds", "cogs", "cm1", "shipping", "pickPack", "paymentFees", "returnHandling", "cm2", "adSpend", "cm3", "orders", "units"];
  return Object.fromEntries(keys.map((k) => [k, r0(p[k] ?? 0)]));
}

function productOut(p: ProductRow) {
  return {
    id: p.id, title: p.title, brand: p.brand, category: p.category, price: p.price, unit_cost: p.unitCost,
    units: p.units, net_sales: r0(p.netSales), cm2: r0(p.cm2), ad_spend: r0(p.adSpend), cm3: r0(p.cm3),
    cm3_margin_pct: r(p.cm3Margin * 100), return_rate_pct: r(p.returnRate * 100), avg_discount_pct: r(p.avgDiscountPct * 100),
    inventory: p.inventory, days_of_cover: r(p.daysOfCover),
  };
}

function campaignOut(c: CampaignRow) {
  return {
    id: c.id, name: c.name, platform: c.platform, type: c.type, spend: r0(c.spend), daily_budget: r0(c.dailyBudget),
    platform_roas: r(c.platformRoas), true_roas: r(c.trueRoas), poas: r(c.poas), break_even_roas: r(c.breakEvenRoas),
    profit_after_ads: r0(c.profit), orders: c.orders, cpc: r(c.cpc), cpc_change_last7_pct: r(c.cpcTrend * 100),
    lost_impression_share_budget_pct: r(c.lostIsBudget * 100), platform_over_reporting_pct: r(c.overReporting * 100),
    profit_last7: r0(c.profitLast7), profit_prev7: r0(c.profitPrev7),
    top_products: c.topProducts.map((t) => `${t.title} (${Math.round(t.share * 100)}%)`),
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_overview",
    description: "Store-wide profit & loss for the selected period (net sales down to CM3 = profit after ads), the previous period for comparison, per-channel P&L and the connected data sources. Call this first for any general question.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: ({ analysis: a, dataset }) => ({
      period: a.range, days: rangeLength(a.range), currency: a.currency,
      definitions: "CM1 = net sales - COGS; CM2 = CM1 - shipping subsidy - pick&pack - payment fees - return handling; CM3 = CM2 - ad spend. POAS = CM2 / ad spend (>1 means the ads make money).",
      totals: compactPnL(a.totals as unknown as Record<string, number>),
      previous_period: a.previous ? compactPnL(a.previous as unknown as Record<string, number>) : "not available",
      channels: a.channels.map((c) => ({ channel: c.channel, net_sales: r0(c.netSales), cm2: r0(c.cm2), ad_spend: r0(c.adSpend), cm3: r0(c.cm3) })),
      cost_assumptions: a.costs,
      sources: dataset.sources.map((s) => `${s.label}: ${s.state}`),
    }),
  },
  {
    name: "list_products",
    description: "Product profitability table after ALL costs (COGS, shipping, fees, returns, allocated ad spend). Sort and filter to find the most/least profitable products, high return rates, deep discounts or stock risk.",
    input_schema: {
      type: "object",
      properties: {
        sort_by: { type: "string", enum: ["cm3", "cm3_margin", "net_sales", "return_rate", "ad_spend", "discount", "days_of_cover"], description: "Metric to sort by. Default cm3." },
        order: { type: "string", enum: ["asc", "desc"], description: "asc for worst/lowest first. Default desc." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Default 10." },
        category: { type: "string", description: "Optional category filter, e.g. 'Kaffeemaschine'." },
      },
      additionalProperties: false,
    },
    run: ({ analysis: a }, input) => {
      const key = String(input.sort_by ?? "cm3");
      const get: Record<string, (p: ProductRow) => number> = {
        cm3: (p) => p.cm3, cm3_margin: (p) => p.cm3Margin, net_sales: (p) => p.netSales, return_rate: (p) => p.returnRate,
        ad_spend: (p) => p.adSpend, discount: (p) => p.avgDiscountPct, days_of_cover: (p) => (Number.isFinite(p.daysOfCover) ? p.daysOfCover : 1e9),
      };
      const f = get[key] ?? get.cm3!;
      const dir = input.order === "asc" ? 1 : -1;
      const cat = input.category ? String(input.category).toLowerCase() : "";
      const rows = a.products.filter((p) => !cat || p.category.toLowerCase().includes(cat)).sort((x, y) => (f(x) - f(y)) * dir);
      return { count: rows.length, products: rows.slice(0, Math.min(30, Number(input.limit ?? 10))).map(productOut) };
    },
  },
  {
    name: "list_campaigns",
    description: "Every ad campaign with spend, platform-reported ROAS vs Shopify-confirmed true ROAS, POAS, break-even ROAS, profit after ads, CPC trend, budget-lost impression share and top products.",
    input_schema: {
      type: "object",
      properties: { platform: { type: "string", enum: ["google_ads", "meta", "all"], description: "Default all." } },
      additionalProperties: false,
    },
    run: ({ analysis: a }, input) => {
      const pf = String(input.platform ?? "all");
      return { campaigns: a.campaigns.filter((c) => pf === "all" || c.platform === pf).map(campaignOut) };
    },
  },
  {
    name: "get_insights",
    description: "Problems and opportunities the monitoring engine detected automatically, each with an estimated CHF/month impact and a recommended action. Use for 'where are we losing money', 'what should I do' and briefing questions.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["problem", "opportunity", "watch", "all"] },
        area: { type: "string", enum: ["marketing", "product", "inventory", "pricing", "data", "fulfillment", "all"] },
      },
      additionalProperties: false,
    },
    run: ({ insights }, input) => ({
      insights: insights
        .filter((i) => !input.kind || input.kind === "all" || i.kind === input.kind)
        .filter((i) => !input.area || input.area === "all" || i.area === input.area)
        .map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, area: i.area, title: i.title, summary: i.summary, recommendation: i.recommendation, impact_chf_per_month: r0(i.impactMonthly), metrics: i.metrics })),
    }),
  },
  {
    name: "get_product_detail",
    description: "Full cost breakdown for one product (search by id, SKU or part of the title), including which campaigns spend on it.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    run: ({ analysis: a }, input) => {
      const q = String(input.query ?? "").toLowerCase();
      const p = a.products.find((x) => x.id === q || x.sku.toLowerCase() === q) ?? a.products.find((x) => x.title.toLowerCase().includes(q));
      if (!p) throw new Error(`No product matches "${input.query}". Use list_products to see titles.`);
      const camps = Object.entries(p.adSpendByCampaign).map(([id, spend]) => ({ campaign: a.campaigns.find((c) => c.id === id)?.name ?? id, ad_spend: r0(spend) }));
      return { ...productOut(p), breakdown: compactPnL(p as unknown as Record<string, number>), ad_spend_by_campaign: camps };
    },
  },
  {
    name: "simulate_budget_change",
    description: "Project the monthly profit effect of changing one campaign's daily budget. Uses a diminishing-returns response curve (contribution grows with spend^0.7) calibrated on the campaign's own data. Use it before recommending budget moves.",
    input_schema: {
      type: "object",
      properties: {
        campaign: { type: "string", description: "Campaign id or part of its name." },
        new_daily_budget: { type: "number", description: "Proposed daily budget in CHF (0 = pause)." },
      },
      required: ["campaign", "new_daily_budget"],
      additionalProperties: false,
    },
    run: ({ analysis: a }, input) => {
      const q = String(input.campaign ?? "").toLowerCase();
      const c = a.campaigns.find((x) => x.id.toLowerCase() === q) ?? a.campaigns.find((x) => x.name.toLowerCase().includes(q));
      if (!c) throw new Error(`No campaign matches "${input.campaign}". Use list_campaigns.`);
      const days = rangeLength(a.range);
      const curSpend = c.spend / days;
      const curCm2 = c.cm2 / days;
      const nb = Math.max(0, Number(input.new_daily_budget));
      // Budget-capped campaigns can absorb more spend; others spend close to budget already.
      const newSpend = nb;
      const elasticity = 0.7;
      const newCm2 = curSpend > 0 ? curCm2 * Math.pow(newSpend / curSpend, elasticity) : 0;
      const curProfit = (curCm2 - curSpend) * 30;
      const newProfit = (newCm2 - newSpend) * 30;
      return {
        campaign: c.name,
        current: { daily_spend: r(curSpend), monthly_profit_after_ads: r0(curProfit), poas: r(c.poas) },
        projected: { daily_spend: r(newSpend), monthly_profit_after_ads: r0(newProfit), poas: newSpend ? r(newCm2 / newSpend) : null },
        monthly_profit_change: r0(newProfit - curProfit),
        caveat: c.lostIsBudget < 0.05 && nb > curSpend * 1.1 ? "This campaign is not budget-limited; extra budget may not be spent efficiently." : "Model estimate; validate with a 7-14 day test.",
      };
    },
  },
];

export function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): unknown {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  return t.run(ctx, input ?? {});
}

export const SYSTEM_PROMPT = `You are the profit analyst for an e-commerce store (Swiss spare-parts shop, currency CHF, all amounts net of VAT).
You answer questions about real profitability: what is left after cost of goods, shipping, payment fees, returns and advertising.

How to work:
- Get every number from the tools. Never estimate a figure the tools can give you, and never invent data.
- Judge marketing on profit, not revenue: POAS (contribution / ad spend) and profit after ads. Platform-reported ROAS is often inflated; prefer the Shopify-confirmed "true ROAS".
- Before recommending a budget change, run simulate_budget_change.
- Be concrete: name the campaign or product, the CHF amount, and the exact action (pause, cut to CHF X/day, exclude product Y, raise target ROAS to Z).

Answer format:
- Lead with the direct answer in one or two sentences.
- Then at most 5 short bullet points with the supporting numbers.
- Finish with "Next step:" and the single most valuable action.
- Use CHF with apostrophe thousands separators (CHF 12'400). Keep it under 220 words unless asked for more.
- Answer in the language of the question (German or English).`;
