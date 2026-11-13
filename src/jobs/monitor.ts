/**
 * Proactive monitor: the "AI watches the shop" loop.
 *
 * Every MONITOR_INTERVAL_MINUTES it re-pulls all sources, runs the detectors
 * and sends NEW critical/high findings to Slack (or stdout). Once a day it
 * also asks Claude for an executive briefing. Findings are de-duplicated by
 * id so the team is not spammed with the same alert every hour.
 *
 *   node src/jobs/monitor.ts          run forever
 *   node src/jobs/monitor.ts --once   one pass (cron / CI / GitHub Actions)
 */
import { getAnalysis } from "../service.ts";
import { aiAvailable, writeBriefing } from "../ai/agent.ts";
import type { Insight } from "../engine/insights.ts";

const seen = new Map<string, number>();
let lastBriefingDay = "";

async function notify(text: string) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return console.log(`\n${text}\n`);
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) console.error(`Slack webhook failed: ${res.status}`);
}

const fmt = (i: Insight) =>
  `*[${i.severity.toUpperCase()}] ${i.title}*${i.impactMonthly > 0 ? `  (~CHF ${Math.round(i.impactMonthly).toLocaleString("de-CH")}/month)` : ""}\n${i.summary}\n→ ${i.recommendation}`;

export async function runOnce() {
  const { ds, analysis, insights } = await getAnalysis(30, true);
  const fresh = insights.filter((i) => (i.severity === "critical" || i.severity === "high") && !seen.has(i.id));
  for (const i of insights) seen.set(i.id, Date.now());
  if (fresh.length) await notify(`:rotating_light: ${fresh.length} new finding(s)\n\n${fresh.map(fmt).join("\n\n")}`);

  const today = new Date().toISOString().slice(0, 10);
  if (aiAvailable() && today !== lastBriefingDay) {
    lastBriefingDay = today;
    await notify(`:sunrise: *Profit briefing*\n${await writeBriefing({ analysis, insights, dataset: ds })}`);
  }
  console.log(JSON.stringify({ level: "info", job: "monitor", insights: insights.length, new: fresh.length, cm3: Math.round(analysis.totals.cm3) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runOnce();
  if (!process.argv.includes("--once")) {
    const minutes = Number(process.env.MONITOR_INTERVAL_MINUTES ?? 60);
    setInterval(() => runOnce().catch((e) => console.error(JSON.stringify({ level: "error", job: "monitor", error: String(e) }))), minutes * 60_000);
  }
}
