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
import { readFile, writeFile } from "node:fs/promises";
import { getAnalysis } from "../service.ts";
import { aiAvailable, writeBriefing } from "../ai/agent.ts";
import type { Insight } from "../engine/insights.ts";

// State survives restarts and one-shot runs (cron / GitHub Actions) when MONITOR_STATE_FILE is set.
const STATE_FILE = process.env.MONITOR_STATE_FILE;
const RE_ALERT_AFTER_MS = 7 * 24 * 3600 * 1000; // remind about unresolved findings weekly
let seen = new Map<string, number>();
let lastBriefingDay = "";

async function loadState() {
  if (!STATE_FILE) return;
  try {
    const s = JSON.parse(await readFile(STATE_FILE, "utf8")) as { seen: Record<string, number>; lastBriefingDay: string };
    seen = new Map(Object.entries(s.seen ?? {}));
    lastBriefingDay = s.lastBriefingDay ?? "";
  } catch { /* first run */ }
}

async function saveState() {
  if (!STATE_FILE) return;
  await writeFile(STATE_FILE, JSON.stringify({ seen: Object.fromEntries(seen), lastBriefingDay }));
}

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
  await loadState();
  const now = Date.now();
  const fresh = insights.filter((i) => (i.severity === "critical" || i.severity === "high") && now - (seen.get(i.id) ?? 0) > RE_ALERT_AFTER_MS);
  for (const i of fresh) seen.set(i.id, now);
  // forget findings that disappeared, so they alert again if they come back
  const current = new Set(insights.map((i) => i.id));
  for (const id of [...seen.keys()]) if (!current.has(id)) seen.delete(id);
  if (fresh.length) await notify(`:rotating_light: ${fresh.length} new finding(s)\n\n${fresh.map(fmt).join("\n\n")}`);

  const today = new Date().toISOString().slice(0, 10);
  if (aiAvailable() && today !== lastBriefingDay) {
    lastBriefingDay = today;
    await notify(`:sunrise: *Profit briefing*\n${await writeBriefing({ analysis, insights, dataset: ds })}`);
  }
  await saveState();
  console.log(JSON.stringify({ level: "info", job: "monitor", insights: insights.length, new: fresh.length, cm3: Math.round(analysis.totals.cm3) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runOnce();
  if (!process.argv.includes("--once")) {
    const minutes = Number(process.env.MONITOR_INTERVAL_MINUTES ?? 60);
    setInterval(() => runOnce().catch((e) => console.error(JSON.stringify({ level: "error", job: "monitor", error: String(e) }))), minutes * 60_000);
  }
}
