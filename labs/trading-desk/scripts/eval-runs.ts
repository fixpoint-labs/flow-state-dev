/**
 * eval-runs — the run-quality evaluation harness (FIX-790).
 *
 *   pnpm eval sweep    --manifest <file.json> [--concurrency 2] [--out .fsdev/eval]
 *                      [--data-dir <path>]
 *                      [--judge-model <id>] [--no-judges] [--max-cost-usd <n>]
 *                      [--judge-timeout-ms <n>] [--k <n>]
 *   pnpm eval eval     --session <id> [--session <id> ...] [same flags]
 *   pnpm eval variance --session <id> [--session <id> ...] [--k 5]
 *                      [--judge-model <id>] [--out ...] [--data-dir <path>]
 *
 * Uses the framework's off-transport runtime directly: one `FlowState.getRuntime()`
 * per command, then `runAction()` for `analyze` and the zero-model `runArtifacts`
 * read. `sweep` generates a session per manifest tuple, runs `analyze` then
 * evaluates; `eval` evaluates already-stored sessions; `variance` characterizes
 * judge noise (k repeats, no scoreboard append). Deterministic invariants run for
 * free; the LLM judges read the blinded stored bundle, never re-running the pipeline.
 *
 * One command uses one database backing. `sweep` defaults to `<out>/data`, while
 * `eval` and `variance` default to the shared app store; pass `--data-dir
 * <sweep-out>/data` to read an isolated sweep. Exit code is non-zero when any run
 * errored or any HARD invariant failed (soft flags and judge scores never gate).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { checkRun } from "../eval/invariants";
import {
  createJudgeBudget,
  runJudges,
  type JudgeBudget,
  type JudgeReport,
} from "../eval/judge";
import {
  EvalUsageError,
  parsePositiveNumberFlag,
  resolveEvalDataDir,
} from "../eval/options";
import { withEvalRuntime, type EvalRuntime } from "../eval/runtime";
import {
  appendScoreboardLine,
  artifactSnapshotPath,
  assembleQualityRecord,
  buildDetail,
  buildErrorRecord,
  detailSidecarPath,
  writeDetailSidecar,
} from "../eval/scoreboard";
import { krippendorffAlpha, meanStd, standardError } from "../eval/stats";
import {
  runArtifactsStateSchema,
  type RunArtifactsBundle,
} from "../flows/analysis/run-artifacts";
import type { QualityRecord } from "../eval/types";
import { mapLimit } from "../lib/concurrency";

const APP = process.cwd();
const DEFAULT_JUDGE_MODEL = "vercel/openai/gpt-5.4-mini";

// ── arg parsing ──────────────────────────────────────────────────────────
type Args = {
  mode: string;
  values: Map<string, string[]>;
  bools: Set<string>;
};

function parseArgs(argv: string[]): Args {
  const [mode, ...rest] = argv;
  const values = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      bools.add(key);
    } else {
      const list = values.get(key) ?? [];
      list.push(next);
      values.set(key, list);
      i++;
    }
  }
  return { mode: mode ?? "", values, bools };
}

const one = (a: Args, k: string): string | undefined => a.values.get(k)?.[0];
const many = (a: Args, k: string): string[] => a.values.get(k) ?? [];
const has = (a: Args, k: string): boolean => a.bools.has(k);

type EvalOptions = {
  outDir: string;
  judgeModel: string;
  noJudges: boolean;
  k: number | undefined;
  timeoutMs: number | undefined;
  maxCostUsd: number | undefined;
};

function evalOptions(a: Args): EvalOptions {
  const outRaw = one(a, "out") ?? join(".fsdev", "eval");
  return {
    outDir: isAbsolute(outRaw) ? outRaw : join(APP, outRaw),
    judgeModel: one(a, "judge-model") ?? DEFAULT_JUDGE_MODEL,
    noJudges: has(a, "no-judges"),
    k: parsePositiveNumberFlag(one(a, "k"), "k", { integer: true, bare: has(a, "k") }),
    timeoutMs: parsePositiveNumberFlag(one(a, "judge-timeout-ms"), "judge-timeout-ms", {
      integer: true,
      bare: has(a, "judge-timeout-ms"),
    }),
    maxCostUsd: parsePositiveNumberFlag(one(a, "max-cost-usd"), "max-cost-usd", {
      bare: has(a, "max-cost-usd"),
    }),
  };
}

// ── framework runtime ──────────────────────────────────────────────────────
function writeBundleSnapshot(outDir: string, bundle: RunArtifactsBundle): void {
  const path = artifactSnapshotPath(outDir, bundle.summary.sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bundle, null, 2), "utf8");
}

/** Run the zero-model `runArtifacts` action in the current runtime and parse the bundle. */
async function fetchBundle(
  sessionId: string,
  runtime: EvalRuntime,
  outDir: string,
): Promise<{ bundle: RunArtifactsBundle | null; error?: string }> {
  const result = await runtime.run("runArtifacts", {}, sessionId);
  if (result.error !== null) return { bundle: null, error: result.error };
  try {
    const bundle = runArtifactsStateSchema.parse(result.output);
    writeBundleSnapshot(outDir, bundle);
    return { bundle };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { bundle: null, error: `invalid runArtifacts output: ${message}` };
  }
}

// ── evaluation core ────────────────────────────────────────────────────────
async function evaluate(
  bundle: RunArtifactsBundle,
  ranAt: string | null,
  opts: EvalOptions,
  budget: JudgeBudget | undefined,
): Promise<QualityRecord> {
  const evaluatedAt = new Date().toISOString();
  const invariants = checkRun(bundle);
  let judges: JudgeReport | null = null;
  if (!opts.noJudges) {
    judges = await runJudges(bundle, {
      judgeModel: opts.judgeModel,
      k: opts.k,
      timeoutMs: opts.timeoutMs,
      budget,
    });
  }
  const detailPath = detailSidecarPath(opts.outDir, bundle.summary.sessionId, evaluatedAt);
  const record = assembleQualityRecord({ bundle, invariants, judges, evaluatedAt, ranAt, detailPath });
  writeDetailSidecar(detailPath, buildDetail({ bundle, invariants, judges, evaluatedAt }));
  appendScoreboardLine(join(opts.outDir, "scoreboard.jsonl"), record);
  return record;
}

function recordFailed(record: QualityRecord): boolean {
  return record.runStatus === "error" || record.invariants.hardFailed > 0;
}

function logRecord(record: QualityRecord): void {
  const j = record.judges ?? [];
  const judged = j
    .filter((d) => d.status === "scored")
    .map((d) => `${d.dimension}=${d.mean?.toFixed(2)}±${d.std?.toFixed(2)}`)
    .join(" ");
  console.log(
    `[${record.runStatus}] ${record.sessionId} ${record.ticker ?? ""} ` +
      `hard ${record.invariants.hardPassed}✓/${record.invariants.hardFailed}✗ ` +
      `soft ${record.invariants.softPassed}✓/${record.invariants.softFlagged}⚑ ` +
      `${judged}`,
  );
  for (const f of record.invariants.failures) console.error(`  ✗ ${f.id}: ${f.detail}`);
}

// ── modes ──────────────────────────────────────────────────────────────────
type ManifestTuple = {
  ticker: string;
  date?: string;
  costPreset?: "fast" | "full";
  dataSource?: "fixture" | "live" | "record";
  riskMandate?: string;
  userThesis?: string;
  userThesisRationale?: string;
  selectedAccountIds?: string[];
};

async function sweep(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const budget =
    opts.maxCostUsd === undefined ? undefined : createJudgeBudget(opts.maxCostUsd);
  const manifestPath = one(a, "manifest");
  if (!manifestPath) {
    console.error("sweep requires --manifest <file.json>");
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestTuple[];
  const concurrency =
    parsePositiveNumberFlag(one(a, "concurrency"), "concurrency", {
      integer: true,
      bare: has(a, "concurrency"),
    }) ?? 2;
  const stamp = Date.now();
  const dataDir = resolveEvalDataDir({
    mode: "sweep",
    appDir: APP,
    outDir: opts.outDir,
    dataDir: one(a, "data-dir"),
  });

  return withEvalRuntime({ dataDir }, async (runtime) => {
    // Phase A: run each tuple's analyze + read with bounded concurrency. One
    // framework runtime owns the backing; session IDs isolate each run's state.
    type Prepared = { tuple: ManifestTuple; sessionId: string; ranAt: string; bundle: RunArtifactsBundle | null; error?: string };
    const indexedManifest = manifest.map((tuple, index) => ({ tuple, index }));
    const prepared = await mapLimit(indexedManifest, concurrency, async ({ tuple, index }) => {
      const sessionId = `sweep_${tuple.ticker}_${index}_${stamp}`;
      const input: Record<string, unknown> = {
        ticker: tuple.ticker,
        dataSource: tuple.dataSource ?? "fixture",
        costPreset: tuple.costPreset ?? "fast",
      };
      if (tuple.date) input.date = tuple.date;
      if (tuple.riskMandate) input.riskMandate = tuple.riskMandate;
      if (tuple.userThesis) input.userThesis = tuple.userThesis;
      if (tuple.userThesisRationale) input.userThesisRationale = tuple.userThesisRationale;
      if (tuple.selectedAccountIds) input.selectedAccountIds = tuple.selectedAccountIds;

      const ranAt = new Date().toISOString();
      const analyze = await runtime.run("analyze", input, sessionId);
      if (analyze.error !== null) {
        return { tuple, sessionId, ranAt, bundle: null, error: analyze.error } as Prepared;
      }
      const { bundle, error } = await fetchBundle(sessionId, runtime, opts.outDir);
      return { tuple, sessionId, ranAt, bundle, error } as Prepared;
    });

    // Phase B: evaluate + append sequentially so scoreboard lines never interleave.
    let anyFailed = false;
    for (const p of prepared) {
      if (p.bundle === null) {
        const evaluatedAt = new Date().toISOString();
        const detailPath = detailSidecarPath(opts.outDir, p.sessionId, evaluatedAt);
        const rec = buildErrorRecord({
          sessionId: p.sessionId,
          evaluatedAt,
          detail: p.error ?? "run produced no bundle",
          detailPath,
          ticker: p.tuple.ticker,
          date: p.tuple.date ?? null,
        });
        writeDetailSidecar(detailPath, { sessionId: p.sessionId, evaluatedAt, error: p.error });
        appendScoreboardLine(join(opts.outDir, "scoreboard.jsonl"), rec);
        logRecord(rec);
        anyFailed = true;
        continue;
      }
      const record = await evaluate(p.bundle, p.ranAt, opts, budget);
      logRecord(record);
      if (recordFailed(record)) anyFailed = true;
    }

    console.log(`\nScoreboard: ${join(opts.outDir, "scoreboard.jsonl")}`);
    return anyFailed ? 1 : 0;
  });
}

async function evalMode(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const budget =
    opts.maxCostUsd === undefined ? undefined : createJudgeBudget(opts.maxCostUsd);
  const sessions = many(a, "session");
  if (sessions.length === 0) {
    console.error("eval requires at least one --session <id>");
    return 2;
  }
  const dataDir = resolveEvalDataDir({
    mode: "eval",
    appDir: APP,
    outDir: opts.outDir,
    dataDir: one(a, "data-dir"),
  });

  return withEvalRuntime({ dataDir }, async (runtime) => {
    let anyFailed = false;
    for (const sessionId of sessions) {
      const { bundle, error } = await fetchBundle(sessionId, runtime, opts.outDir);
      if (bundle === null) {
        const evaluatedAt = new Date().toISOString();
        const detailPath = detailSidecarPath(opts.outDir, sessionId, evaluatedAt);
        const rec = buildErrorRecord({ sessionId, evaluatedAt, detail: error ?? "no bundle", detailPath });
        writeDetailSidecar(detailPath, { sessionId, evaluatedAt, error });
        appendScoreboardLine(join(opts.outDir, "scoreboard.jsonl"), rec);
        logRecord(rec);
        anyFailed = true;
        continue;
      }
      const ranAt = bundle.decisionSnapshot?.decidedAt ?? null;
      const record = await evaluate(bundle, ranAt, opts, budget);
      logRecord(record);
      if (recordFailed(record)) anyFailed = true;
    }

    console.log(`\nScoreboard: ${join(opts.outDir, "scoreboard.jsonl")}`);
    return anyFailed ? 1 : 0;
  });
}

async function variance(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const budget =
    opts.maxCostUsd === undefined ? undefined : createJudgeBudget(opts.maxCostUsd);
  const sessions = many(a, "session");
  if (sessions.length === 0) {
    console.error("variance requires at least one --session <id>");
    return 2;
  }
  const k = opts.k ?? 5;
  const dataDir = resolveEvalDataDir({
    mode: "variance",
    appDir: APP,
    outDir: opts.outDir,
    dataDir: one(a, "data-dir"),
  });

  return withEvalRuntime({ dataDir }, async (runtime) => {
    type PerSession = { sessionId: string; dimensions: Record<string, number[]> };
    const perSession: PerSession[] = [];
    for (const sessionId of sessions) {
      const { bundle, error } = await fetchBundle(sessionId, runtime, opts.outDir);
      if (bundle === null) {
        console.error(`skipping ${sessionId}: ${error}`);
        continue;
      }
      const report = await runJudges(bundle, {
        judgeModel: opts.judgeModel,
        k,
        timeoutMs: opts.timeoutMs,
        budget,
      });
      if (report === null) {
        console.error(`skipping ${sessionId}: run is ${bundle.summary.status}, judges only grade completed runs`);
        continue;
      }
      const dims: Record<string, number[]> = {};
      for (const d of report.dimensions) if (d.status === "scored") dims[d.key] = d.scores;
      perSession.push({ sessionId, dimensions: dims });
    }

    if (perSession.length === 0) {
      console.error("no usable sessions for variance");
      return 1;
    }

    const dimensionKeys = Array.from(new Set(perSession.flatMap((p) => Object.keys(p.dimensions))));
    const report = {
      generatedAt: new Date().toISOString(),
      judgeModel: opts.judgeModel,
      k,
      sessions: perSession.map((p) => p.sessionId),
      dimensions: dimensionKeys.map((dim) => {
        const bySession = perSession
          .filter((p) => p.dimensions[dim] !== undefined)
          .map((p) => {
            const scores = p.dimensions[dim];
            const { mean, std } = meanStd(scores);
            return { sessionId: p.sessionId, mean, std, noiseBand2SE: 2 * standardError(scores), scores };
          });
        // Alpha only with ≥2 sessions (items); a single item is degenerate (§4.7).
        const matrix = perSession.map((p) => p.dimensions[dim]).filter((s): s is number[] => s !== undefined);
        const alpha = matrix.length >= 2 ? krippendorffAlpha(matrix) : null;
        return { dimension: dim, alpha, unreliable: alpha != null && alpha < 0.8, bySession };
      }),
    };

    const outPath = join(opts.outDir, `variance.${report.generatedAt.replace(/[:.]/g, "-")}.json`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`Variance over ${perSession.length} session(s), k=${k}, judge ${opts.judgeModel}:`);
    for (const d of report.dimensions) {
      const alphaStr = d.alpha == null ? "alpha n/a (<2 sessions)" : `alpha=${d.alpha.toFixed(3)}${d.unreliable ? " ⚠ UNRELIABLE" : ""}`;
      const bands = d.bySession.map((s) => `${s.mean.toFixed(2)}±${(s.noiseBand2SE).toFixed(2)}`).join(" ");
      console.log(`  ${d.dimension}: ${alphaStr}  [${bands}]`);
    }
    console.log(`\nVariance report: ${outPath}`);
    return 0;
  });
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  let code = 0;
  try {
    switch (a.mode) {
      case "sweep":
        code = await sweep(a);
        break;
      case "eval":
        code = await evalMode(a);
        break;
      case "variance":
        code = await variance(a);
        break;
      default:
        console.error("usage: pnpm eval <sweep|eval|variance> [flags] (see scripts/eval-runs.ts header)");
        code = 2;
    }
  } catch (err) {
    if (!(err instanceof EvalUsageError)) throw err;
    console.error(`usage error: ${err.message}`);
    code = 2;
  }
  process.exitCode = code;
}

void main();
