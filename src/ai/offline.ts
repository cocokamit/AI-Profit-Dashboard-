/**
 * Rules-based answers for when no LLM is available (no API key, viewer not
 * signed in, consent declined). Covers the core questions from the engine's
 * own tools so the dashboard is still useful; the AI analyst adds free-form
 * reasoning on top. Output is the same markdown-lite the chat renders.
 */
import { runTool, type ToolContext } from "./tools.ts";

const fmt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number | null) => `CHF ${fmt.format(Math.round(n ?? 0))}`;

type P = { title: string; net_sales: number; cm3: number; cm3_margin_pct: number; return_rate_pct: number; avg_discount_pct: number };
type C = { id: string; name: string; spend: number; poas: number; profit_after_ads: number; platform_roas: number; true_roas: number; lost_impression_share_budget_pct: number; daily_budget: number };
type I = { title: string; recommendation: string; impact_chf_per_month: number; kind: string };

function profitable(ctx: ToolContext): string {
  const top = (runTool(ctx, "list_products", { sort_by: "cm3", order: "desc", limit: 5 }) as { products: P[] }).products;
  const flop = (runTool(ctx, "list_products", { sort_by: "cm3", order: "asc", limit: 3 }) as { products: P[] }).products.filter((p) => p.cm3 < 0);
  return [
    `The most profitable product after all costs is **${top[0]!.title}** with ${chf(top[0]!.cm3)} profit after ads.`,
    ...top.map((p) => `- **${p.title}**: ${chf(p.cm3)} profit on ${chf(p.net_sales)} net sales (${p.cm3_margin_pct}% margin)`),
    flop.length ? `At the other end, ${flop.map((p) => `**${p.title}** (${chf(p.cm3)})`).join(", ")} lose money.` : "",
    `Next step: protect stock and ad coverage for the top sellers, and fix or delist the loss-makers.`,
  ].filter(Boolean).join("\n");
}

function losing(ctx: ToolContext): string {
  const ins = (runTool(ctx, "get_insights", { kind: "problem" }) as { insights: I[] }).insights;
  const total = ins.reduce((s, i) => s + (i.impact_chf_per_month ?? 0), 0);
  return [
    `You are losing or risking about **${chf(total)} per month** in ${ins.length} places.`,
    ...ins.slice(0, 6).map((i) => `- **${i.title}** (${chf(i.impact_chf_per_month)}/month): ${i.recommendation}`),
    `Next step: ${ins[0]?.recommendation ?? "nothing urgent."}`,
  ].join("\n");
}

function budgets(ctx: ToolContext): string {
  const cs = (runTool(ctx, "list_campaigns", {}) as { campaigns: C[] }).campaigns;
  const cut = cs.filter((c) => c.poas < 1).sort((a, b) => a.profit_after_ads - b.profit_after_ads);
  const scale = cs.filter((c) => c.poas > 1.6 && c.lost_impression_share_budget_pct > 12);
  const lines = [`Shift budget from ${cut.length} campaign(s) that lose money to ${scale.length} that are capped by budget.`];
  for (const c of cut) {
    // Clear losers get halved; near-break-even campaigns get a 20% trim plus a tighter ROAS target.
    const factor = c.poas < 0.6 ? 0.5 : 0.8;
    const sim = runTool(ctx, "simulate_budget_change", { campaign: c.id, new_daily_budget: Math.round(c.daily_budget * factor) }) as { monthly_profit_change: number };
    lines.push(`- **Cut ${c.name}** to ${chf(c.daily_budget * factor)}/day: POAS ${c.poas} (platform claims ROAS ${c.platform_roas}, Shopify confirms ${c.true_roas}). Model: ${sim.monthly_profit_change >= 0 ? "+" : ""}${chf(sim.monthly_profit_change)}/month.`);
  }
  for (const c of scale) {
    const nb = Math.round(c.daily_budget * (1 + c.lost_impression_share_budget_pct / 100));
    const sim = runTool(ctx, "simulate_budget_change", { campaign: c.id, new_daily_budget: nb }) as { monthly_profit_change: number };
    lines.push(`- **Raise ${c.name}** to ${chf(nb)}/day: POAS ${c.poas}, losing ${Math.round(c.lost_impression_share_budget_pct)}% of impressions to budget. Model: +${chf(sim.monthly_profit_change)}/month.`);
  }
  lines.push(`Next step: make the cuts today and raise the capped budgets, then review after 7 days.`);
  return lines.join("\n");
}

function priorities(ctx: ToolContext): string {
  const ins = (runTool(ctx, "get_insights", {}) as { insights: I[] }).insights.filter((i) => i.kind !== "watch").slice(0, 3);
  return [
    `Die drei wichtigsten Massnahmen diese Woche:`,
    ...ins.map((i, n) => `${n + 1}. **${i.title}** (${chf(i.impact_chf_per_month)}/Monat): ${i.recommendation}`),
    `Nächster Schritt: mit Punkt 1 beginnen.`,
  ].join("\n");
}

export function answerOffline(question: string, ctx: ToolContext): string {
  const q = question.toLowerCase();
  let body: string;
  const all = (runTool(ctx, "get_insights", {}) as { insights: (I & { summary: string; metrics: Record<string, string> })[] }).insights;
  const finding = all.find((i) => q.includes(i.title.toLowerCase()));
  if (finding) {
    body = [
      `**${finding.title}**${finding.impact_chf_per_month > 0 ? ` (about ${chf(finding.impact_chf_per_month)} per month)` : ""}`,
      finding.summary,
      ...Object.entries(finding.metrics).map(([k, v]) => `- ${k}: ${v}`),
      `Next step: ${finding.recommendation}`,
    ].join("\n");
  } else if (/budget|marketing|optimi|campaign|kampagne|\bads?\b|werbung/.test(q)) body = budgets(ctx);
  else if (/los|verlier|geld|money|problem|verlust/.test(q)) body = losing(ctx);
  else if (/profitab|rentab|best|top|meist/.test(q)) body = profitable(ctx);
  else if (/erst|first|priorit|woche|week|tun|do\b/.test(q)) body = priorities(ctx);
  else body = `I can answer this offline only for the standard questions (profitable products, where we lose money, budgets, priorities). Here are the current priorities:\n${priorities(ctx)}`;
  return `${body}\n\n*Rules-based answer: the AI analyst is not connected in this view.*`;
}
