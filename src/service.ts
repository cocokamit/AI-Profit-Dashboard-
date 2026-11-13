/**
 * Application service: loads the sources, keeps a short-lived cache and
 * computes analysis + insights for a requested window. The HTTP server and
 * the monitor job both go through here.
 */
import { createRegistry } from "./connectors/index.ts";
import { analyze, type Analysis } from "./engine/profit.ts";
import { detectInsights, type Insight } from "./engine/insights.ts";
import { DEFAULT_COSTS, type CostConfig, type Dataset } from "./core/types.ts";
import { addDays, isoDay } from "./connectors/demo-data.ts";
import type { Lang } from "./i18n/index.ts";

const registry = createRegistry();
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; ds: Dataset } | undefined;

export function costConfig(): CostConfig {
  const n = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
  return {
    paymentFeePct: n("PAYMENT_FEE_PCT", DEFAULT_COSTS.paymentFeePct),
    paymentFeeFixed: n("PAYMENT_FEE_FIXED", DEFAULT_COSTS.paymentFeeFixed),
    pickPackPerOrder: n("PICK_PACK_PER_ORDER", DEFAULT_COSTS.pickPackPerOrder),
    returnHandlingPerUnit: n("RETURN_HANDLING_PER_UNIT", DEFAULT_COSTS.returnHandlingPerUnit),
    returnResaleRate: n("RETURN_RESALE_RATE", DEFAULT_COSTS.returnResaleRate),
  };
}

/** Yesterday is the last complete day. */
export function lastCompleteDay(): string {
  return addDays(isoDay(new Date()), -1);
}

export async function getDataset(force = false): Promise<Dataset> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.ds;
  const to = lastCompleteDay();
  // 180 days: enough for a 90-day view plus its comparison period.
  const ds = await registry.load({ from: addDays(to, -179), to });
  cached = { at: Date.now(), ds };
  return ds;
}

export async function getAnalysis(days: number, force = false, lang: Lang = "en"): Promise<{ ds: Dataset; analysis: Analysis; insights: Insight[] }> {
  const ds = await getDataset(force);
  const to = lastCompleteDay();
  const analysis = analyze(ds, { from: addDays(to, -(days - 1)), to }, costConfig());
  return { ds, analysis, insights: detectInsights(analysis, ds, lang) };
}
