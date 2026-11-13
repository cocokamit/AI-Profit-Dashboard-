/**
 * Google Analytics 4 connector: sessions and funnel per source/day.
 * Shows how a new source plugs in: it only emits TrafficRow[]; the engine and
 * the AI pick it up without changes. Live mode uses the Data API runReport.
 */
import type { Connector, ConnectorSlice } from "../core/connector.ts";
import type { DateRange, TrafficRow } from "../core/types.ts";
import { classifyChannel } from "./shopify.ts";
import { demoWorld, inRange } from "./demo-cache.ts";

export class GA4Connector implements Connector {
  id = "ga4";
  label = "Google Analytics 4";
  kind = "analytics" as const;

  isConfigured() {
    return process.env.DATA_MODE === "live" && !!process.env.GA4_PROPERTY_ID && !!process.env.GA4_ACCESS_TOKEN;
  }

  async fetch(range: DateRange): Promise<ConnectorSlice> {
    if (!this.isConfigured()) return { traffic: demoWorld(range).traffic.filter((t) => inRange(t.date, range)) };
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GA4_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: range.from, endDate: range.to }],
        dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "addToCarts" }, { name: "checkouts" }, { name: "ecommercePurchases" }],
        limit: 100000,
      }),
    });
    if (!res.ok) throw new Error(`GA4 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { rows?: Array<{ dimensionValues: { value: string }[]; metricValues: { value: string }[] }> };
    const traffic: TrafficRow[] = (body.rows ?? []).map((r) => {
      const [d, src, med] = r.dimensionValues.map((v) => v.value) as [string, string, string];
      const [sessions, engaged, atc, co, purchases] = r.metricValues.map((v) => Number(v.value)) as number[];
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        source: classifyChannel(src, med),
        sessions: sessions!, engagedSessions: engaged!, addToCarts: atc!, checkouts: co!, purchases: purchases!,
      };
    });
    return { traffic };
  }
}
