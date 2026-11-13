/**
 * Builds the dashboard.
 *   web/dist/index.html + app.js    served by src/server.ts (talks to the API)
 *   dist/artifact.html               single self-contained page: engine + demo data
 *                                    run in the browser (the hosted demo)
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const page = await readFile("web/page.html", "utf8");
await mkdir("web/dist", { recursive: true });
await mkdir("dist", { recursive: true });

const common = { entryPoints: ["web/src/main.ts"], bundle: true, format: "iife" as const, target: "es2020", minify: true, write: false, legalComments: "none" as const };

const server = await build({ ...common, define: { EMBEDDED: "false" } });
await writeFile("web/dist/app.js", server.outputFiles![0]!.text);
await writeFile("web/dist/index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n${page}\n</body></html>`);

const embedded = await build({ ...common, define: { EMBEDDED: "true" } });
const js = embedded.outputFiles![0]!.text.replace(/<\/script/gi, "<\\/script");
await writeFile("dist/artifact.html", page.replace('<script src="app.js"></script>', `<script>${js}</script>`));

console.log(`built web/dist (server mode, ${(server.outputFiles![0]!.text.length / 1024).toFixed(0)} KB) and dist/artifact.html (${(js.length / 1024).toFixed(0)} KB)`);
