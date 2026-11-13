/**
 * Meta (Facebook/Instagram) connector: campaign x day insights.
 * Live mode calls the Marketing API Insights edge with a system-user token
 * (permission: ads_read).
 */
import type { Connector, ConnectorSlice } from "../core/connector.ts";
import type { AdSpendRow, DateRange } from "../core/types.ts";
import { demoWorld, inRange } from "./demo-cache.ts";

const API_VERSION = process.env.META_API_VERSION ?? "v23.0";
const PURCHASE = new Set(["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"]);

export class MetaConnector implements Connector {
  id = "meta";
  label = "Meta Ads";
  kind = "ads" as const;

  isConfigured() {
    return process.env.DATA_MODE === "live" && !!process.env.META_AD_ACCOUNT_ID && !!process.env.META_ACCESS_TOKEN;
  }

  async fetch(range: DateRange): Promise<ConnectorSlice> {
    if (!this.isConfigured()) {
      return { adSpend: demoWorld(range).adSpend.filter((r) => r.platform === "meta" && inRange(r.date, range)) };
    }
    const params = new URLSearchParams({
      level: "campaign",
      time_increment: "1",
      fields: "campaign_id,campaign_name,objective,spend,impressions,clicks,actions,action_values",
      time_range: JSON.stringify({ since: range.from, until: range.to }),
      limit: "500",
      access_token: process.env.META_ACCESS_TOKEN!,
    });
    let url: string | undefined = `https://graph.facebook.com/${API_VERSION}/${process.env.META_AD_ACCOUNT_ID}/insights?${params}`;
    const rows: AdSpendRow[] = [];
    const sumPurchases = (list?: Array<{ action_type: string; value: string }>) =>
      Math.max(0, ...(list ?? []).filter((a) => PURCHASE.has(a.action_type)).map((a) => Number(a.value)));
    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { data: any[]; paging?: { next?: string } };
      for (const r of body.data) {
        rows.push({
          date: r.date_start,
          platform: "meta",
          campaignId: `meta-${r.campaign_id}`,
          campaignName: r.campaign_name,
          campaignType: r.objective ?? "",
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          platformConversions: sumPurchases(r.actions),
          platformConversionValue: sumPurchases(r.action_values),
        });
      }
      url = body.paging?.next;
    }
    return { adSpend: rows };
  }
}
