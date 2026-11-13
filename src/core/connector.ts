import type { AdSpendRow, Dataset, DateRange, Order, Product, SourceStatus, TrafficRow } from "./types.ts";

/**
 * A connector pulls one source system and maps it into the canonical model.
 * It returns only the slices it owns (Shopify: products + orders; Google Ads:
 * adSpend; GA4: traffic ...). The registry merges the slices into a Dataset.
 */
export interface ConnectorSlice {
  products?: Product[];
  orders?: Order[];
  adSpend?: AdSpendRow[];
  traffic?: TrafficRow[];
}

export interface Connector {
  id: string;
  label: string;
  kind: SourceStatus["kind"];
  /** True when credentials are present and the connector can call the live API. */
  isConfigured(): boolean;
  fetch(range: DateRange): Promise<ConnectorSlice>;
}

export class ConnectorRegistry {
  private connectors: Connector[] = [];
  private planned: SourceStatus[] = [];

  register(connector: Connector): this {
    this.connectors.push(connector);
    return this;
  }

  /** Sources on the roadmap, shown in the UI so the architecture is visible. */
  plan(status: Omit<SourceStatus, "state">): this {
    this.planned.push({ ...status, state: "planned" });
    return this;
  }

  /**
   * Pull every connector in parallel. A failing source never takes the whole
   * dashboard down: it is reported as `error` and the rest still loads.
   */
  async load(range: DateRange, currency = "CHF"): Promise<Dataset> {
    const results = await Promise.allSettled(this.connectors.map((c) => c.fetch(range)));
    const ds: Dataset = {
      currency,
      products: [],
      orders: [],
      adSpend: [],
      traffic: [],
      sources: [],
      generatedAt: new Date().toISOString(),
    };
    results.forEach((res, i) => {
      const c = this.connectors[i]!;
      if (res.status === "rejected") {
        ds.sources.push({ id: c.id, label: c.label, kind: c.kind, state: "error", detail: String(res.reason?.message ?? res.reason) });
        return;
      }
      const s = res.value;
      ds.products.push(...(s.products ?? []));
      ds.orders.push(...(s.orders ?? []));
      ds.adSpend.push(...(s.adSpend ?? []));
      ds.traffic.push(...(s.traffic ?? []));
      const rows = (s.products?.length ?? 0) + (s.orders?.length ?? 0) + (s.adSpend?.length ?? 0) + (s.traffic?.length ?? 0);
      ds.sources.push({
        id: c.id,
        label: c.label,
        kind: c.kind,
        state: c.isConfigured() ? "connected" : "demo",
        rows,
      });
    });
    ds.sources.push(...this.planned);
    return ds;
  }
}
