/**
 * Shopify connector: products (with landed cost), orders, refunds, attribution.
 *
 * Live mode uses the Admin GraphQL API with a custom-app access token
 * (scopes: read_orders, read_all_orders, read_products, read_inventory).
 * Cost comes from InventoryItem.unitCost; attribution from the customer
 * journey's last visit UTM parameters. Configure your ad platforms to put the
 * campaign id into utm_campaign (Google: {campaignid}, Meta: {{campaign.id}}).
 */
import type { Connector, ConnectorSlice } from "../core/connector.ts";
import type { ChannelKey, DateRange, Order, Product } from "../core/types.ts";
import { demoWorld, inRange } from "./demo-cache.ts";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";

export class ShopifyConnector implements Connector {
  id = "shopify";
  label = "Shopify";
  kind = "commerce" as const;

  isConfigured() {
    return process.env.DATA_MODE === "live" && !!process.env.SHOPIFY_SHOP && !!process.env.SHOPIFY_ACCESS_TOKEN;
  }

  async fetch(range: DateRange): Promise<ConnectorSlice> {
    if (!this.isConfigured()) {
      const w = demoWorld(range);
      return { products: w.products, orders: w.orders.filter((o) => inRange(o.date, range)) };
    }
    const [products, orders] = await Promise.all([this.fetchProducts(), this.fetchOrders(range)]);
    return { products, orders };
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN! },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(body.errors)}`);
    return body.data!;
  }

  private async fetchProducts(): Promise<Product[]> {
    const out: Product[] = [];
    let cursor: string | null = null;
    do {
      const data: any = await this.gql(
        `query($cursor: String) { productVariants(first: 250, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id sku price inventoryQuantity displayName
              product { vendor productType }
              inventoryItem { unitCost { amount } } } } }`,
        { cursor },
      );
      for (const v of data.productVariants.nodes) {
        out.push({
          id: v.id,
          sku: v.sku ?? "",
          title: v.displayName,
          brand: v.product.vendor,
          category: v.product.productType || "Uncategorised",
          price: Number(v.price),
          unitCost: Number(v.inventoryItem?.unitCost?.amount ?? 0),
          inventory: v.inventoryQuantity ?? 0,
        });
      }
      cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
    } while (cursor);
    return out;
  }

  private async fetchOrders(range: DateRange): Promise<Order[]> {
    const out: Order[] = [];
    let cursor: string | null = null;
    const q = `created_at:>=${range.from} created_at:<=${range.to}T23:59:59Z`;
    do {
      const data: any = await this.gql(
        `query($cursor: String, $q: String) { orders(first: 100, after: $cursor, query: $q) {
            pageInfo { hasNextPage endCursor }
            nodes { name createdAt
              shippingAddress { countryCodeV2 }
              customer { numberOfOrders }
              totalShippingPriceSet { shopMoney { amount } }
              customerJourneySummary { lastVisit { source utmParameters { source medium campaign } } }
              lineItems(first: 50) { nodes { quantity variant { id }
                discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
                originalUnitPriceSet { shopMoney { amount } } } }
              refunds { createdAt refundLineItems(first: 50) { nodes { quantity lineItem { variant { id } } subtotalSet { shopMoney { amount } } } } }
            } } }`,
        { cursor, q },
      );
      for (const o of data.orders.nodes) {
        const utm = o.customerJourneySummary?.lastVisit?.utmParameters;
        const channel = classifyChannel(utm?.source, utm?.medium, o.customerJourneySummary?.lastVisit?.source);
        const shippingCharged = Number(o.totalShippingPriceSet.shopMoney.amount);
        out.push({
          id: o.name,
          date: o.createdAt.slice(0, 10),
          channel,
          campaignId: utm?.campaign ? `${channel === "meta" ? "meta" : "gads"}-${utm.campaign}` : undefined,
          country: o.shippingAddress?.countryCodeV2 ?? "CH",
          customerType: (o.customer?.numberOfOrders ?? 1) > 1 ? "returning" : "new",
          shippingCharged,
          // Carrier cost is not in Shopify; estimate until a shipping-provider connector supplies it.
          shippingCost: Number(process.env.AVG_SHIPPING_COST ?? 8.5),
          lines: o.lineItems.nodes.filter((l: any) => l.variant).map((l: any) => {
            const unit = Number(l.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount);
            const orig = Number(l.originalUnitPriceSet.shopMoney.amount);
            return { productId: l.variant.id, qty: l.quantity, unitPrice: unit, discount: Math.max(0, orig - unit) };
          }),
          refunds: o.refunds.flatMap((r: any) =>
            r.refundLineItems.nodes.filter((n: any) => n.lineItem.variant).map((n: any) => ({
              productId: n.lineItem.variant.id,
              qty: n.quantity,
              amount: Number(n.subtotalSet.shopMoney.amount),
              date: r.createdAt.slice(0, 10),
            })),
          ),
        });
      }
      cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    } while (cursor);
    return out;
  }
}

export function classifyChannel(source?: string, medium?: string, visitSource?: string): ChannelKey {
  const s = `${source ?? ""} ${visitSource ?? ""}`.toLowerCase();
  const m = (medium ?? "").toLowerCase();
  if (/google|gclid/.test(s) && /cpc|paid|ppc/.test(m)) return "google_ads";
  if (/facebook|instagram|meta|fb|ig/.test(s) && /cpc|paid|social_paid/.test(m)) return "meta";
  if (/tiktok/.test(s) && /cpc|paid/.test(m)) return "tiktok";
  if (/email|newsletter|klaviyo/.test(s + m)) return "email";
  if (/google|bing|duckduckgo|ecosia/.test(s)) return "organic";
  if (s.trim() === "" || /direct/.test(s)) return "direct";
  return "referral";
}
