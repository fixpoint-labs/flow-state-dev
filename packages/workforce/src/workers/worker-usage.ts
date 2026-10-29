/**
 * `worker-usage/**` — what each worker spent of a user's subscriptions and
 * keys, by UTC day, and the one query everything reads it through (FIX-2145).
 *
 * Every request a worker's session runs hands its spend to a request-end hook
 * {@link workerSpendHook} builds, which `installation.session()` puts on every
 * worker flow: its model calls by model, and each harness run a harness
 * reported through `reportHarnessSpend`. {@link recordWorkerSpend} adds it to
 * the user's record for that worker and day, and {@link workerUsageAction}
 * reads a period of records back, one row per worker.
 *
 * ## One writer, one reader
 *
 * - **Per user.** The collection is `user`-scoped, so a reader sees only the
 *   spend of requests they made. The query takes no user argument.
 * - **Writes add, atomically.** Two requests ending at once for one worker and
 *   day both land. A failed write is logged and never fails the request.
 * - **A dollar figure only where one was billed.** A source's `costUsd` sums
 *   only the costs a harness reported on an `api-key` run. Everything else
 *   carries tokens, and `costUsd: null`, which a reader shows as not reported.
 * - **A run that reported nothing is counted, not zeroed.** It adds one to
 *   `runs` and to `unreported`, and no tokens.
 * - **Kept, never deleted.** A worker gone from the roster keeps its records
 *   and is read back marked `gone`.
 *
 * ## The record
 *
 * Key `<YYYY-MM-DD>/<worker>`, so a period is read as one prefix per day and
 * touches at most days × workers records. One entry per source: a model id
 * (`kind: "model"`, `runs` counts request endings that called it: a
 * request that suspends and resumes counts once per ending) or a harness name
 * with its billing (`kind: "harness"`, `runs` counts runs).
 */
import { defineCapability, defineResourceCollection, handler } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type {
  BlockContext,
  HarnessBilling,
  RequestEndHook,
  RequestSpend,
  SessionRequestEndHook
} from "@flow-state-dev/core/types";
import { z } from "zod";
import { WORKER_ID_STATE_KEY } from "./keys";
import type { WorkerInstallation, WorkerTurnContext } from "./installation";

/** Accessor key and storage prefix for the usage records. */
export const WORKER_USAGE_RESOURCE = "worker-usage" as const;

/** The query's action name: `actions: { [WORKER_USAGE_ACTION]: workerUsageAction(installation) }`. */
export const WORKER_USAGE_ACTION = "workerUsage" as const;

/** The longest period the query reads, in days. */
export const WORKER_USAGE_MAX_DAYS = 90;

/** The period the query reads when none is asked for, in days. */
export const WORKER_USAGE_DEFAULT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One source's spend: a model, or a harness billed one way. */
const sourceSpendSchema = z.object({
  source: z.string(),
  kind: z.enum(["model", "harness"]),
  billing: z.enum(["api-key", "subscription"]).nullable().default(null),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  /** The billed cost a harness reported on an `api-key` run, summed; `null` when none was. */
  costUsd: z.number().nullable().default(null),
  /** Harness runs, or request endings that called the model. */
  runs: z.number().default(0),
  /** Runs that reported no tokens. */
  unreported: z.number().default(0)
});

/** One source's spend, as a record and a query row carry it. */
export type WorkerSourceSpend = z.infer<typeof sourceSpendSchema>;

/** One worker's record for one UTC day. Every field defaults (BP-023/BP-030). */
export const workerUsageStateSchema = z.object({
  worker: z.string().default(""),
  day: z.string().default(""),
  sources: z.array(sourceSpendSchema).default([])
});

export type WorkerUsageState = z.infer<typeof workerUsageStateSchema>;

/**
 * The collection, which every worker flow installs through
 * `installation.resources`. `llmWritable: false`: {@link recordWorkerSpend} is
 * its only writer. Not client-readable: the query is the read path.
 */
export const workerUsageCollection = defineResourceCollection({
  pattern: `${WORKER_USAGE_RESOURCE}/**`,
  // A user's own requests, at the request's principal (D1).
  scope: "user",
  // BP-027: a user-scoped collection defaults to shared across flows.
  flowIsolation: false,
  // Never loaded on a run that doesn't read it.
  prefetchMode: "lazy",
  stateSchema: workerUsageStateSchema,
  llmWritable: false
});

/** The collection, installed on the query action. */
const workerUsageCapability = defineCapability({
  name: "workforce:worker-usage",
  resources: { [WORKER_USAGE_RESOURCE]: workerUsageCollection }
});

/** One worker's row for a period, as {@link workerUsageAction} answers it. */
export interface WorkerUsageRow {
  /** The worker's id. */
  worker: string;
  /** `true` when the worker is no longer on the reader's roster. */
  gone: boolean;
  /** Tokens across every source. */
  tokens: { input: number; output: number };
  /** Billed cost across every source, or `null` when no source reported one. */
  costUsd: number | null;
  /** Each source's spend, ordered by source, then billing. */
  bySource: WorkerSourceSpend[];
}

/** The UTC day `at` falls on, as `YYYY-MM-DD`. */
function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The record key for one worker and day. A worker id is one key segment. */
function keyOf(day: string, worker: string): string {
  return `${day}/${encodeURIComponent(worker)}`;
}

/** Add one source's spend into a list of sources, matched on source, `kind` and billing. */
function addSource(sources: WorkerSourceSpend[], add: WorkerSourceSpend): WorkerSourceSpend[] {
  const at = sources.findIndex((s) => s.source === add.source && s.kind === add.kind && s.billing === add.billing);
  if (at < 0) return [...sources, add];
  const was = sources[at]!;
  const merged: WorkerSourceSpend = {
    ...was,
    inputTokens: was.inputTokens + add.inputTokens,
    outputTokens: was.outputTokens + add.outputTokens,
    costUsd: was.costUsd === null && add.costUsd === null ? null : (was.costUsd ?? 0) + (add.costUsd ?? 0),
    runs: was.runs + add.runs,
    unreported: was.unreported + add.unreported
  };
  return sources.map((s, i) => (i === at ? merged : s));
}

/** What a request spent, as the sources it adds. Empty when it spent nothing. */
function sourcesOf(spend: RequestSpend): WorkerSourceSpend[] {
  let sources: WorkerSourceSpend[] = [];
  for (const [model, entry] of Object.entries(spend.byModel)) {
    sources = addSource(sources, {
      source: model,
      kind: "model",
      billing: null,
      inputTokens: entry.prompt,
      outputTokens: entry.completion,
      costUsd: null,
      runs: 1,
      unreported: 0
    });
  }
  for (const run of spend.harnessRuns) {
    const reported = run.inputTokens !== null || run.outputTokens !== null;
    const billing: HarnessBilling | null = run.billing;
    sources = addSource(sources, {
      source: run.harness,
      kind: "harness",
      billing,
      inputTokens: run.inputTokens ?? 0,
      outputTokens: run.outputTokens ?? 0,
      // D2: a dollar figure only for a billed key, and only when the harness reported one.
      costUsd: billing === "api-key" && run.costUsd !== null ? run.costUsd : null,
      runs: 1,
      unreported: reported ? 0 : 1
    });
  }
  return sources;
}

/** The slice of a record ref this module uses. Structural. */
interface UsageRef {
  path: string;
  state: unknown;
  updateState(updater: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}

/** The slice of the collection this module uses. Structural. */
interface UsageCollectionRef {
  getOptional(key: string): Promise<UsageRef | undefined>;
  upsert(key: string, update: Record<string, unknown>, createOnly?: Record<string, unknown>): Promise<unknown>;
  list(prefix?: string): Promise<UsageRef[]>;
}

/** The collection on `ctx`, or `undefined` when the flow doesn't install it. */
function collectionOn(ctx: { readonly resources?: unknown }): UsageCollectionRef | undefined {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[WORKER_USAGE_RESOURCE];
  return ref !== undefined && typeof (ref as UsageCollectionRef).upsert === "function" ? (ref as UsageCollectionRef) : undefined;
}

/** A missing collection, named for the developer who has to install it. */
function missingCollection(): Error {
  return new Error(
    `[workforce] the "${WORKER_USAGE_RESOURCE}" collection is not registered on this flow; ` +
      "spread `installation.resources` into the worker flow's `resources`."
  );
}

/**
 * Add what one request spent to `worker`'s record for the UTC day `at` falls
 * on. The only writer of `worker-usage/**`. Atomic: concurrent writes for one
 * record both land. Writes nothing when the request spent nothing.
 */
export async function recordWorkerSpend(
  ctx: { readonly resources?: unknown },
  worker: string,
  spend: RequestSpend,
  at: number = Date.now()
): Promise<void> {
  const added = sourcesOf(spend);
  if (added.length === 0) return;
  const collection = collectionOn(ctx);
  if (collection === undefined) throw missingCollection();
  const day = dayOf(at);
  const key = keyOf(day, worker);
  await collection.upsert(key, {}, { worker, day });
  const ref = await collection.getOptional(key);
  if (ref === undefined) throw new Error(`[workforce] the usage record "${key}" was not created`);
  await updateStateWith<Record<string, unknown>, void>(ref, (current) => {
    const stored = workerUsageStateSchema.parse(current ?? {});
    const sources = added.reduce(addSource, stored.sources);
    return { state: { ...current, worker, day, sources }, result: undefined };
  });
}

/**
 * The request-end hook a worker flow's session installs: when a request
 * ends, its spend is added to the record of the worker its session names.
 * A session that names no worker writes nothing. A failed write is logged
 * and never fails the request. A flow without the collection fails loudly
 * in development and warns in production.
 */
export const workerSpendHook: SessionRequestEndHook = (ctx) => {
  const hook: RequestEndHook = async (ending) => {
    const worker = (ctx.session?.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
    if (typeof worker !== "string" || worker === "") return;
    if (collectionOn(ctx) === undefined && sourcesOf(ending.spend).length > 0) {
      if (process.env.NODE_ENV !== "production") return { fail: missingCollection() };
      console.warn(missingCollection().message);
      return;
    }
    try {
      await recordWorkerSpend(ctx, worker, ending.spend);
    } catch (error) {
      console.warn(`[workforce] could not record worker "${worker}"'s usage: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return hook;
};

/**
 * Read `days` UTC days of the caller's records, ending today, as one row per
 * worker. Marks a worker `gone` when it is not in `onRoster`.
 */
export async function readWorkerUsage(
  ctx: { readonly resources?: unknown },
  days: number,
  onRoster: ReadonlySet<string>,
  now: number = Date.now()
): Promise<WorkerUsageRow[]> {
  const collection = collectionOn(ctx);
  if (collection === undefined) throw missingCollection();
  const byWorker = new Map<string, WorkerSourceSpend[]>();
  const listed = await Promise.all(
    Array.from({ length: days }, (_, back) => collection.list(`${dayOf(now - back * DAY_MS)}/`))
  );
  for (const refs of listed) {
    for (const ref of refs) {
      const state = workerUsageStateSchema.parse(ref.state ?? {});
      if (state.worker === "") continue;
      byWorker.set(state.worker, state.sources.reduce(addSource, byWorker.get(state.worker) ?? []));
    }
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byWorker.entries()]
    .sort(([a], [b]) => order(a, b))
    .map(([worker, sources]) => {
      const bySource = [...sources].sort((a, b) => order(a.source, b.source) || order(a.billing ?? "", b.billing ?? ""));
      const costs = bySource.filter((s) => s.costUsd !== null);
      return {
        worker,
        gone: !onRoster.has(worker),
        tokens: {
          input: bySource.reduce((sum, s) => sum + s.inputTokens, 0),
          output: bySource.reduce((sum, s) => sum + s.outputTokens, 0)
        },
        costUsd: costs.length === 0 ? null : costs.reduce((sum, s) => sum + s.costUsd!, 0),
        bySource
      };
    });
}

const workerSourceSpendRowSchema = z.object({
  source: z.string(),
  kind: z.enum(["model", "harness"]),
  billing: z.enum(["api-key", "subscription"]).nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().nullable(),
  runs: z.number(),
  unreported: z.number()
});

const workerUsageRowSchema = z.object({
  worker: z.string(),
  gone: z.boolean(),
  tokens: z.object({ input: z.number(), output: z.number() }),
  costUsd: z.number().nullable(),
  bySource: z.array(workerSourceSpendRowSchema)
});

/**
 * The `workerUsage` query, as one flow-level action a host puts on one flow:
 * `actions: { [WORKER_USAGE_ACTION]: workerUsageAction(installation) }`.
 *
 * Input `{ days?: number }`, 1 to {@link WORKER_USAGE_MAX_DAYS}, default
 * {@link WORKER_USAGE_DEFAULT_DAYS}: today and the days before it, in UTC.
 * Output `{ workers }`, one {@link WorkerUsageRow} per worker that spent in
 * the period, ordered by id. Zero-model.
 */
export function workerUsageAction(installation: WorkerInstallation) {
  return {
    description:
      "How many tokens each of your workers used, by model and coding harness, over the last `days` UTC days " +
      `(default ${WORKER_USAGE_DEFAULT_DAYS}). A cost appears only where a harness reported one on an API key.`,
    block: handler({
      name: "worker-usage",
      inputSchema: z.object({ days: z.number().int().min(1).max(WORKER_USAGE_MAX_DAYS).optional() }),
      outputSchema: z.object({ workers: z.array(workerUsageRowSchema) }),
      uses: [workerUsageCapability],
      resources: { ...installation.resources },
      execute: async (input, ctx: BlockContext) => {
        const onRoster = new Set((await installation.roster(ctx as unknown as WorkerTurnContext)).map((w) => w.id));
        return { workers: await readWorkerUsage(ctx, input.days ?? WORKER_USAGE_DEFAULT_DAYS, onRoster) };
      }
    })
  };
}
