/**
 * Thinking Style Resolution + Pipelines
 *
 * Resolves "auto" thinking style to a concrete style via:
 *   1. Keyword handler — fast heuristic scan, patches session state directly if match
 *   2. LLM classifier — intentClassifier fallback when no keyword matched
 *
 * Defines the three thinking-style pipelines (chain-of-thought, plan-and-execute,
 * supervisor) and the router that dispatches between them.
 */
import { generator, handler, router, sequencer, utility } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { supervisor, executableTaskSchema } from "@flow-state-dev/patterns/supervisor";
import { z } from "zod";

// -------------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------------

export const thinkingStyleSchema = z.enum([
  "plan-and-execute",
  "supervisor",
  "chain-of-thought",
]);

export type ThinkingStyle = z.infer<typeof thinkingStyleSchema>;

export const thinkingStyleSessionStateSchema = z.object({
  thinkingStyle: thinkingStyleSchema.optional(),
});

const autoClassifyStateSchema = z.object({
  keywordMatched: z.boolean().default(false),
});

const classifierOutputSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reasoning: z.string().optional(),
});

// -------------------------------------------------------------------------
// Keyword lists — named constants for extensibility
// -------------------------------------------------------------------------

export const SUPERVISOR_KEYWORDS = [
  "coordinate",
  "delegate",
  "assign",
  "orchestrate",
  "multiple agents",
  "sub-agent",
  "team of",
];

export const PLAN_KEYWORDS = [
  "plan",
  "steps",
  "step by step",
  "break down",
  "decompose",
  "tasks",
  "outline",
  "roadmap",
  "phase",
];

export const COT_KEYWORDS = [
  "think through",
  "reason",
  "why",
  "explain",
  "analyze",
  "consider",
  "evaluate",
  "pros and cons",
];

// -------------------------------------------------------------------------
// Tier 1 — Keyword Handler
// -------------------------------------------------------------------------

const messageSchema = z.object({ message: z.string() });

export const keywordHandler = handler({
  name: "keyword-style-handler",
  inputSchema: messageSchema,
  sequencerStateSchema: autoClassifyStateSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const message = input.message.toLowerCase();

    let matched: ThinkingStyle | null = null;
    if (SUPERVISOR_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "supervisor";
    } else if (PLAN_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "plan-and-execute";
    } else if (COT_KEYWORDS.some((kw) => message.includes(kw))) {
      matched = "chain-of-thought";
    }

    if (matched !== null) {
      await ctx.sequencer!.patchState({ keywordMatched: true });
      if (matched !== ctx.session.state.thinkingStyle) {
        await ctx.session.patchState({ thinkingStyle: matched });
      }
    }
  },
});

// -------------------------------------------------------------------------
// Tier 2 — LLM Classifier
// -------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.65;

export const classifierBlock = utility.intentClassifier({
  name: "thinking-style-classifier",
  categories: {
    "plan-and-execute": `
      The message asks the AI to complete a structured, multi-step task where
      decomposing the work into discrete subtasks before executing would produce
      a better result. Examples: writing a report, implementing a feature,
      generating a comprehensive document, producing complex structured output.
    `,
    supervisor: `
      The message describes a task that naturally requires coordinating multiple
      specialized concerns in parallel or sequentially, where different aspects
      of the work benefit from independent sub-agent treatment. Examples:
      research + synthesis pipelines, code review across multiple dimensions,
      cross-domain analysis tasks.
    `,
    "chain-of-thought": `
      The message is a direct question, a reasoning task, an explanation request,
      or anything where a single high-quality response with visible reasoning
      is more appropriate than task decomposition. Examples: answering questions,
      comparing options, explaining concepts, debugging, short creative tasks.
    `,
  },
});

const applyClassifiedStyle = handler({
  name: "apply-classified-style",
  inputSchema: classifierOutputSchema,
  sessionStateSchema: thinkingStyleSessionStateSchema,
  execute: async (input, ctx) => {
    const parsed = thinkingStyleSchema.safeParse(input.category);
    const style: ThinkingStyle =
      input.confidence >= CONFIDENCE_THRESHOLD && parsed.success
        ? parsed.data
        : "chain-of-thought";
    if (style !== ctx.session.state.thinkingStyle) {
      await ctx.session.patchState({ thinkingStyle: style });
    }
  },
});

const llmClassifySequencer = sequencer({
  name: "llm-classify-style",
  inputSchema: messageSchema,
})
  .then((input) => input.message, classifierBlock)
  .tap(applyClassifiedStyle);

// -------------------------------------------------------------------------
// Auto-classify sequencer (exported for use in flow.ts)
// -------------------------------------------------------------------------

export const autoClassifyStyle = sequencer({
  name: "auto-classify-style",
  inputSchema: messageSchema,
  stateSchema: autoClassifyStateSchema,
})
  .tap(keywordHandler)
  .tapIf(
    (_input, ctx) => !ctx.sequencer?.state.keywordMatched,
    llmClassifySequencer,
  );

// -------------------------------------------------------------------------
// Thinking Style Router Factory
//
// Accepts the assistant generator and produces the router + pipelines.
// This factory pattern avoids circular dependencies between thinking-styles
// and flow.ts (where the assistant generator is defined).
// -------------------------------------------------------------------------

export interface ThinkingStyleRouterConfig {
  assistantGenerator: BlockDefinition<any, any>;
  modelId: string;
  context: any[];
  tools: BlockDefinition<any, any>[];
  sessionResources: Record<string, any>;
}

export function createThinkingStyleRouter(config: ThinkingStyleRouterConfig) {
  const { assistantGenerator, modelId, context, tools, sessionResources } = config;

  // Chain of Thought — direct generation.
  const cotPipeline = assistantGenerator;

  // Plan and Execute — decomposes into steps, executes, synthesizes.
  const paePipeline = planAndExecute({
    name: "pae-thinking",
    model: modelId,
    context,
    search: true,
    tools,
    sessionResources,
    enableReplanning: true,
  });

  // Supervisor — plan → dispatch workers → review → replan loop.
  // Two specialized workers: researcher (read-only, search-enabled) and
  // writer (can create/update artifacts). Silent emit on both to avoid
  // polluting the conversation stream with per-task messages.

  type TaskInput = z.infer<typeof executableTaskSchema>;

  const workerUserMessage = (input: TaskInput) =>
    input.feedback
      ? `Task: ${input.goal}\n\nPrevious feedback: ${input.feedback}`
      : `Task: ${input.goal}`;

  // Researcher — search + read artifacts, no write access.
  const researcherWorker = generator({
    name: "supervisor-researcher",
    description: "Search the web, read artifacts, gather and analyze information. Cannot create or modify artifacts.",
    model: modelId,
    inputSchema: executableTaskSchema,
    outputSchema: z.string(),
    context,
    tools: tools.filter((t) => t.name !== "write-artifact" && t.name !== "update-artifact"),
    sessionResources,
    search: true,
    emit: { messages: false },
    prompt: [
      "You are a research specialist within a supervisor workflow.",
      "Gather information, analyze content, and provide thorough findings.",
      "You can read artifacts and search the web, but cannot create or modify artifacts.",
      "If feedback from a prior attempt is provided, address it directly.",
    ].join("\n"),
    user: workerUserMessage,
  });

  // Writer — read + write artifacts, no search.
  const writerWorker = generator({
    name: "supervisor-writer",
    description: "Create and update artifacts with well-structured content. Only one writer task should run at a time — use deps to sequence write tasks that touch the same artifact.",
    model: modelId,
    inputSchema: executableTaskSchema,
    outputSchema: z.string(),
    context,
    tools,
    sessionResources,
    search: false,
    emit: { messages: false },
    prompt: [
      "You are a writing specialist within a supervisor workflow.",
      "Create and update artifacts based on research findings or user requests.",
      "Focus on producing clear, well-structured content.",
      "If feedback from a prior attempt is provided, address it directly.",
    ].join("\n"),
    user: workerUserMessage,
  });

  const supervisorPipeline = supervisor({
    name: "supervisor-thinking",
    workers: {
      researcher: researcherWorker,
      writer: writerWorker,
    },
    plannerInstructions: [
      "Research tasks should run first. Writer tasks should depend on the research tasks that produce the content they need.",
      "Never schedule two writer tasks that write to the same artifact concurrently — use deps to sequence them.",
      "When the goal requires producing a deliverable (report, document, code), always include at least one writer task to create the artifact.",
      "Ensure to include a final task to focus on how the results from previous tasks can be distilled in a concise and high signal way.",
    ].join("\n"),
    reviewerInstructions: [
      "Tasks with assignee 'writer' create or update artifacts. Judge writer tasks by whether they report successfully creating/updating an artifact — the artifact content itself is managed separately.",
      "Tasks with assignee 'researcher' gather information. Judge them by the relevance and depth of their findings.",
      "A task that completed its stated goal should be accepted even if the output is a brief confirmation. Not every task produces a long result.",
    ].join("\n"),
    maxIterations: 3,
    maxConcurrency: 3,
    onSubTaskError: "skip",
    outputSchema: z.string(),
  });

  // Router — adapts flow input to each pipeline's expected shape via connectInput.
  // connectInput delegates through the original block's .run, so route
  // interception (e.g. testRouter) works transparently.
  const thinkingStyleRouter = router({
    name: "thinking-style-router",
    routes: [cotPipeline, paePipeline, supervisorPipeline],
    execute: (input, ctx) => {
      const style = ctx.session.state.thinkingStyle as string | undefined;
      switch (style) {
        case "plan-and-execute":
          return paePipeline.connectInput(() => ({ goal: input.message }));
        case "supervisor":
          return supervisorPipeline.connectInput(() => ({ goal: input.message }));
        default:
          return cotPipeline;
      }
    },
  });

  return { thinkingStyleRouter, cotPipeline, paePipeline, supervisorPipeline };
}
