/**
 * API route handlers, shared by the local Node server (src/server.ts) and the
 * Vercel serverless functions (src/vercel/*). Plain Node req/res, no framework.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAnalysis, getDataset } from "../service.ts";
import { aiAvailable, askAnalyst, type ChatTurn } from "../ai/agent.ts";
import { answerOffline } from "../ai/offline.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Body is not valid JSON"), { status: 400 });
  }
}

const clampDays = (v: unknown) => ([7, 30, 90].includes(Number(v)) ? Number(v) : 30);

/** Wraps a handler with method check, error mapping and one structured log line. */
function route(method: string, fn: Handler): Handler {
  return async (req, res) => {
    const started = Date.now();
    const path = (req.url ?? "").split("?")[0];
    try {
      if (req.method !== method) return json(res, 405, { error: `Use ${method}` });
      await fn(req, res);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      console.error(JSON.stringify({ level: "error", path, status, error: (e as Error).message }));
      if (!res.headersSent) json(res, status, { error: status === 500 ? "Internal error" : (e as Error).message });
    } finally {
      console.log(JSON.stringify({ level: "info", method: req.method, path, status: res.statusCode, ms: Date.now() - started }));
    }
  };
}

export const dashboard = route("GET", async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { ds, analysis, insights } = await getAnalysis(clampDays(url.searchParams.get("days")));
  json(res, 200, { analysis, insights, sources: ds.sources, ai: aiAvailable() ? "server" : "offline" });
});

export const refresh = route("POST", async (_req, res) => {
  await getDataset(true);
  json(res, 200, { ok: true });
});

export const chat = route("POST", async (req, res) => {
  const body = (await readBody(req)) as { days?: number; messages?: ChatTurn[] };
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1]!.role !== "user") return json(res, 400, { error: "messages must end with a user message" });
  const { ds, analysis, insights } = await getAnalysis(clampDays(body.days));
  const ctx = { analysis, insights, dataset: ds };
  // Without an API key the chat still answers the core questions from the engine.
  if (!aiAvailable()) return json(res, 200, { text: answerOffline(history[history.length - 1]!.content, ctx), toolCalls: [], offline: true });
  json(res, 200, await askAnalyst(ctx, history));
});

export const health = route("GET", async (_req, res) => {
  json(res, 200, { ok: true, ai: aiAvailable(), sources: (await getDataset()).sources });
});
