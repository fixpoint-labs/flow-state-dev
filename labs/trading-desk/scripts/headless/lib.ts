/**
 * Pure helpers for the headless harness — manifest expansion, run-status →
 * exit-code mapping, the error-summary fallback, and session-id minting.
 *
 * Kept separate from `harness.ts` (which spawns `fsdev` subprocesses) so these
 * stay unit-testable without a child process.
 */
import { z } from "zod";
import { analyzeInputSchema, type AnalyzeInput } from "../../src/flows/analysis/flow-schema";
import {
  runSummaryStateSchema,
  type RunStatus,
  type RunSummary,
} from "../../src/flows/analysis/run-summary";

/** A batch manifest: either an explicit `runs` list, or a `tickers × axes`
 *  matrix expanded by cartesian product. `scoreboard` is the JSONL output path
 *  (resolved from cwd); `concurrency` bounds in-flight runs (default 1). */
export const manifestSchema = z.object({
  concurrency: z.number().int().min(1).optional(),
  scoreboard: z.string(),
  runs: z.array(z.record(z.string(), z.unknown())).optional(),
  tickers: z.array(z.string()).optional(),
  axes: z
    .object({
      date: z.array(z.string()).optional(),
      costPreset: z.array(z.enum(["fast", "full"])).optional(),
      dataSource: z.array(z.enum(["fixture", "live", "record"])).optional(),
      riskMandate: z.array(z.string().nullable()).optional(),
    })
    .optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Expand a manifest into the concrete analyze inputs to run. An explicit `runs`
 * list wins; otherwise the cartesian product of `tickers × axes`, with each
 * absent axis falling back to the analyze-input default. Every produced input is
 * validated against `analyzeInputSchema` (so defaults are filled and bad values
 * throw early). Empty `tickers` with no `runs` → `[]`.
 */
export function expandManifest(manifest: Manifest): AnalyzeInput[] {
  if (manifest.runs && manifest.runs.length > 0) {
    return manifest.runs.map((run) => analyzeInputSchema.parse(run));
  }
  const tickers = manifest.tickers ?? [];
  if (tickers.length === 0) return [];

  // `undefined` for an absent axis means "let the schema default decide".
  const dates = manifest.axes?.date ?? [undefined];
  const presets = manifest.axes?.costPreset ?? [undefined];
  const sources = manifest.axes?.dataSource ?? [undefined];
  const mandates = manifest.axes?.riskMandate ?? [undefined];

  const inputs: AnalyzeInput[] = [];
  for (const ticker of tickers) {
    for (const date of dates) {
      for (const costPreset of presets) {
        for (const dataSource of sources) {
          for (const riskMandate of mandates) {
            const raw: Record<string, unknown> = { ticker };
            if (date !== undefined) raw.date = date;
            if (costPreset !== undefined) raw.costPreset = costPreset;
            if (dataSource !== undefined) raw.dataSource = dataSource;
            if (riskMandate !== undefined) raw.riskMandate = riskMandate;
            inputs.push(analyzeInputSchema.parse(raw));
          }
        }
      }
    }
  }
  return inputs;
}

/** Single-run exit code: completed → 0, stopped → 2, error → 1. A shell loop
 *  reads this to tell a clean completion from a graceful stop from a crash; the
 *  JSON `status` field is authoritative regardless. */
export function exitCodeForStatus(status: RunStatus): number {
  return status === "completed" ? 0 : status === "stopped" ? 2 : 1;
}

/** Mint a unique session id for one run, so the harness can pass it to both the
 *  `analyze` and `runSummary` invocations and read the same session back. */
export function makeSessionId(input: AnalyzeInput): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `run_${input.ticker}_${input.date}_${rand}`;
}

/** The `RunSummary` the harness synthesizes when `analyze` itself failed — the
 *  read action never ran, so there is no stored summary to project. Carries the
 *  input identity plus the failure context. */
export function errorSummary(args: {
  input: AnalyzeInput;
  sessionId: string;
  ranAt: string;
  exitCode: number | null;
  error: string;
  durationMs: number | null;
  capturePath: string | null;
}): RunSummary {
  const { input, sessionId, ranAt, exitCode, error, durationMs, capturePath } = args;
  // Let the schema fill the ~14 nullable decision/mandate/stop fields from their
  // `.default(null)`, so this stays in lockstep with the schema without a second
  // full literal to maintain.
  return runSummaryStateSchema.parse({
    ticker: input.ticker,
    date: input.date,
    costPreset: input.costPreset,
    dataSource: input.dataSource,
    mandateId: input.riskMandate ?? null,
    sessionId,
    status: "error",
    durationMs,
    exitCode,
    error,
    capturePath,
    ranAt,
    memos: [],
    memoErrors: 0,
  });
}
