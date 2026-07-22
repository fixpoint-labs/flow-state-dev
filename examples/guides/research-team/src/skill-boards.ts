// Drain-as-tool blocks for the research skills (FIX-918).
//
// Before FIX-918 the two SKILL.md folders under `./skills` were `pattern:
// task-board` skills — the runtime dispatched a board for them through the
// `runSkill` router. Pattern mode is gone. A skill that needs a whole task
// board (concurrency + dependency dispatch) now exposes that board as a single
// tool the executive calls, and lists it under `allowed-tools`.
//
// Each block below is a plain `taskBoard(...).drain` wrapped in a thin
// sequencer that (1) takes a clean input, (2) seeds the board's request-backed
// collection from that input, (3) drains, and (4) projects the settled board
// into a single synthesized report string. Seeding and projection resolve the
// same request-scoped collection by id (the `task-queue-demo` idiom), so no
// board capability needs threading. The workers are the same deterministic
// handlers `board.ts`/`workers.ts` use, so these run in tests without a model —
// the board's topological dispatch and dependency gating are the load-bearing
// behavior the migration preserves, not the worker internals.
import { randomUUID } from "node:crypto";
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { GeneratorTool } from "@flow-state-dev/core";
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { analyst, synthesizer } from "./workers";

/** Resolve a request-scoped collection by id (seed + drain + projection share it). */
function boardCollection(ctx: BlockContext, collectionId: string): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({ ctx, backing: "request", collectionId });
}

/**
 * Per-invocation collection id, stored in request state under `${base}__runId`
 * so the seed tap, the board drain, and the projection all resolve the SAME
 * fresh collection. A second call to the same tool in one request gets a new
 * id, so the fixed task ids (`market`/`synth`/…) never collide — restoring the
 * per-activation collection pattern mode used to give each `runSkill` call.
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

/** Project the synthesizer task's report off the current run's settled board. */
function projectReport(base: string) {
  return handler({
    name: `${base}-project`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ report: z.string() }),
    execute: async (_input, ctx) => {
      const collection = await boardCollection(ctx, currentRunId(ctx, base));
      const synth = collection.get("synth");
      const report = (synth?.output as { report?: string } | undefined)?.report;
      return { report: report ?? "(no report produced)" };
    },
  });
}

// ---------------------------------------------------------------------------
// research-company — static market + financial analysts, gated synthesizer
// ---------------------------------------------------------------------------

const RESEARCH_COMPANY_ID = "research-company";

const researchCompanyBoard = taskBoard({
  name: "research-company-board",
  collection: (ctx) => boardCollection(ctx, currentRunId(ctx, RESEARCH_COMPANY_ID)),
  concurrency: 2,
  dispatcher: "topological",
  workers: {
    "market-analyst": analyst("market"),
    "financial-analyst": analyst("financial"),
    synthesizer,
  },
});

let researchCompanyPipeline: any = sequencer({
  name: "researchCompany",
  description:
    "Research a company with a market analyst and a financial analyst running in " +
    "parallel, then synthesize a single brief. Pass the company name or ticker as `topic`.",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ report: z.string() }),
});
researchCompanyPipeline = researchCompanyPipeline
  .tap(async (input: { topic: string }, ctx: BlockContext) => {
    const collection = await beginRun(ctx, RESEARCH_COMPANY_ID);
    await collection.addTask({
      id: "market",
      goal: `Analyze the market positioning of ${input.topic}.`,
      assignee: "market-analyst",
      input: { subject: input.topic },
    });
    await collection.addTask({
      id: "financial",
      goal: `Analyze the financial health of ${input.topic}.`,
      assignee: "financial-analyst",
      input: { subject: input.topic },
    });
    await collection.addTask({
      id: "synth",
      goal: `Synthesize the prior reports into a single brief for ${input.topic}.`,
      assignee: "synthesizer",
      deps: ["market", "financial"],
      input: { subject: input.topic },
    });
  })
  .step(researchCompanyBoard.drain)
  .step(projectReport(RESEARCH_COMPANY_ID));

/**
 * `researchCompany` — the drain-as-tool for the `research-company` skill. The
 * market and financial analysts run in parallel; the synthesizer waits on both.
 * Returns the synthesized brief as `{ report }`.
 */
export const researchCompany = researchCompanyPipeline as GeneratorTool;

// ---------------------------------------------------------------------------
// competitor-analysis — one analyzer per competitor, gated synthesizer
// ---------------------------------------------------------------------------

const COMPETITOR_ID = "competitor-analysis";

const competitorBoard = taskBoard({
  name: "competitor-analysis-board",
  collection: (ctx) => boardCollection(ctx, currentRunId(ctx, COMPETITOR_ID)),
  concurrency: 4,
  dispatcher: "topological",
  workers: { analyzer: analyst("competitor"), synthesizer },
});

let competitorPipeline: any = sequencer({
  name: "analyzeCompetitors",
  description:
    "Analyze how a set of competitors stack up against a target. Pass the target as " +
    "`topic` and the competitor names as `competitors`; one analyzer runs per competitor " +
    "and a synthesizer produces the final comparison.",
  inputSchema: z.object({ topic: z.string(), competitors: z.array(z.string()).min(1) }),
  outputSchema: z.object({ report: z.string() }),
});
competitorPipeline = competitorPipeline
  .tap(async (input: { topic: string; competitors: string[] }, ctx: BlockContext) => {
    const collection = await beginRun(ctx, COMPETITOR_ID);
    const analyzerIds = input.competitors.map((_, i) => `analyze-${i}`);
    for (let i = 0; i < input.competitors.length; i++) {
      await collection.addTask({
        id: analyzerIds[i],
        goal: `Analyze ${input.competitors[i]} as a competitor to ${input.topic}.`,
        assignee: "analyzer",
        input: { subject: input.competitors[i] },
      });
    }
    await collection.addTask({
      id: "synth",
      goal: `Build the comparison matrix and final analysis for ${input.topic}.`,
      assignee: "synthesizer",
      deps: analyzerIds,
      input: { subject: input.topic },
    });
  })
  .step(competitorBoard.drain)
  .step(projectReport(COMPETITOR_ID));

/**
 * `analyzeCompetitors` — the drain-as-tool for the `competitor-analysis` skill.
 * The executive names the competitors; the board fans out one analyzer per
 * competitor and gates a synthesizer on all of them. Returns `{ report }`.
 */
export const analyzeCompetitors = competitorPipeline as GeneratorTool;
