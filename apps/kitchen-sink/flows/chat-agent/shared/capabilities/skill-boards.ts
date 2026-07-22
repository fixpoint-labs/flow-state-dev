/**
 * Drain-as-tool blocks for the Shape-2 research skills (FIX-918).
 *
 * `research-company` and `competitor-analysis` were `pattern: task-board`
 * skills — the runtime dispatched a board for them through the `runSkill`
 * router. Pattern mode is gone. A skill that needs a real task board
 * (concurrency + dependency dispatch, plus runtime fan-out for the competitor
 * discoverer) now exposes that board as a **single tool** the chat generator
 * calls, and lists it under `allowed-tools`.
 *
 * Each export below is a `taskBoard(...).drain` wrapped in a thin sequencer
 * that (1) takes a clean `{ topic }` input, (2) seeds the board's request-backed
 * collection, (3) drains, and (4) projects the settled board into a synthesized
 * report string. Seeding and projection resolve the same request-scoped
 * collection by id (the `task-queue-demo` idiom), so no board capability needs
 * threading. The workers are real LLM generators driven by the same reference
 * prompts the pattern-mode skills used — the migration preserves the board's
 * topological dispatch, concurrency, and (for competitors) mid-drain fan-out,
 * only changing the invocation path from pattern-router dispatch to a tool call.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generator, sequencer, handler } from "@flow-state-dev/core";
import type { BlockContext, GeneratorTool } from "@flow-state-dev/core";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

/** The substrate's per-task worker input (derived from the exported schema). */
type TaskWorkerInput = z.infer<typeof taskWorkerInputSchema>;
import { search } from "@flow-state-dev/tools/search";
import { fetch } from "@flow-state-dev/tools/fetch";

// Web tools the workers reference — one shared instance each.
const searchTool = search({ agentControlsTier: true });
const fetchTool = fetch();

// Model the board workers run on. Resolves through the flow's `chat` intent
// ladder like every other kitchen-sink generator.
const WORKER_MODEL = "intent/chat";

// ---------------------------------------------------------------------------
// Reference prompts — the same worker bodies the pattern-mode skills used.
// ---------------------------------------------------------------------------

const skillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../skills",
);

async function readPrompt(relative: string): Promise<string> {
  const body = await readFile(path.join(skillsRoot, relative), "utf8");
  // The discover/analyze prompts carry a `$ARGUMENTS` placeholder from their
  // pattern-mode origin; the board hands the target through the task goal, so
  // neutralize the placeholder rather than leave it literal.
  return body.replace(/\$ARGUMENTS/g, "the target named in your task");
}

const [marketPrompt, financialsPrompt, synthesisPrompt, discoverPrompt, analyzePrompt, synthesizePrompt] =
  await Promise.all([
    readPrompt("research-company/reference/market.md"),
    readPrompt("research-company/reference/financials.md"),
    readPrompt("research-company/reference/synthesis.md"),
    readPrompt("competitor-analysis/reference/discover.md"),
    readPrompt("competitor-analysis/reference/analyze.md"),
    readPrompt("competitor-analysis/reference/synthesize.md"),
  ]);

// ---------------------------------------------------------------------------
// Board-worker helpers
// ---------------------------------------------------------------------------

/** Render the per-task user turn from the substrate's TaskWorkerInput. */
function workerUserMessage(input: TaskWorkerInput): string {
  const parts: string[] = [`Task: ${input.goal}`];
  const deps = input.deps && Object.keys(input.deps).length > 0 ? input.deps : null;
  if (deps) {
    parts.push("", "Upstream outputs:");
    for (const [depId, value] of Object.entries(deps)) {
      parts.push(`- ${depId}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  return parts.join("\n");
}

/** A board-mode LLM worker: consumes TaskWorkerInput, returns its text output. */
function boardWorker(config: {
  name: string;
  prompt: string;
  tools?: GeneratorTool[];
  uses?: readonly unknown[];
}) {
  return generator({
    name: config.name,
    itemVisibility: { client: true, history: false },
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.string(),
    model: WORKER_MODEL,
    prompt: config.prompt,
    user: (input: TaskWorkerInput) => workerUserMessage(input),
    tools: config.tools ?? [],
    maxIterations: 12,
    ...(config.uses ? { uses: config.uses as never } : {}),
  }) as unknown as GeneratorTool;
}

/** Resolve a request-scoped collection by id (seed + drain + projection share it). */
function boardCollection(ctx: BlockContext, collectionId: string): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
}

/**
 * Per-invocation collection id, stored in request state under `${base}__runId`
 * so the seed tap, the board drain (and its mid-drain `taskTools` fan-out), and
 * the projection all resolve the SAME fresh collection. A second call to the
 * same tool in one request gets a new id, so the fixed task ids never collide —
 * restoring the per-activation collection pattern mode used to give each call.
 */
function currentRunId(ctx: BlockContext, base: string): string {
  const existing = (ctx.request?.state as Record<string, unknown> | undefined)?.[`${base}__runId`];
  return typeof existing === "string" ? existing : base;
}

/** Start a fresh run: allocate + record a unique collection id, return its collection. */
async function beginRun(ctx: BlockContext, base: string): Promise<TaskCollectionRef> {
  const runId = `${base}-${randomUUID()}`;
  await ctx.request.patchState({ [`${base}__runId`]: runId });
  return boardCollection(ctx, runId);
}

/**
 * Project the synthesizer's text output off the current run's settled board.
 * Selects by the `synthesizer` assignee rather than a fixed id — the competitor
 * discoverer queues its synth task via `taskTools.addTask` (no id field), so the
 * id is auto-generated, but exactly one task is assigned to the synthesizer.
 */
function projectReport(base: string) {
  return handler({
    name: `${base}-project`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ report: z.string() }),
    execute: async (_input, ctx) => {
      const collection = await boardCollection(ctx, currentRunId(ctx, base));
      const synth = collection
        .list({ assignee: "synthesizer" })
        .find((t) => t.status === "completed");
      const output = synth?.output;
      const report =
        typeof output === "string" ? output : (output as { report?: string } | undefined)?.report;
      return { report: report ?? "(no report produced)" };
    },
  });
}

// ---------------------------------------------------------------------------
// research-company — market + financial analysts in parallel, gated synthesizer
// ---------------------------------------------------------------------------

const RESEARCH_COMPANY_ID = "research-company";

const researchCompanyBoard = taskBoard({
  name: "research-company-board",
  collection: (ctx) => boardCollection(ctx, currentRunId(ctx, RESEARCH_COMPANY_ID)),
  concurrency: 2,
  dispatcher: "topological",
  workers: {
    "market-analyst": boardWorker({
      name: "rc-market-analyst",
      prompt: marketPrompt,
      tools: [searchTool, fetchTool],
    }),
    "financial-analyst": boardWorker({
      name: "rc-financial-analyst",
      prompt: financialsPrompt,
      tools: [searchTool, fetchTool],
    }),
    synthesizer: boardWorker({ name: "rc-synthesizer", prompt: synthesisPrompt }),
  } as Record<string, GeneratorTool>,
});

let researchCompanyPipeline: any = sequencer({
  name: "researchCompany",
  description:
    "Research a company with a market analyst and a financial analyst running in parallel, " +
    "then synthesize a single brief. Pass the company name or ticker as `topic`.",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ report: z.string() }),
});
researchCompanyPipeline = researchCompanyPipeline
  .tap(async (input: { topic: string }, ctx: BlockContext) => {
    const collection = await beginRun(ctx, RESEARCH_COMPANY_ID);
    await collection.addTask({
      id: "market",
      goal: `Analyze market positioning of ${input.topic} — category, target customer, key differentiators, recent narrative shifts. Cite sources.`,
      assignee: "market-analyst",
    });
    await collection.addTask({
      id: "financial",
      goal: `Analyze financial health of ${input.topic} — revenue scale and trajectory, funding or public financials, profitability/burn, runway signals. Cite sources.`,
      assignee: "financial-analyst",
    });
    await collection.addTask({
      id: "synth",
      goal: `Synthesize the prior reports into a single research brief for ${input.topic}. Lead with the takeaway, then evidence, then risks.`,
      assignee: "synthesizer",
      deps: ["market", "financial"],
    });
  })
  .step(researchCompanyBoard.drain)
  .step(projectReport(RESEARCH_COMPANY_ID));

/** The `research-company` skill's team, exposed as a single callable tool. */
export const researchCompany = researchCompanyPipeline as GeneratorTool;

// ---------------------------------------------------------------------------
// competitor-analysis — a discoverer fans out one analyzer per competitor
// ---------------------------------------------------------------------------

const COMPETITOR_ID = "competitor-analysis";

// The discoverer queues analyzer + synthesizer tasks mid-drain via taskTools.
// Its taskTools resolve against THIS drain's request-backed board (not the
// singleton's own-state default), so the tasks it adds are picked up by the
// still-running drain (§4.5 C).
const competitorBoardTaskTools = createTaskToolsCapability((ctx) =>
  boardCollection(ctx, currentRunId(ctx, COMPETITOR_ID)),
);

const competitorBoard = taskBoard({
  name: "competitor-analysis-board",
  collection: (ctx) => boardCollection(ctx, currentRunId(ctx, COMPETITOR_ID)),
  concurrency: 4,
  dispatcher: "topological",
  workers: {
    discoverer: boardWorker({
      name: "ca-discoverer",
      prompt: discoverPrompt,
      tools: [searchTool],
      uses: [competitorBoardTaskTools],
    }),
    analyzer: boardWorker({
      name: "ca-analyzer",
      prompt: analyzePrompt,
      tools: [searchTool, fetchTool],
    }),
    synthesizer: boardWorker({ name: "ca-synthesizer", prompt: synthesizePrompt }),
  } as Record<string, GeneratorTool>,
});

let competitorPipeline: any = sequencer({
  name: "competitorAnalysis",
  description:
    "Produce a competitor analysis as a comparison matrix plus a synthesized read. A " +
    "discoverer identifies 3-5 competitors and fans out one analyzer each; a synthesizer " +
    "waits on all of them. Pass the product, company, or market as `topic`.",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ report: z.string() }),
});
competitorPipeline = competitorPipeline
  .tap(async (input: { topic: string }, ctx: BlockContext) => {
    const collection = await beginRun(ctx, COMPETITOR_ID);
    // Seed only the discoverer; it enqueues one analyzer per competitor plus a
    // synthesizer gated on all of them at runtime.
    await collection.addTask({
      id: "discover",
      goal: `Identify 3 to 5 competitors for ${input.topic} across direct / adjacent / DIY-status-quo tiers, then enqueue one analyzer task per competitor plus a single synthesizer task (id "synth") whose deps cover every analyzer task you queued.`,
      assignee: "discoverer",
    });
  })
  .step(competitorBoard.drain)
  .step(projectReport(COMPETITOR_ID));

/** The `competitor-analysis` skill's team, exposed as a single callable tool. */
export const competitorAnalysis = competitorPipeline as GeneratorTool;
