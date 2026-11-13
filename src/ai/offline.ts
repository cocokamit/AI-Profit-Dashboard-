/**
 * Rules-based answers for when no LLM is available (no API key, viewer not
 * signed in, consent declined). Covers the core questions from the engine's
 * own tools so the dashboard is still useful; the AI analyst adds free-form
 * reasoning on top. Output is the same markdown-lite the chat renders.
 */
import { runTool, type ToolContext } from "./tools.ts";
import { findTerm } from "./glossary.ts";
import { makeT, type Lang, type T, type Key } from "../i18n/index.ts";

const fmt = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const chf = (n: number | null) => `CHF ${fmt.format(Math.round(n ?? 0))}`;

type P = { title: string; net_sales: number; cm3: number; cm3_margin_pct: number; return_rate_pct: number; avg_discount_pct: number };
type C = { id: string; name: string; spend: number; poas: number; profit_after_ads: number; platform_roas: number; true_roas: number; lost_impression_share_budget_pct: number; daily_budget: number };
type I = { title: string; recommendation: string; impact_chf_per_month: number; kind: string };

function profitable(ctx: ToolContext, t: T): string {
  const top = (runTool(ctx, "list_products", { sort_by: "cm3", order: "desc", limit: 5 }) as { products: P[] }).products;
  const flop = (runTool(ctx, "list_products", { sort_by: "cm3", order: "asc", limit: 3 }) as { products: P[] }).products.filter((p) => p.cm3 < 0);
  return [
    t("off.prof.lead", { title: top[0]!.title, amt: chf(top[0]!.cm3) }),
    ...top.map((p) => `- ${t("off.prof.row", { title: p.title, amt: chf(p.cm3), sales: chf(p.net_sales), margin: p.cm3_margin_pct })}`),
    flop.length ? t("off.prof.flop", { list: flop.map((p) => `**${p.title}** (${chf(p.cm3)})`).join(", ") }) : "",
    t("off.prof.next"),
  ].filter(Boolean).join("\n");
}

function losing(ctx: ToolContext, t: T): string {
  const ins = (runTool(ctx, "get_insights", { kind: "problem" }) as { insights: I[] }).insights;
  const total = ins.reduce((s, i) => s + (i.impact_chf_per_month ?? 0), 0);
  return [
    t("off.lose.lead", { amt: chf(total), n: ins.length }),
    ...ins.slice(0, 6).map((i) => `- ${t("off.lose.row", { title: i.title, amt: chf(i.impact_chf_per_month), rec: i.recommendation })}`),
    t("off.next", { x: ins[0]?.recommendation ?? t("off.nothing") }),
  ].join("\n");
}

function budgets(ctx: ToolContext, t: T): string {
  const cs = (runTool(ctx, "list_campaigns", {}) as { campaigns: C[] }).campaigns;
  const cut = cs.filter((c) => c.poas < 1).sort((a, b) => a.profit_after_ads - b.profit_after_ads);
  const scale = cs.filter((c) => c.poas > 1.6 && c.lost_impression_share_budget_pct > 12);
  const lines = [t("off.bud.lead", { a: cut.length, b: scale.length })];
  for (const c of cut) {
    // Clear losers get halved; near-break-even campaigns get a 20% trim plus a tighter ROAS target.
    const factor = c.poas < 0.6 ? 0.5 : 0.8;
    const sim = runTool(ctx, "simulate_budget_change", { campaign: c.id, new_daily_budget: Math.round(c.daily_budget * factor) }) as { monthly_profit_change: number };
    lines.push(`- ${t("off.bud.cut", { name: c.name, amt: chf(c.daily_budget * factor), poas: c.poas, p: c.platform_roas, t: c.true_roas, chg: `${sim.monthly_profit_change >= 0 ? "+" : ""}${chf(sim.monthly_profit_change)}` })}`);
  }
  for (const c of scale) {
    const nb = Math.round(c.daily_budget * (1 + c.lost_impression_share_budget_pct / 100));
    const sim = runTool(ctx, "simulate_budget_change", { campaign: c.id, new_daily_budget: nb }) as { monthly_profit_change: number };
    lines.push(`- ${t("off.bud.raise", { name: c.name, amt: chf(nb), poas: c.poas, lost: Math.round(c.lost_impression_share_budget_pct), chg: chf(sim.monthly_profit_change) })}`);
  }
  lines.push(t("off.bud.next"));
  return lines.join("\n");
}

function priorities(ctx: ToolContext, t: T): string {
  const ins = (runTool(ctx, "get_insights", {}) as { insights: I[] }).insights.filter((i) => i.kind !== "watch").slice(0, 3);
  return [
    t("off.prio.lead"),
    ...ins.map((i, n) => t("off.prio.row", { n: n + 1, title: i.title, amt: chf(i.impact_chf_per_month), rec: i.recommendation })),
    t("off.prio.next"),
  ].join("\n");
}

/**
 * `lang` is the dashboard language; the insights in `ctx` must already be in that
 * language (the card questions quote their titles). Routing understands
 * EN / DE / FR / IT / ES phrasings.
 */
export function answerOffline(question: string, ctx: ToolContext, lang: Lang = "en"): string {
  const t = makeT(lang);
  const q = question.toLowerCase();
  let body: string;
  const all = (runTool(ctx, "get_insights", {}) as { insights: (I & { summary: string; metrics: Record<string, string> })[] }).insights;
  const finding = all.find((i) => q.includes(i.title.toLowerCase()));
  const term = findTerm(q);
  if (finding) {
    body = [
      `**${finding.title}**${finding.impact_chf_per_month > 0 ? t("off.find.impact", { amt: chf(finding.impact_chf_per_month) }) : ""}`,
      finding.summary,
      ...Object.entries(finding.metrics).map(([k, v]) => `- ${k}: ${v}`),
      t("off.next", { x: finding.recommendation }),
    ].join("\n");
  } else if (term && /what (is|are|does|do)|what's|mean|define|explain|bedeut|was (ist|sind|heisst)|signifi|qu'est|qué es|cos'è|che cos/.test(q)) {
    const ex = t(`g.${term.id}.ex` as Key);
    body = `**${t(`g.${term.id}.term` as Key)}**: ${t(`g.${term.id}.short` as Key)}${ex ? `\n\n${t("off.example", { x: ex })}` : ""}`;
  } else if (/budget|marketing|optimi|campaign|kampagne|campagn|campañ|presupuest|\bads?\b|werbung|publicit|pubblicit/.test(q)) body = budgets(ctx, t);
  else if (/\blos(e|es|ing|t)\b|verlier|geld|money|verlust|perd|argent|soldi|dinero|pérdid/.test(q)) body = losing(ctx, t);
  else if (/profitab|rentab|redditiz|best|top|meist/.test(q)) body = profitable(ctx, t);
  else if (/erst|first|priorit|woche|week|tun\b|\bdo\b|premier|semaine|prim|settimana|semana/.test(q)) body = priorities(ctx, t);
  else body = `${t("off.fallback")}\n${priorities(ctx, t)}`;
  return `${body}\n\n${t("off.note")}`;
}
