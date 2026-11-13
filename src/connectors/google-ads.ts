/**
 * Google Ads connector: campaign x day performance, budget and lost IS.
 * Live mode calls googleAds:searchStream (REST) with an OAuth access token
 * and developer token. Token refresh belongs in a small auth helper/secret
 * manager in production; the PoC reads a ready access token from env.
 */
import type { Connector, ConnectorSlice } from "../core/connector.ts";
import type { AdSpendRow, DateRange } from "../core/types.ts";
import { demoWorld, inRange } from "./demo-cache.ts";

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v21";

export class GoogleAdsConnector implements Connector {
  id = "google_ads";
  label = "Google Ads";
  kind = "ads" as const;

  isConfigured() {
    return process.env.DATA_MODE === "live" && !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN && !!process.env.GOOGLE_ADS_CUSTOMER_ID && !!process.env.GOOGLE_ADS_ACCESS_TOKEN;
  }

  async fetch(range: DateRange): Promise<ConnectorSlice> {
    if (!this.isConfigured()) {
      return { adSpend: demoWorld(range).adSpend.filter((r) => r.platform === "google_ads" && inRange(r.date, range)) };
    }
    const cid = process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, "");
    const query = `SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type,
        campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks,
        metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share
      FROM campaign WHERE segments.date BETWEEN '${range.from}' AND '${range.to}' AND metrics.cost_micros > 0`;
    const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${cid}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GOOGLE_ADS_ACCESS_TOKEN}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "") } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Google Ads ${res.status}: ${await res.text()}`);
    const batches = (await res.json()) as Array<{ results?: any[] }>;
    const rows: AdSpendRow[] = [];
    for (const b of batches) for (const r of b.results ?? []) {
      rows.push({
        date: r.segments.date,
        platform: "google_ads",
        campaignId: `gads-${r.campaign.id}`,
        campaignName: r.campaign.name,
        campaignType: r.campaign.advertisingChannelType,
        spend: Number(r.metrics.costMicros ?? 0) / 1e6,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        platformConversions: Number(r.metrics.conversions ?? 0),
        platformConversionValue: Number(r.metrics.conversionsValue ?? 0),
        dailyBudget: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1e6 : undefined,
        lostImpressionShareBudget: Number(r.metrics.searchBudgetLostImpressionShare ?? 0),
      });
    }
    return { adSpend: rows };
  }
}
