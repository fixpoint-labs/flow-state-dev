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
 * - every harness report through core's `reportHarnessSpend`: a report with a
 *   `runId` replaces that run's earlier one (FIX-2288), so a harness that
 *   reports as it goes counts each run once, at its latest report; a report
 *   without one is a settled run of its own.
 *
 * `ctx.request.tokenUsage` reads {@link RequestSpendLedger.total}'s `byModel`,
 * so an action's token budget counts model calls in production as in
 * development; a trace row's `modelUsage` is DevTool's and no longer read for
 * it. A request-end hook is handed {@link RequestSpendLedger.takeSinceLastEnding},
 * and core's `readRequestSpend` reads {@link RequestSpendLedger.pending}, the
 * same slice, without taking it (FIX-2288).
 */
import { cacheTokensOf } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import type { GeneratorModelResultPayload, HarnessRunSpend, ModelUsageEntry, RequestSpend } from "@flow-state-dev/core/types";

/** One request's ledger. */
export interface RequestSpendLedger {
  /** Add one model result, unless it is an aggregate the ledger already counted. */
  addModelResult(report: GeneratorModelResultPayload): void;
  /** Add one harness report: replaces its run's earlier report when it names a `runId`. */
  reportHarnessRun(run: HarnessRunSpend): void;
  /** Everything counted so far. */
  total(): RequestSpend;
  /**
   * What was counted since the last call (since the ledger was built, on the
   * first), so a request that ends more than once hands each part on once.
   */
  takeSinceLastEnding(): RequestSpend;
  /** What {@link takeSinceLastEnding} would hand on now, without taking it (FIX-2288). */
  pending(): RequestSpend;
}

/**
 * Build one request's ledger. `carried` is what the request spent before a
 * suspension it resumes from: counted in {@link RequestSpendLedger.total}, and
 * already handed on, so {@link RequestSpendLedger.takeSinceLastEnding} never
 * hands it on again. `recovered` is what a run that never ended (its process
 * died) left in the log: counted, and handed on at this run's first ending.
 */
export function createRequestSpendLedger(
  carried: Readonly<Record<string, ModelUsageEntry>> = {},
  recovered: Readonly<Record<string, ModelUsageEntry>> = {}
): RequestSpendLedger {
  const byModel: Record<string, ModelUsageEntry> = Object.assign(Object.create(null), copyOf(carried));
  for (const [model, entry] of Object.entries(recovered)) addEntry((byModel[model] ??= emptyEntry()), entry);
  // One entry per run, as last reported, in the order last reported. A report
  // with no run id is a run of its own, under a key nothing else reports to.
  const harnessRuns = new Map<string, HarnessRunSpend>();
  // Each run as the last ending handed it on.
  let takenRuns = new Map<string, HarnessRunSpend>();
  let takenByModel: Record<string, ModelUsageEntry> = copyOf(carried);
  let settledRuns = 0;

  function since(): RequestSpend {
    const byModelSince: Record<string, ModelUsageEntry> = {};
    for (const [model, entry] of Object.entries(byModel)) {
      const taken = takenByModel[model] ?? emptyEntry();
      const delta: ModelUsageEntry = {
        prompt: entry.prompt - taken.prompt,
        completion: entry.completion - taken.completion,
        total: entry.total - taken.total,
        cacheReadTokens: entry.cacheReadTokens - taken.cacheReadTokens,
        cacheCreationTokens: entry.cacheCreationTokens - taken.cacheCreationTokens
      };
      if (Object.values(delta).some((n) => n !== 0)) byModelSince[model] = delta;
    }
    const runs: HarnessRunSpend[] = [];
    for (const [key, run] of harnessRuns) {
      const taken = takenRuns.get(key);
      if (taken === undefined) runs.push({ ...run });
      else if (!sameRun(taken, run)) runs.push(changeOf(taken, run));
    }
    return { byModel: byModelSince, harnessRuns: runs };
  }

  return {
    addModelResult(report) {
      if (report.countsIn === "trace" || report.usage === undefined) return;
      addEntry((byModel[report.model] ??= emptyEntry()), entryOf(report));
    },
    reportHarnessRun(run) {
      const key = run.runId === undefined ? `settled:${settledRuns++}` : `run:${run.runId}`;
      // Moved to the end: the latest report is the last entry.
      harnessRuns.delete(key);
      harnessRuns.set(key, { ...run });
    },
    total() {
      return { byModel: copyOf(byModel), harnessRuns: [...harnessRuns.values()].map((run) => ({ ...run })) };
    },
    takeSinceLastEnding() {
      const taken = since();
      takenByModel = copyOf(byModel);
      takenRuns = new Map([...harnessRuns].map(([key, run]) => [key, { ...run }]));
      return taken;
    },
    pending() {
      return since();
    }
  };
}

/** Whether two reports of one run say the same. */
function sameRun(a: HarnessRunSpend, b: HarnessRunSpend): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.costUsd === b.costUsd &&
    a.billing === b.billing &&
    a.model === b.model
  );
}

/**
 * A run reported again after an ending handed it on: its change since, so the
 * run's tokens are handed on once across endings. A count the earlier report
 * lacked is handed on whole; one the later report lacks stays `null`.
 */
function changeOf(taken: HarnessRunSpend, run: HarnessRunSpend): HarnessRunSpend {
  const minus = (now: number | null, then: number | null) => (now === null ? null : now - (then ?? 0));
  return {
    ...run,
    inputTokens: minus(run.inputTokens, taken.inputTokens),
    outputTokens: minus(run.outputTokens, taken.outputTokens),
    costUsd: minus(run.costUsd, taken.costUsd)
  };
}

/**
 * What the request's log says its model calls spent after item
 * `afterItemIndex`: each block trace's `modelUsage`, by model. A request whose
 * process died mid-run settled no spend, and its continuation replays the
 * blocks the log says finished without calling their models again, so this is
 * what those calls cost.
 */
export function loggedSpendOf(items: readonly RuntimeItem[], afterItemIndex: number): Record<string, ModelUsageEntry> {
  const byModel: Record<string, ModelUsageEntry> = {};
  for (const item of items) {
    if (item.type !== "block_trace" || item.itemIndex <= afterItemIndex) continue;
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
  return byModel;
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
