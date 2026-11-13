/**
 * Local / container server: the API routes plus the built dashboard.
 *
 *   GET  /api/dashboard?days=30   analysis + insights + sources (what the UI renders)
 *   POST /api/chat                { days, messages: [{role, content}] } -> AI answer
 *   POST /api/refresh             re-pull all sources
 *   GET  /healthz
 *
 * On Vercel the same handlers run as serverless functions (see scripts/build.ts --vercel).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chat, dashboard, health, json, refresh } from "./http/api.ts";
import { aiAvailable } from "./ai/agent.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(here, "..", "web", "dist");
const PORT = Number(process.env.PORT ?? 3000);
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const ROUTES: Record<string, typeof chat> = { "/api/dashboard": dashboard, "/api/chat": chat, "/api/refresh": refresh, "/healthz": health };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const handler = ROUTES[url.pathname];
  if (handler) return handler(req, res);

  const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^([/\\])+/, "");
  if (rel.includes("..")) return json(res, 400, { error: "bad path" });
  const file = await readFile(join(WEB, rel)).catch(() => undefined);
  if (!file) return json(res, 404, { error: "not found" });
  res.writeHead(200, { "Content-Type": MIME[extname(rel)] ?? "application/octet-stream" });
  res.end(file);
});

server.listen(PORT, () => {
  console.log(`AI Profit Dashboard on http://localhost:${PORT}  (data: ${process.env.DATA_MODE ?? "demo"}, AI: ${aiAvailable() ? "on" : "off - set ANTHROPIC_API_KEY"})`);
});
