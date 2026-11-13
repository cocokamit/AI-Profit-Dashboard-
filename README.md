# AI Profit Dashboard

A monitoring and control system for real e-commerce profitability. It connects Shopify, Google Ads, Meta (and GA4), computes what is **actually left after every cost**, finds problems and opportunities on its own, and lets you ask an AI analyst questions such as:

- *Which products are the most profitable after deducting all costs?*
- *Where are we currently losing money?*
- *Which marketing budgets should we optimize?*

**Live demo:** https://claude.ai/artifact/SnY4oeUHXhd65vFx78whEP. It runs the full engine in the browser on a simulated Swiss spare-parts shop, and the analyst chat runs on Claude.

```bash
npm install
npm start                  # http://localhost:3000 (demo data, no keys needed)
ANTHROPIC_API_KEY=... npm start   # adds the AI analyst
npm run monitor            # one proactive monitoring pass (alerts + AI briefing)
npm test                   # engine invariants + detector + tool tests
docker build -t profit-dashboard . && docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... profit-dashboard
```

Without an API key (or when a demo viewer is not signed in to Claude), the chat switches to **rules mode**. It answers the standard questions (most profitable products, where money is lost, budget changes, weekly priorities, any finding) straight from the engine and labels the answer as rules-based.

Requires Node ≥ 22.18. TypeScript runs natively, so there is no compile step for the server.

## Deploy to Vercel

1. In Vercel: **Add New → Project**, import this repository. `vercel.json` sets the build, so leave the framework preset at **Other** and the other settings at their defaults.
2. Optional: under **Settings → Environment Variables** add `ANTHROPIC_API_KEY` for the AI analyst, and the source credentials plus `DATA_MODE=live` from `.env.example` for real data. Without them it runs on demo data and the chat uses rules mode.
3. Deploy. The dashboard is served as static files, and `/api/dashboard`, `/api/chat`, `/api/refresh` and `/healthz` run as Node 22 serverless functions. These are the same handlers as the local server (`src/http/api.ts`), packaged by `npm run build:vercel` into `.vercel/output` (Vercel Build Output API).

Notes:
- **Chat timeout**: AI answers that use several tools can take 30–90 s. Function duration is set to 60 s. On a plan that allows longer, set `VERCEL_FUNCTION_MAX_DURATION=300` as an environment variable and redeploy.
- **Monitoring**: Vercel cron jobs on the Hobby plan run at most once a day, so the hourly monitor runs in GitHub Actions instead (`.github/workflows/monitor.yml`). Add the same secrets there.
- **Caching**: each function instance keeps the pulled data for 10 minutes. In production this moves to the database (see *Path to production*).

## What it does

| Layer | What happens | Where |
|---|---|---|
| **1. Connectors** | Pull each source and map it into one canonical model. Without credentials, a connector serves the demo dataset. | `src/connectors/` |
| **2. Canonical model** | Orders, line items, refunds, products with landed cost, ad spend per campaign and day, traffic. No vendor payload leaks past this layer. | `src/core/types.ts` |
| **3. Profit engine** | Contribution margins per product, campaign and channel (see below). Pure functions that run on the server and in the browser. | `src/engine/profit.ts` |
| **4. Detectors** | Deterministic checks with a CHF/month impact and a concrete action each. They run hourly without an LLM. | `src/engine/insights.ts` |
| **5. AI analyst** | Claude answers questions and writes the daily briefing by **calling engine tools**. It never invents or calculates numbers itself, so every figure can be traced. | `src/ai/` |
| **6. Delivery** | Dashboard, chat, Slack alerts, daily briefing. The monitor runs as a long-lived process or hourly through GitHub Actions (`.github/workflows/monitor.yml`). | `web/`, `src/server.ts`, `src/jobs/monitor.ts` |

### The profit model

```
  Gross sales (after discounts)
− Refunds                                         = Net sales
− COGS (kept units + written-off share of returns) = CM1
− Shipping subsidy (carrier cost − shipping charged)
− Pick & pack, payment fees, return handling        = CM2   margin before marketing
− Ad spend (allocated)                              = CM3   profit after marketing
```

- **Ad spend is allocated by Shopify-confirmed revenue**, not by what the ad platform claims. Meta and Google over-report conversions. The system measures by how much, campaign by campaign.
- **POAS** (profit on ad spend = CM2 / spend) replaces ROAS as the steering metric. Every campaign also gets its **break-even ROAS**.
- Refunds are counted on the order date (cohort view), so a campaign is charged for the returns it caused.
- Costs that no source system knows (payment fees, pick & pack, return handling, resale rate) come from config today and from the ERP later.

### Detectors (proactive part)

| Detector | Example finding in the demo |
|---|---|
| Loss-making campaigns | Meta *Prospecting – Broad CH*: Meta reports ROAS 3.9x, Shopify confirms 2.1x, POAS 0.44. Loses ~CHF 3.3k/month |
| Budget-capped winners | *Search – Brand*: POAS 7.6x, 41% of impressions lost to budget |
| Budget reallocation | Move CHF 59/day from losing to capped campaigns: ~CHF 5.7k/month |
| CPC spikes | *Search – Generic*: CPC +73% in the last 7 days |
| Loss-making products + root cause | Dyson V11 replica battery: 22% returns. Kärcher 36V battery: 23% average discount |
| Stock-out risk on advertised products | Jura gasket set: 1.4 days of stock, ads still spending CHF 32/day |
| Attribution gap per platform | Meta over-reports revenue by 70% |
| Shipping threshold leak | Shipping subsidy is CHF 11.9k/month; a higher free-shipping threshold is worth ~CHF 900/month |

To add a detector, write one function in `DETECTORS`. The UI, the alerts and the AI pick it up automatically.

## Extending to new sources

To add a source, write a connector that returns canonical rows and register it in **one line** in `src/connectors/index.ts`:

```ts
export interface Connector {
  id: string; label: string; kind: "commerce" | "ads" | "analytics" | "feed";
  isConfigured(): boolean;
  fetch(range: DateRange): Promise<{ products?; orders?; adSpend?; traffic? }>;
}
```

- **TikTok Ads** emits `AdSpendRow`s exactly like Meta. The engine, detectors and AI need no change.
- **Merchant Center** adds a `feed` slice (disapprovals, price benchmarks). That enables new detectors, e.g. "best seller disapproved" or "priced 15% above market".
- **GA4** is already wired (`src/connectors/ga4.ts`). It emits sessions and funnel rows for conversion-rate and landing-page detectors.
- **More shops/countries (DE, ES, IT)**: add a `storeId`/`currency` dimension to the canonical rows and run one connector set per store. The engine is per-dataset already.

Live-mode connectors are implemented against the documented APIs (Shopify Admin GraphQL, Google Ads `searchStream`, Meta Insights, GA4 Data API). They have **not** been run against a real account in this PoC. Expect small field-mapping fixes on the first real connection. Set `DATA_MODE=live` and the credentials in `.env.example` to switch.

For attribution, Shopify's last-visit UTM parameters connect orders to campaigns. Put the campaign id into `utm_campaign` (Google: `{campaignid}`, Meta: `{{campaign.id}}`).

## Path to production

1. **Storage**: land raw API pulls in Postgres/BigQuery (append-only, with history) instead of the in-memory cache, with incremental syncs and Shopify webhooks for orders and refunds.
2. **Costs**: pull landed cost from the ERP, actual carrier invoices from the shipping provider, and real payment fees from Shopify Payments/Stripe payouts.
3. **Scale**: at 20M articles, aggregate to product × day (and campaign × product × day for Shopping/PMax via the `shopping_performance_view`) in the warehouse. The engine's code stays the same.
4. **Closing the loop**: send margin-based conversion values back to Google/Meta (offline conversions, Conversions API) so their bidding optimizes for profit. Apply budget changes through the APIs with a human-approval step and an audit log.
5. **AI**: keep tool-grounded answers. Add memory of past recommendations and their measured outcome so the briefing can say what worked.

## Project layout

```
src/core/          canonical types, connector interface + registry
src/connectors/    shopify, google-ads, meta, ga4, demo-data (seeded simulation)
src/engine/        profit.ts (margins), insights.ts (detectors)
src/ai/            tools.ts (shared tool definitions + system prompt), agent.ts (Claude tool loop),
                   offline.ts (rules-mode answers when no LLM is available)
src/http/api.ts    API route handlers (shared by the local server and Vercel)
src/server.ts      local/container server: API + static dashboard
src/vercel/        Vercel function entry points
src/jobs/          monitor.ts (hourly detection, Slack alerts, daily AI briefing)
web/               dashboard (page.html + src/main.ts), built by scripts/build.ts
test/              engine invariants, detector, tool and rules-mode tests
.github/workflows/ ci.yml (typecheck, tests, build), monitor.yml (hourly monitoring)
```
