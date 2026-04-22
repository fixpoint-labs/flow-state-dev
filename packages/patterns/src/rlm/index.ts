/**
 * RLM (Recursive Language Model) Pattern
 *
 * Reference implementation of the Recursive Language Model architecture
 * (Gao et al. 2025) using @flow-state-dev primitives.
 *
 * The key idea: an LM never sees the full context directly. Instead, it uses
 * tools to explore, search, and recursively sub-query over large contexts.
 *
 * This module exports reusable blocks and a pipeline builder. Consumers wire
 * these into their own flows — see kitchen-sink for an integration example.
 *
 * Patterns validated:
 *   - generator-as-tool (recursive AI composition)
 *   - handler blocks as LLM-callable tools
 *   - session resources for large context storage
 *   - depth control via tool set restriction
 */
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { peek, grep, chunk } from "./blocks";
import {
  contextResourceStateSchema,
  rlmQueryInputSchema,
  subQueryOutputSchema,
  rlmOutputSchema
} from "./schemas";

// ---------------------------------------------------------------------------
// Depth-1 generator (leaf — no recursive tool)
// ---------------------------------------------------------------------------
// Processes sub-queries on context subsets. Has exploration tools but cannot
// spawn further sub-queries. This is the depth control mechanism: tool set
// restriction prevents infinite recursion.

export const subQueryGenerator = generator({
  name: "rlm-sub-query",
  description:
    "Process a sub-query on a context subset. " +
    "Use when you need to analyze a specific portion of the context in detail.",
  model: (_input, ctx) =>
    ctx.session.resources.get("context")?.state.metadata?.model ?? "gpt-4o-mini",

  inputSchema: z.object({
    query: z.string().describe("The specific sub-question to answer"),
    contextSubset: z.string().describe("The context text to analyze")
  }),

  prompt: [
    "You are processing a sub-query about a provided context.",
    "The context subset has been loaded into the session — use peek, grep, and chunk tools to explore it.",
    "",
    "Rules:",
    "- Answer using ONLY information from the provided context",
    "- Be precise and cite specific evidence",
    "- Set confidence between 0 and 1 based on how well the context supports your answer",
    "- If the context doesn't contain relevant information, say so and set confidence to 0"
  ].join("\n"),

  context: [
    (input) =>
      `Context subset (${input.contextSubset.length} chars) has been loaded. Use tools to explore it.`
  ],
  user: (input) => input.query,
  tools: [peek, grep, chunk],
  maxIterations: 5,
  outputSchema: subQueryOutputSchema,
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),
  agentType: "sub",
});

// ---------------------------------------------------------------------------
// Depth-0 generator (root — has recursive sub-query tool)
// ---------------------------------------------------------------------------
// The main RLM generator. Cannot see the full context, only explore it through
// tools. Has the sub-query generator as a tool — the generator-as-tool pattern.

export const rootGenerator = generator({
  name: "rlm-root",
  model: (_input, ctx) =>
    ctx.session.resources.get("context")?.state.metadata?.model ?? "gpt-4o-mini",

  inputSchema: z.object({
    query: z.string()
  }),

  prompt: [
    "You are a Recursive Language Model. You CANNOT see the full context directly.",
    "Use your tools to explore, search, and delegate sub-queries over a large context.",
    "",
    "Strategy guidance:",
    "1. Start by peeking at the beginning of the context (offset 0) to understand its structure",
    "2. Use grep to find relevant sections by keyword or pattern",
    "3. Use chunk to read specific numbered sections if the context is very long",
    "4. Use rlm-sub-query to delegate detailed analysis of specific context portions",
    "   - Pass the relevant context subset and a focused sub-question",
    "   - Sub-queries are good for: summarizing sections, extracting specific facts,",
    "     comparing information across sections",
    "5. Synthesize all gathered information into a final answer",
    "",
    "Be thorough but efficient. Don't read the entire context if you can find what you need with grep."
  ].join("\n"),

  context: [
    (_input, ctx) => {
      const contextHandle = ctx.session.resources.get("context");
      const text = contextHandle?.state.text ?? "";
      const meta = contextHandle?.state.metadata;
      return [
        `Context document: ${text.length} characters`,
        meta?.tokenEstimate ? `(~${meta.tokenEstimate} tokens estimated)` : "",
        meta?.source ? `Source: ${meta.source}` : ""
      ].filter(Boolean).join(". ");
    }
  ],
  user: (input) => input.query,
  tools: [peek, grep, chunk, subQueryGenerator],
  maxIterations: 10,
  outputSchema: rlmOutputSchema,
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),
  agentType: "primary",
});

// ---------------------------------------------------------------------------
// Context storage handler
// ---------------------------------------------------------------------------
// Stores user-provided context into the session resource before the root
// generator runs.

export const storeContext = handler({
  name: "rlm-store-context",
  inputSchema: rlmQueryInputSchema,
  outputSchema: z.object({ query: z.string() }),
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),

  execute: async (input, ctx) => {
    const contextHandle = ctx.session.resources.get("context");
    if (contextHandle) {
      await contextHandle.updateState(async () => ({
        text: input.context,
        metadata: {
          model: input.model,
          tokenEstimate: Math.ceil(input.context.length / 4)
        }
      }));
    }
    return { query: input.query };
  }
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
// Store context → run root RLM generator.
// The sequencer pipes the context storage output ({ query }) into the root
// generator, which explores the stored context via tools and produces a
// structured answer.

export const rlmPipeline = sequencer({ name: "rlm-pipeline", inputSchema: rlmQueryInputSchema })
  .then(storeContext)
  .then(rootGenerator);

// Re-export schemas and blocks for consumers that need finer-grained access.
export {
  contextResourceStateSchema,
  rlmQueryInputSchema,
  subQueryOutputSchema,
  rlmOutputSchema
} from "./schemas";
export { peek, grep, chunk } from "./blocks";
