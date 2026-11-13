/**
 * HTTP API + dashboard. Zero framework on purpose: the PoC has 4 routes.
 *
 *   GET  /api/dashboard?days=30   analysis + insights + sources (what the UI renders)
 *   POST /api/chat                { days, messages: [{role, content}] } -> AI answer
 *   POST /api/refresh             re-pull all sources
 *   GET  /healthz
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getAnalysis, getDataset } from "./service.ts";
import { aiAvailable, askAnalyst, type ChatTurn } from "./ai/agent.ts";
import { answerOffline } from "./ai/offline.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(here, "..", "web", "dist");
const PORT = Number(process.env.PORT ?? 3000);
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, (_k, v) => (v === Infinity ? null : v)));
};

async function readBody(req: IncomingMessage, limit = 200_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const clampDays = (v: unknown) => [7, 30, 90].includes(Number(v)) ? Number(v) : 30;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const started = Date.now();
  try {
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, ai: aiAvailable(), sources: (await getDataset()).sources });

    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      const { ds, analysis, insights } = await getAnalysis(clampDays(url.searchParams.get("days")));
      return json(res, 200, { analysis, insights, sources: ds.sources, ai: aiAvailable() ? "server" : "offline" });
    }

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      await getDataset(true);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = (await readBody(req)) as { days?: number; messages?: ChatTurn[] };
      const history = (body.messages ?? [])
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!history.length || history[history.length - 1]!.role !== "user") return json(res, 400, { error: "messages must end with a user message" });
      const { ds, analysis, insights } = await getAnalysis(clampDays(body.days));
      const ctx = { analysis, insights, dataset: ds };
      // Without an API key the chat still answers the core questions from the engine.
      if (!aiAvailable()) return json(res, 200, { text: answerOffline(history[history.length - 1]!.content, ctx), toolCalls: [], offline: true });
      const out = await askAnalyst(ctx, history);
      return json(res, 200, out);
    }

    // Static files
    const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^([/\\])+/, "");
    if (rel.includes("..")) return json(res, 400, { error: "bad path" });
    const file = await readFile(join(WEB, rel)).catch(() => undefined);
    if (!file) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[extname(rel)] ?? "application/octet-stream" });
    res.end(file);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    console.error(JSON.stringify({ level: "error", path: url.pathname, status, error: (e as Error).message }));
    if (!res.headersSent) json(res, status, { error: status === 500 ? "Internal error" : (e as Error).message });
  } finally {
    if (url.pathname.startsWith("/api")) console.log(JSON.stringify({ level: "info", method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started }));
  }
});

server.listen(PORT, () => {
  console.log(`AI Profit Dashboard on http://localhost:${PORT}  (data: ${process.env.DATA_MODE ?? "demo"}, AI: ${aiAvailable() ? "on" : "off - set ANTHROPIC_API_KEY"})`);
});
