/**
 * Server-side AI analyst: a Claude tool-use loop over the profit engine.
 *
 * Claude decides which tools to call; the tools run locally against the
 * analysis, so the model only ever reasons over computed, verifiable numbers.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOLS, runTool, type ToolContext } from "./tools.ts";
import { makeT, type Lang } from "../i18n/index.ts";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const MAX_ROUNDS = 8;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  text: string;
  toolCalls: { name: string; input: unknown }[];
}

let client: Anthropic | undefined;
export function aiAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function askAnalyst(ctx: ToolContext, history: ChatTurn[], lang: Lang = "en"): Promise<AgentResult> {
  client ??= new Anthropic();
  const tools: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  // The system prompt and tool list never change between requests, so they are cached.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((h) => ({ role: h.role, content: h.content }));
  // The language instruction goes after the cached system prompt so the cache stays shared across languages.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Dashboard language: ${lang}. ${makeT(lang)("ai.langInstruction")}` },
  ];
  const toolCalls: AgentResult["toolCalls"] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages,
      output_config: { effort: "medium" },
      // On a policy refusal, the API re-runs the request on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return { text: "The model declined to answer this question. Please rephrase it.", toolCalls };
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "(no answer)", toolCalls };
    }

    // All results of one round go back in a single user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = uses.map((u) => {
      toolCalls.push({ name: u.name, input: u.input });
      try {
        return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(runTool(ctx, u.name, u.input as Record<string, unknown>)) };
      } catch (e) {
        return { type: "tool_result", tool_use_id: u.id, content: `Error: ${(e as Error).message}`, is_error: true };
      }
    });
    messages.push({ role: "user", content: results });
  }
  return { text: "Stopped after too many tool rounds. Try a narrower question.", toolCalls };
}

/** One-shot executive briefing, used by the monitor job for proactive alerts. */
export async function writeBriefing(ctx: ToolContext, lang: Lang = "en"): Promise<string> {
  const { text } = await askAnalyst(ctx, [{
    role: "user",
    content: "Write this morning's profit briefing for the managing director: the 3 most important problems and the 2 biggest opportunities right now, each with the CHF impact and the concrete action. Use get_overview and get_insights.",
  }], lang);
  return text;
}
