// App-defined agents for the competitor-analysis skill.
//
// competitor-analysis defines most of its team inline (in its SKILL.md), but
// staffs one seat — `analyzer` — by referencing a shared, app-level agent
// through the registry (`agent-ref: competitor-analyst`). That's the registry
// form: an agent defined once in app code with `defineAgent` and borrowed by
// name, so several skills can share the same participant.
//
// A skill reaches a registry agent through the `agentRegistry` +
// `materializeAgent` pair wired into `createSkillsLibrary` (see ./skills.ts).
// The registry resolves a name to an `Agent`; `materializeAgent` turns that
// `Agent` into the board worker the drain dispatches.
import type { AgentRegistry, MaterializeAgentFn } from "@flow-state-dev/core";
import {
  createAgentRegistry,
  defineAgent,
  materializeAgent as workforceMaterializeAgent,
} from "@flow-state-dev/workforce";

/**
 * A shared competitor analyst, defined once in app code and referenced by the
 * skill via `agent-ref: competitor-analyst`. Being a real agent (persona +
 * model + tools), it materializes into an LLM worker holding `search` — so the
 * skill path needs a model key and one search-provider key, unlike the
 * deterministic code-first board.
 */
export const competitorAnalyst = defineAgent({
  name: "competitor-analyst",
  description: "Analyzes a single competitor across positioning, pricing, distribution, and differentiators.",
  persona: [
    "You are a competitor analyst. You analyze ONE competitor and surface the",
    "facts a comparison writer will use. You do not write the final matrix.",
    "",
    "The competitor name, tier, and target product are in the task goal. Cover,",
    "in this order, each in a short line or two:",
    "- Positioning: the primary use case and target user, in plain terms.",
    "- Pricing: model (freemium / usage / seat / open-source) and a rough band if disclosed.",
    "- Distribution: how users find and adopt it (PLG, sales-led, ecosystem, organic).",
    "- Differentiators: the one or two things this competitor does best in the set.",
    "- Weakness: where it falls short for the segment most relevant to the target.",
    "",
    "Use `search` for recent coverage and `fetch` to read a page when the snippet",
    "isn't enough. Cite sources inline with markdown links. Distinguish observable",
    "facts (pricing page, license) from your inference — label inferences. If a",
    "dimension is uninteresting for this competitor, write \"n/a\" and move on.",
    "End with one line: \"For <target>: <competitor> matters when <one sentence>.\"",
  ].join("\n"),
  model: "openai/gpt-5.4-mini",
  allowedTools: ["search", "fetch"],
});

/**
 * The registry the skills library resolves `agent-ref` names against — just the
 * shared competitor-analyst. The rest of competitor-analysis's team is inline.
 */
export const agentRegistry: AgentRegistry = createAgentRegistry([competitorAnalyst]);

/** Turns a resolved `Agent` into the board worker the drain dispatches. */
export const materializeAgent: MaterializeAgentFn = workforceMaterializeAgent;
