/**
 * A request's spend ledger (FIX-2145): the one count of what a request spent.
 *
 * Built once per request beside the request-end registry. Two things feed it:
 *
 * - every model result a generator or evaluator reports, through the base
 *   `onGeneratorModelResult` handler the execution context installs (per-block
 *   captures chain up to it), added per model; a report marked
 *   `countsIn: "trace"` is a multi-step run's aggregate whose steps were
 *   already added, and is skipped;
 * - every harness run a harness settles through core's `reportHarnessSpend`,
 *   appended as it was reported.
 *
 * `ctx.request.tokenUsage` reads {@link RequestSpendLedger.total}'s `byModel`,
 * so an action's token budget counts model calls in production as in
 * development; a trace row's `modelUsage` is DevTool's and no longer read for
 * it. A request-end hook is handed {@link RequestSpendLedger.takeSinceLastEnding}.
 */
import { cacheTokensOf } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import type { GeneratorModelResultPayload, HarnessRunSpend, ModelUsageEntry, RequestSpend } from "@flow-state-dev/core/types";

/** One request's ledger. */
export interface RequestSpendLedger {
  /** Add one model result, unless it is an aggregate the ledger already counted. */
  addModelResult(report: GeneratorModelResultPayload): void;
  /** Append one settled harness run. */
  reportHarnessRun(run: HarnessRunSpend): void;
  /** Everything counted so far. */
  total(): RequestSpend;
  /**
   * What was counted since the last call (since the ledger was built, on the
   * first), so a request that ends more than once hands each part on once.
   */
  takeSinceLastEnding(): RequestSpend;
}

/**
 * Build one request's ledger. `carried` is what the request spent before a
 * suspension it resumes from: counted in {@link RequestSpendLedger.total}, and
 * already handed on, so {@link RequestSpendLedger.takeSinceLastEnding} never
 * hands it on again. `recovered` and `recoveredHarnessRuns` are what a run that
 * never ended (its process died) left in the log: counted, and handed on at
 * this run's first ending.
 */
export function createRequestSpendLedger(
  carried: Readonly<Record<string, ModelUsageEntry>> = {},
  recovered: Readonly<Record<string, ModelUsageEntry>> = {},
  recoveredHarnessRuns: readonly HarnessRunSpend[] = []
): RequestSpendLedger {
  const byModel: Record<string, ModelUsageEntry> = Object.assign(Object.create(null), copyOf(carried));
  for (const [model, entry] of Object.entries(recovered)) addEntry((byModel[model] ??= emptyEntry()), entry);
  const harnessRuns: HarnessRunSpend[] = recoveredHarnessRuns.map((run) => ({ ...run }));
  let takenByModel: Record<string, ModelUsageEntry> = copyOf(carried);
  let takenRuns = 0;

  return {
    addModelResult(report) {
      if (report.countsIn === "trace" || report.usage === undefined) return;
      addEntry((byModel[report.model] ??= emptyEntry()), entryOf(report));
    },
    reportHarnessRun(run) {
      harnessRuns.push({ ...run });
    },
    total() {
      return { byModel: copyOf(byModel), harnessRuns: harnessRuns.map((run) => ({ ...run })) };
    },
    takeSinceLastEnding() {
      const since: Record<string, ModelUsageEntry> = {};
      for (const [model, entry] of Object.entries(byModel)) {
        const taken = takenByModel[model] ?? emptyEntry();
        const delta: ModelUsageEntry = {
          prompt: entry.prompt - taken.prompt,
          completion: entry.completion - taken.completion,
          total: entry.total - taken.total,
          cacheReadTokens: entry.cacheReadTokens - taken.cacheReadTokens,
          cacheCreationTokens: entry.cacheCreationTokens - taken.cacheCreationTokens
        };
        if (Object.values(delta).some((n) => n !== 0)) since[model] = delta;
      }
      const runs = harnessRuns.slice(takenRuns).map((run) => ({ ...run }));
      takenByModel = copyOf(byModel);
      takenRuns = harnessRuns.length;
      return { byModel: since, harnessRuns: runs };
    }
  };
}

/**
 * What the request's log says it spent after item `afterItemIndex`: each block
 * trace's `modelUsage`, by model, and the harness runs its `harnessSpend`
 * lists. A request whose process died mid-run settled no spend, and its
 * continuation replays the blocks the log says finished without running them
 * again, so this is what those blocks cost.
 */
export function loggedSpendOf(
  items: readonly RuntimeItem[],
  afterItemIndex: number
): { byModel: Record<string, ModelUsageEntry>; harnessRuns: HarnessRunSpend[] } {
  const byModel: Record<string, ModelUsageEntry> = {};
  const harnessRuns: HarnessRunSpend[] = [];
  for (const item of items) {
    if (item.type !== "block_trace" || item.itemIndex <= afterItemIndex) continue;
    for (const run of (item as BlockTraceItem).harnessSpend ?? []) harnessRuns.push({ ...run });
    const usage = (item as BlockTraceItem).modelUsage;
    if (usage === undefined) continue;
    addEntry((byModel[usage.model] ??= emptyEntry()), {
      prompt: Number(usage.promptTokens ?? 0),
      completion: Number(usage.completionTokens ?? 0),
      total: Number(usage.totalTokens ?? 0),
      cacheReadTokens: Number(usage.cacheReadTokens ?? 0),
      cacheCreationTokens: Number(usage.cacheCreationTokens ?? 0)
    });
  }
  return { byModel, harnessRuns };
}

/**
 * Per request store, the requests whose interrupted run is still ending in
 * this process, by how many such runs are. While one is, that run hands on
 * what the request spent through its ending, so a continuation counts that
 * spend toward its budget but must not hand it on again. A run in another
 * process, live or dead, is never in here: its continuation hands the spend on,
 * since a dead run never will.
 */
const endingInterruptedRuns = new WeakMap<object, Map<string, number>>();

/**
 * Mark `requestId`'s interrupted run as ending in this process, before its
 * record says `interrupted`, so no continuation reads that record unmarked
 * while the run can still hand its spend on.
 *
 * @returns The release, to call once the ending has handed the spend on and
 *   recorded it.
 */
export function holdInterruptedEnding(requestStore: object, requestId: string): () => void {
  let runs = endingInterruptedRuns.get(requestStore);
  if (runs === undefined) endingInterruptedRuns.set(requestStore, (runs = new Map()));
  runs.set(requestId, (runs.get(requestId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (runs.get(requestId) ?? 1) - 1;
    if (left > 0) runs.set(requestId, left);
    else runs.delete(requestId);
  };
}

/** Whether an interrupted run of `requestId` is still ending in this process. */
export function isInterruptedEndingHeld(requestStore: object, requestId: string): boolean {
  return endingInterruptedRuns.get(requestStore)?.has(requestId) === true;
}

/** `a` and `b` added up by model, as a new map; neither is changed. */
export function sumSpend(
  a: Readonly<Record<string, ModelUsageEntry>>,
  b: Readonly<Record<string, ModelUsageEntry>>
): Record<string, ModelUsageEntry> {
  const sum = copyOf(a);
  for (const [model, entry] of Object.entries(b)) addEntry((sum[model] ??= emptyEntry()), entry);
  return sum;
}

function addEntry(entry: ModelUsageEntry, added: ModelUsageEntry): void {
  entry.prompt += added.prompt;
  entry.completion += added.completion;
  entry.total += added.total;
  entry.cacheReadTokens += added.cacheReadTokens;
  entry.cacheCreationTokens += added.cacheCreationTokens;
}

function emptyEntry(): ModelUsageEntry {
  return { prompt: 0, completion: 0, total: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

function copyOf(byModel: Record<string, ModelUsageEntry>): Record<string, ModelUsageEntry> {
  return Object.fromEntries(Object.entries(byModel).map(([model, entry]) => [model, { ...entry }]));
}

/**
 * One report's usage as a ledger entry. Cache fields prefer the adapter's
 * normalised ones and fall back to Anthropic's provider metadata, as the
 * trace capture reads them.
 */
function entryOf(report: GeneratorModelResultPayload): ModelUsageEntry {
  const usage = report.usage!;
  const cache = cacheTokensOf(usage, report.providerMetadata);
  return {
    prompt: Number(usage.promptTokens ?? 0),
    completion: Number(usage.completionTokens ?? 0),
    total: Number(usage.totalTokens ?? 0),
    cacheReadTokens: Number(cache.read ?? 0),
    cacheCreationTokens: Number(cache.creation ?? 0)
  };
}
