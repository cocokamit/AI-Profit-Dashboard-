import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDemoData, addDays } from "../src/connectors/demo-data.ts";
import { analyze } from "../src/engine/profit.ts";
import { detectInsights } from "../src/engine/insights.ts";
import { TOOLS, runTool } from "../src/ai/tools.ts";
import { DEFAULT_COSTS, type Dataset, type Order } from "../src/core/types.ts";

const TO = "2026-11-12";
const world = generateDemoData(TO, 180);
const ds: Dataset = { currency: "CHF", ...world, sources: [], generatedAt: "" };
const range = { from: addDays(TO, -29), to: TO };
const a = analyze(ds, range, DEFAULT_COSTS);

const close = (x: number, y: number, eps = 0.01) => assert.ok(Math.abs(x - y) < eps, `${x} != ${y}`);

test("P&L identities hold", () => {
  const t = a.totals;
  close(t.netSales, t.grossSales - t.refunds);
  close(t.cm2, t.netSales - t.cogs - t.shipping - t.pickPack - t.paymentFees - t.returnHandling);
  close(t.cm3, t.cm2 - t.adSpend);
});

test("products and channels add up to the store total", () => {
  const sum = (k: "netSales" | "cm2" | "cm3") => a.products.reduce((s, p) => s + p[k], 0);
  close(sum("netSales"), a.totals.netSales, 0.5);
  close(sum("cm2"), a.totals.cm2, 0.5);
  // every franc of ad spend is either allocated to a product or reported as unattributed
  close(sum("cm3") - a.unattributedSpend, a.totals.cm3, 0.5);
  close(a.channels.reduce((s, c) => s + c.cm3, 0), a.totals.cm3, 0.5);
});

test("one hand-checked order", () => {
  const order: Order = {
    id: "#1", date: "2026-01-01", channel: "organic", country: "CH", customerType: "new",
    lines: [{ productId: "x", qty: 2, unitPrice: 50, discount: 0 }],
    shippingCharged: 0, shippingCost: 8, refunds: [{ productId: "x", qty: 1, amount: 50, date: "2026-01-05" }],
  };
  const one: Dataset = { currency: "CHF", products: [{ id: "x", sku: "x", title: "X", brand: "B", category: "C", price: 50, unitCost: 20, inventory: 10 }], orders: [order], adSpend: [], traffic: [], sources: [], generatedAt: "" };
  const t = analyze(one, { from: "2026-01-01", to: "2026-01-01" }, DEFAULT_COSTS).totals;
  close(t.netSales, 50);
  close(t.cogs, 20 + 20 * (1 - DEFAULT_COSTS.returnResaleRate)); // kept unit + written-off share of the return
  close(t.paymentFees, 100 * DEFAULT_COSTS.paymentFeePct + DEFAULT_COSTS.paymentFeeFixed); // fees are not refunded
  close(t.returnHandling, DEFAULT_COSTS.returnHandlingPerUnit);
});

test("detectors find the planted problems", () => {
  const ids = detectInsights(a, ds).map((i) => i.id);
  for (const id of ["campaign-loss-meta-2001", "campaign-loss-meta-2003", "campaign-scale-gads-1002", "cpc-spike-gads-1003", "product-loss-p01", "product-loss-p19", "stockout-p07", "attribution-meta"]) {
    assert.ok(ids.includes(id), `missing ${id} in ${ids.join(", ")}`);
  }
});

test("every AI tool runs and returns JSON-serialisable data", () => {
  const ctx = { analysis: a, insights: detectInsights(a, ds), dataset: ds };
  const inputs: Record<string, Record<string, unknown>> = { get_product_detail: { query: "dyson v11" }, simulate_budget_change: { campaign: "Brand", new_daily_budget: 60 } };
  for (const t of TOOLS) assert.doesNotThrow(() => JSON.stringify(runTool(ctx, t.name, inputs[t.name] ?? {})), t.name);
  const sim = runTool(ctx, "simulate_budget_change", { campaign: "Prospecting", new_daily_budget: 0 }) as { monthly_profit_change: number };
  assert.ok(sim.monthly_profit_change > 0, "pausing a loss-making campaign must improve profit");
});

test("offline answers cover the standard questions", async () => {
  const { answerOffline } = await import("../src/ai/offline.ts");
  const insights = detectInsights(a, ds);
  const ctx = { analysis: a, insights, dataset: ds };
  assert.match(answerOffline("Which products are the most profitable after deducting all costs?", ctx), /most profitable product/);
  assert.match(answerOffline("Where are we currently losing money?", ctx), /per month\*\* in/);
  assert.match(answerOffline("Which marketing budgets should we optimize?", ctx), /Cut .*Prospecting/);
  assert.match(answerOffline("Was sollten wir diese Woche als Erstes tun?", ctx), /Massnahmen/);
  assert.match(answerOffline(`Explain this finding: "${insights[0]!.title}"`, ctx), /Next step/);
});
