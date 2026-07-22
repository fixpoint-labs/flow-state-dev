// App-defined agents for the competitor-analysis skill.
//
// The competitor-analysis SKILL.md staffs two of its three agents by name
// (`agent-ref`), and both resolve here — showing the two non-inline forms:
//
//   - `competitor-analyst` is a real agent defined with `defineAgent` (a persona
//     + a model + tools). It's a shared, app-level agent — the skill borrows it
//     rather than defining it inline. This is the registry-agent form.
//   - `comparison-writer` resolves to a deterministic handler block. There's no
//     persona and no model — it's a plain block staffed as an agent. This is the
//     block-as-agent form.
//
// A skill reaches these through the `agentRegistry` + `materializeAgent` pair
// wired into `createSkillsLibrary` (see ./skills.ts). The registry resolves a
// name to an `Agent`; `materializeAgent` turns that `Agent` into the block the
// board dispatches. For `comparison-writer` the registry returns a stub so
// resolution proceeds, and the materializer swaps in the handler block.
import { handler } from "@flow-state-dev/core";
import type {
  Agent,
  AgentRegistry,
  BlockDefinition,
  MaterializeAgentFn,
} from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  createAgentRegistry,
  defineAgent,
  materializeAgent as workforceMaterializeAgent,
} from "@flow-state-dev/workforce";
import { z } from "zod";

/**
 * A shared competitor analyst, defined once in app code and referenced by the
 * skill via `agent-ref: competitor-analyst`. Being a real agent (persona +
 * model + tools), it materializes into an LLM worker — so the skill path needs
 * an API key, unlike the deterministic code-first board.
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

/** What the comparison-writer reads: the substrate's worker envelope. */
const comparisonWriterInput = taskWorkerInputSchema.extend({
  input: z.object({ subject: z.string() }).optional(),
});

/**
 * The comparison-writer — a deterministic handler block staffed as an agent.
 *
 * The board dispatches it exactly like any agent: it consumes the worker
 * envelope and its deps carry each completed analyzer's output, keyed by task
 * id. It stitches those analyses into one comparison document. No model, no
 * persona — the "agent" here is just a block. That's the block-as-agent form
 * the skill showcases.
 */
export const comparisonWriter = handler({
  name: "comparison-writer",
  inputSchema: comparisonWriterInput,
  outputSchema: z.string(),
  execute: (input) => {
    const analyses = Object.values(input.deps ?? {});
    if (analyses.length === 0) return "No competitor analyses to compare.";
    const sections = analyses.map((analysis, i) => {
      const text = typeof analysis === "string" ? analysis : JSON.stringify(analysis, null, 2);
      return `## Competitor ${i + 1}\n\n${text}`;
    });
    const target = input.input?.subject ?? "the target";
    return [`# Competitor comparison for ${target}`, ...sections].join("\n\n");
  },
});

/**
 * A stub `Agent` for the block-staffed `comparison-writer`. The registry must
 * return something for the name so `materializeWorker` proceeds to the
 * materializer; the persona/description are never used because the materializer
 * short-circuits this name to the handler block below.
 */
const comparisonWriterStub: Agent = {
  name: "comparison-writer",
  description: "Formats analyzer outputs into a comparison matrix (deterministic block).",
  persona: "Deterministic comparison writer — staffed as a block, not an LLM.",
};

const baseRegistry = createAgentRegistry([competitorAnalyst]);

/**
 * The agent registry the skills library resolves `agent-ref` names against.
 * `competitor-analyst` comes from the real registry; `comparison-writer`
 * resolves to a stub so its block can be swapped in at materialization.
 */
export const agentRegistry: AgentRegistry = {
  get: async (name) =>
    name === comparisonWriterStub.name ? comparisonWriterStub : baseRegistry.get(name),
  list: async () => [...(await baseRegistry.list()), comparisonWriterStub],
};

/**
 * Turn a resolved `Agent` into the block the board dispatches. For
 * `comparison-writer` it returns the deterministic handler block (the
 * block-as-agent path); every other agent delegates to workforce's
 * `materializeAgent`, which builds an LLM worker from the persona + model.
 */
export const materializeAgent: MaterializeAgentFn = (agent, opts) =>
  agent.name === comparisonWriterStub.name
    ? (comparisonWriter as unknown as BlockDefinition)
    : workforceMaterializeAgent(agent, opts);
