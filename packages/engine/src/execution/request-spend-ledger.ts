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
import type { GeneratorModelUsage, HarnessRunSpend, ModelUsageEntry, RequestSpend } from "@flow-state-dev/core/types";

/** A model result as the base `onGeneratorModelResult` handler receives it. */
export interface ModelResultReport {
  model: string;
  usage?: GeneratorModelUsage;
  providerMetadata?: Record<string, Record<string, unknown>>;
  countsIn?: "ledger" | "trace";
}

/** One request's ledger. */
export interface RequestSpendLedger {
  /** Add one model result, unless it is an aggregate the ledger already counted. */
  addModelResult(report: ModelResultReport): void;
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

/** Build one request's ledger. */
export function createRequestSpendLedger(): RequestSpendLedger {
  const byModel: Record<string, ModelUsageEntry> = Object.create(null);
  const harnessRuns: HarnessRunSpend[] = [];
  let takenByModel: Record<string, ModelUsageEntry> = Object.create(null);
  let takenRuns = 0;

  return {
    addModelResult(report) {
      if (report.countsIn === "trace" || report.usage === undefined) return;
      const entry = (byModel[report.model] ??= emptyEntry());
      const added = entryOf(report);
      entry.prompt += added.prompt;
      entry.completion += added.completion;
      entry.total += added.total;
      entry.cacheReadTokens += added.cacheReadTokens;
      entry.cacheCreationTokens += added.cacheCreationTokens;
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
function entryOf(report: ModelResultReport): ModelUsageEntry {
  const usage = report.usage!;
  const anthropic = report.providerMetadata?.anthropic ?? {};
  const cacheRead =
    usage.cacheReadInputTokens ?? (typeof anthropic.cacheReadInputTokens === "number" ? anthropic.cacheReadInputTokens : 0);
  const cacheCreation =
    usage.cacheCreationInputTokens ??
    (typeof anthropic.cacheCreationInputTokens === "number" ? anthropic.cacheCreationInputTokens : 0);
  return {
    prompt: Number(usage.promptTokens ?? 0),
    completion: Number(usage.completionTokens ?? 0),
    total: Number(usage.totalTokens ?? 0),
    cacheReadTokens: Number(cacheRead),
    cacheCreationTokens: Number(cacheCreation)
  };
}
