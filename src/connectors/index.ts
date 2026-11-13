import { ConnectorRegistry } from "../core/connector.ts";
import { ShopifyConnector } from "./shopify.ts";
import { GoogleAdsConnector } from "./google-ads.ts";
import { MetaConnector } from "./meta.ts";
import { GA4Connector } from "./ga4.ts";

/** The one place where sources are wired up. Adding a source = one line here. */
export function createRegistry(): ConnectorRegistry {
  return new ConnectorRegistry()
    .register(new ShopifyConnector())
    .register(new GoogleAdsConnector())
    .register(new MetaConnector())
    .register(new GA4Connector())
    .plan({ id: "merchant_center", label: "Merchant Center", kind: "feed", detail: "Feed status, disapprovals, price benchmarks" })
    .plan({ id: "tiktok", label: "TikTok Ads", kind: "ads", detail: "Same AdSpendRow mapping as Meta" });
}
