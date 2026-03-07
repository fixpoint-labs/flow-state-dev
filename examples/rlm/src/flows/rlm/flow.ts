/**
 * RLM (Recursive Language Model) Reference Flow
 *
 * Implements the Recursive Language Model architecture (Gao et al. 2025) using
 * @flow-state-dev primitives. The key idea: the root LM never sees the full
 * context directly. Instead, it uses tools to explore, search, and delegate
 * sub-queries over a large context document.
 *
 * This validates the generator-as-tool composition pattern: a generator block
 * listed in another generator's `tools` array. The root generator (depth-0) can
 * call the sub-query generator (depth-1) as a tool, while the sub-query
 * generator only has exploration tools and cannot recurse further.
 *
 * Concepts demonstrated:
 *   - generator-as-tool (recursive AI pattern)
 *   - handler blocks as LLM-callable tools
 *   - session resources for large context storage
 *   - depth control via tool set restriction
 *   - sequencer for context setup + generator execution
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { peek, grep, chunk } from "./blocks";
import { contextResourceStateSchema } from "./schemas";

const MODEL_ID = "claude-sonnet-4-5-20250514";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const queryInputSchema = z.object({
  query: z.string().min(1),
  context: z.string().min(1)
});

const sessionStateSchema = z.object({
  queryCount: z.number().default(0)
});

const subQueryOutputSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string())
});

const rootOutputSchema = z.object({
  answer: z.string(),
  reasoning: z.string(),
  sourcesUsed: z.array(z.string())
});

// ---------------------------------------------------------------------------
// Depth-1 generator (leaf — no recursive tool)
// ---------------------------------------------------------------------------
// This generator processes sub-queries on context subsets. It has exploration
// tools (peek, grep, chunk) to navigate the context, but it cannot spawn
// further sub-queries. This is the depth control mechanism: the tool set
// restriction prevents infinite recursion.

const subQueryGenerator = generator({
  name: "rlm-sub-query",
  description:
    "Process a sub-query on a context subset. " +
    "Use when you need to analyze a specific portion of the context in detail.",
  model: MODEL_ID,

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
  emit: { messages: true }
});

// ---------------------------------------------------------------------------
// Depth-0 generator (root — has recursive sub-query tool)
// ---------------------------------------------------------------------------
// This is the main RLM generator. It cannot see the full context, only explore
// it through tools. Critically, it has the sub-query generator as a tool,
// which is the generator-as-tool pattern: a generator listed in another
// generator's tools array.

const rootGenerator = generator({
  name: "rlm-root",
  model: MODEL_ID,

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
  // The key composition: subQueryGenerator is a generator used as a tool.
  // The framework handles this by executing the sub-generator when the LLM
  // calls it, and returning the structured output back as the tool result.
  tools: [peek, grep, chunk, subQueryGenerator],
  maxIterations: 10,
  outputSchema: rootOutputSchema,
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),
  emit: {
    messages: true,
    reasoning: true
  }
});

// ---------------------------------------------------------------------------
// Context storage handler
// ---------------------------------------------------------------------------
// Stores the user-provided context into the session resource before the root
// generator runs. This decouples context storage from the generator — the
// generator and its tools access the context through the resource handle.

const storeContext = handler({
  name: "store-context",
  inputSchema: queryInputSchema,
  outputSchema: z.object({ query: z.string() }),
  sessionResourceSchemas: z.object({ context: contextResourceStateSchema }),

  execute: async (input, ctx) => {
    const contextHandle = ctx.session.resources.get("context");
    if (contextHandle) {
      await contextHandle.updateState(async () => ({
        text: input.context,
        metadata: {
          tokenEstimate: Math.ceil(input.context.length / 4)
        }
      }));
    }
    return { query: input.query };
  }
});

// Bookkeeping: increment query counter after each RLM run.
const incrementQueryCount = handler({
  name: "increment-query-count",
  inputSchema: rootOutputSchema,
  outputSchema: rootOutputSchema,
  sessionStateSchema: z.object({ queryCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.queryCount ?? 0;
    await ctx.session.patchState({ queryCount: count + 1 });
    return input;
  }
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
// Store context → run root RLM generator → increment counter.
// The sequencer pipes the context storage output ({ query }) into the root
// generator, which explores the stored context via tools and produces a
// structured answer.

export const rlmPipeline = sequencer({ name: "rlm-pipeline", inputSchema: queryInputSchema })
  .then(storeContext)
  .then(rootGenerator)
  .then(incrementQueryCount);

// ---------------------------------------------------------------------------
// Flow definition
// ---------------------------------------------------------------------------

const rlmFlow = defineFlow({
  kind: "rlm",
  requireUser: true,

  actions: {
    query: {
      inputSchema: queryInputSchema,
      block: rlmPipeline,
      userMessage: (input: z.infer<typeof queryInputSchema>) => input.query
    }
  },

  session: {
    stateSchema: sessionStateSchema,
    resources: {
      context: {
        stateSchema: contextResourceStateSchema,
        writable: true
      }
    },
    clientData: {
      queryStats: (ctx) => ({
        queryCount: Number(ctx.state.queryCount ?? 0)
      }),
      contextInfo: (ctx) => {
        const context = (ctx.resources as Record<string, { state: { text?: string; metadata?: { tokenEstimate?: number } } }>).context?.state;
        return {
          loaded: (context?.text?.length ?? 0) > 0,
          length: context?.text?.length ?? 0,
          tokenEstimate: context?.metadata?.tokenEstimate ?? 0
        };
      }
    }
  }
});

const flow = rlmFlow({ id: "default" });

export default flow;
