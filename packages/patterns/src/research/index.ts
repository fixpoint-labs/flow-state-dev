/** Installable deep research built from plan-and-execute and retrieval tools. */
import { defineFlow, defineKit, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { crawl, fetch, search } from "@flow-state-dev/tools";
import type { CrawlConfig, FetchConfig, SearchConfig } from "@flow-state-dev/tools";
import { z } from "zod";
import { planAndExecute } from "../plan-and-execute";

const sourceSchema = z.object({
  title: z.string().default(""),
  url: z.string().url(),
  method: z.enum(["search", "fetch", "crawl"]).optional(),
});
const researchSessionStateSchema = z.object({
  researchRetrievedUrls: z.array(z.string()).default([]),
  researchToolAttempts: z.record(z.number()).default({}),
});
/** Typed evidence passed from a research task to evaluation and synthesis. */
export const researchTaskResultSchema = z.object({
  summary: z.string(), success: z.boolean(), reason: z.string().default(""), sources: z.array(sourceSchema).default([]),
});
const taskResultSchema = researchTaskResultSchema;

/** One evidence-backed finding in a research report. */
export const researchFindingSchema = z.object({ claim: z.string(), citations: z.array(z.string().url()).min(1) });

/** Public result returned by the research flow. */
export const researchReportSchema = z.object({
  question: z.string(),
  summary: z.string(),
  findings: z.array(researchFindingSchema),
  sources: z.array(sourceSchema.omit({ method: true })),
  retrieval: z.object({ urls: z.array(z.string()), attempts: z.record(z.number()) }),
  tasks: z.array(z.object({
    id: z.string(), goal: z.string(),
    status: z.enum(["pending", "in-progress", "completed", "failed", "skipped"]),
    result: taskResultSchema.optional(), error: z.string().optional(),
  })),
  completedSteps: z.number(),
  totalSteps: z.number(),
});
/** A cited report plus the typed plan state and observed retrieval provenance. */
export type ResearchReport = z.infer<typeof researchReportSchema>;

const reportDraftSchema = researchReportSchema.pick({ question: true, summary: true, findings: true, sources: true });
const planOutputSchema = z.object({
  goal: z.string(), status: z.string(), tasks: researchReportSchema.shape.tasks,
  completedSteps: z.number(), totalSteps: z.number(),
});

/** Refuse a report that cites a URL no retrieval tool actually returned. */
export function validateResearchReport<T extends z.infer<typeof reportDraftSchema>>(
  report: T,
  retrievedUrls: ReadonlySet<string>,
): T {
  const urls = [...report.findings.flatMap((finding) => finding.citations), ...report.sources.map((source) => source.url)];
  for (const url of urls) {
    if (!retrievedUrls.has(url)) throw new Error(`Research report citation was not retrieved: ${url}`);
  }
  const listed = new Set(report.sources.map((source) => source.url));
  for (const url of report.findings.flatMap((finding) => finding.citations)) {
    if (!listed.has(url)) throw new Error(`Research report citation is missing from sources: ${url}`);
  }
  return report;
}

const researchConfigSchema = z.object({
  model: z.string().optional(),
  models: z.object({
    planner: z.string().optional(), executor: z.string().optional(), synthesizer: z.string().optional(),
  }).optional(),
  search: z.custom<SearchConfig>().optional(), fetch: z.custom<FetchConfig>().optional(), crawl: z.custom<CrawlConfig>().optional(),
  maxTasks: z.number().int().positive().default(12),
  /** Total attempts per task, including the first (default 2). Set 1 to disable retries. */
  maxAttemptsPerTask: z.number().int().min(1).default(2),
  maxIterations: z.number().int().positive().default(3),
  /**
   * Shared retry budget across all tasks (default 6); 0 disables retries.
   * A retry needs both this budget and a remaining per-task attempt.
   * With maxAttemptsPerTask: 1, a positive budget is valid but unused.
   */
  maxTotalRetries: z.number().int().nonnegative().default(6),
  /** Advanced overrides for apps that own their retrieval blocks. */
  toolOverrides: z.object({
    search: z.custom<BlockDefinition<any, any>>().optional(),
    fetch: z.custom<BlockDefinition<any, any>>().optional(),
    crawl: z.custom<BlockDefinition<any, any>>().optional(),
  }).optional(),
}).strict().refine((config) => config.model !== undefined || (
  config.models?.planner !== undefined && config.models.executor !== undefined && config.models.synthesizer !== undefined
), {
  message: "provide model or role-specific models",
});

type ResearchConfig = z.output<typeof researchConfigSchema>;
function modelFor(config: ResearchConfig, role: "planner" | "executor" | "synthesizer"): string {
  return config.models?.[role] ?? config.model ?? "openai/gpt-6-luna";
}

function retrievedUrls(method: "search" | "fetch" | "crawl", output: unknown): string[] {
  if (output === null || typeof output !== "object") return [];
  const value = output as Record<string, unknown>;
  if (method === "search") {
    return Array.isArray(value.results)
      ? value.results.flatMap((result) => typeof result === "object" && result !== null && typeof (result as { url?: unknown }).url === "string" ? [(result as { url: string }).url] : [])
      : [];
  }
  if (method === "fetch") return typeof value.url === "string" ? [value.url] : [];
  return Array.isArray(value.pages)
    ? value.pages.flatMap((page) => typeof page === "object" && page !== null && typeof (page as { url?: unknown }).url === "string" ? [(page as { url: string }).url] : [])
    : [];
}

function observableTool(method: "search" | "fetch" | "crawl", tool: BlockDefinition<any, any>) {
  const countAttempt = handler({
    name: `research-${method}-attempt`, inputSchema: z.unknown(), sessionStateSchema: researchSessionStateSchema,
    execute: async (_input, ctx) => {
      const attempts = ctx.session.state.researchToolAttempts;
      await ctx.session.patchState({ researchToolAttempts: { ...attempts, [method]: (attempts[method] ?? 0) + 1 } });
    },
  });
  const recordResult = handler({
    name: `research-${method}-record`, inputSchema: z.unknown(), sessionStateSchema: researchSessionStateSchema,
    execute: async (output, ctx) => {
      const urls = [...new Set([...ctx.session.state.researchRetrievedUrls, ...retrievedUrls(method, output)])];
      await ctx.session.patchState({ researchRetrievedUrls: urls });
    },
  });
  return sequencer({ name: method }).tap(countAttempt).step(tool).tap(recordResult);
}

function createExecutor(config: ResearchConfig) {
  return generator({
    name: "research-executor",
    model: modelFor(config, "executor"),
    inputSchema: z.object({
      stepId: z.string(), goal: z.string(), context: z.string().optional(), dependencyResults: z.record(z.unknown()).optional(),
    }),
    outputSchema: taskResultSchema,
    tools: [
      observableTool("search", config.toolOverrides?.search ?? search(config.search)),
      observableTool("fetch", config.toolOverrides?.fetch ?? fetch(config.fetch)),
      observableTool("crawl", config.toolOverrides?.crawl ?? crawl(config.crawl)),
    ],
    prompt: [
      "Execute one step in a deep-research plan.",
      "Use search to discover sources, fetch to read a page, and crawl when evidence spans multiple pages on one site.",
      "Record only URLs returned by those tools in sources, with the matching retrieval method. Never invent a URL.",
      "Set success false only when the step cannot produce useful evidence; thrown tool errors are retried by the task board.",
    ],
    user: (input) => JSON.stringify(input),
    itemVisibility: { client: true, history: false },
  });
}

function createSynthesizer(config: ResearchConfig) {
  const stateSchema = z.object({ plan: planOutputSchema.nullable().default(null) });
  const capturePlan = handler({
    name: "research-capture-plan", inputSchema: planOutputSchema, sequencerStateSchema: stateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({ plan: input });
    },
  });
  const draft = generator({
    name: "research-synthesizer", model: modelFor(config, "synthesizer"), inputSchema: planOutputSchema,
    outputSchema: reportDraftSchema,
    prompt: [
      "Write a cited research report from the completed task results.",
      "Every substantive finding must cite source URLs present in those results. Never cite any other URL.",
      "Preserve the original question verbatim.",
    ],
    user: (input) => JSON.stringify(input), itemVisibility: { client: true, history: true },
  });
  const validate = handler({
    name: "research-validate-report", inputSchema: reportDraftSchema, outputSchema: researchReportSchema,
    sequencerStateSchema: stateSchema, sessionStateSchema: researchSessionStateSchema,
    execute: (report, ctx) => {
      const plan = ctx.sequencer!.state.plan;
      if (plan === null) throw new Error("Research synthesis is missing its plan state");
      const urls = ctx.session.state.researchRetrievedUrls;
      for (const task of plan.tasks) {
        if (task.result === undefined) continue;
        for (const source of task.result.sources) {
          if (!urls.includes(source.url)) throw new Error(`Research task source was not retrieved: ${source.url}`);
        }
      }
      validateResearchReport(report, new Set(urls));
      return {
        ...report, retrieval: { urls, attempts: ctx.session.state.researchToolAttempts },
        tasks: plan.tasks, completedSteps: plan.completedSteps, totalSteps: plan.totalSteps,
      };
    },
  });
  return sequencer({ name: "research-cited-synthesis", inputSchema: planOutputSchema, stateSchema })
    .tap(capturePlan).step(draft).step(validate);
}

/** Install a planned, retryable deep-research flow. */
export const research = defineKit({
  name: "research",
  config: researchConfigSchema,
  install: ({ config }) => {
    const researchBlock = planAndExecute({
      name: "research", model: modelFor(config, "planner"), stepExecutor: createExecutor(config),
      synthesizer: createSynthesizer(config), outputSchema: researchReportSchema, enableReplanning: true,
      maxIterations: config.maxIterations, maxAttemptsPerTask: config.maxAttemptsPerTask,
      maxTotalRetries: config.maxTotalRetries, maxTotalTasks: config.maxTasks, maxEnqueuedTasks: config.maxTasks,
      instructions: `Plan at most ${config.maxTasks} focused research tasks. Prefer primary sources and make dependencies explicit.`,
    });
    const inputSchema = z.object({ question: z.string().min(1) });
    const resetRetrieval = handler({
      name: "research-reset-retrieval", inputSchema, sessionStateSchema: researchSessionStateSchema,
      execute: async (_input, ctx) => {
        await ctx.session.patchState({ researchRetrievedUrls: [], researchToolAttempts: {} });
      },
    });
    const run = sequencer({ name: "research-run", inputSchema })
      .tap(resetRetrieval)
      .map((input) => ({ goal: input.question })).step(researchBlock);
    return { flows: [defineFlow({
      kind: "research", requireUser: true,
      actions: { run: { inputSchema, block: run, userMessage: (input) => input.question } },
    })()] };
  },
});
