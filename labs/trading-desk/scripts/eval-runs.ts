/**
 * eval-runs — the run-quality evaluation harness (FIX-790).
 *
 *   pnpm eval sweep    --manifest <file.json> [--concurrency 2] [--out .fsdev/eval]
 *                      [--judge-model <id>] [--no-judges] [--max-cost-usd <n>]
 *                      [--judge-timeout-ms <n>] [--k <n>]
 *   pnpm eval eval     --session <id> [--session <id> ...] [same flags]
 *   pnpm eval variance --session <id> [--session <id> ...] [--k 5] [--judge-model <id>] [--out ...]
 *
 * Shells `fsdev run` exactly the way `goals/trading-desk-headless/fixture-run-clean/run.mts`
 * does (cwd = this package, `--capture <file> --quiet`, read `capture.result.output`).
 * `sweep` generates a session per manifest tuple, runs `analyze` then evaluates;
 * `eval` evaluates already-stored sessions; `variance` characterizes judge noise
 * (k repeats, no scoreboard append). Deterministic invariants run for free; the
 * LLM judges read the blinded stored bundle, never re-running the pipeline.
 *
 * PGlite is single-process: sweep gives each run an isolated `TRADING_DESK_DATA_DIR`
 * (safe under `--concurrency > 1`); eval reads the SHARED store, so its reads run
 * strictly sequentially (`--concurrency` is ignored with a warning). Exit code is
 * non-zero when any run errored or any HARD invariant failed (soft flags and judge
 * scores never gate — thresholds are a consumer decision).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { checkRun } from "../eval/invariants";
import { runJudges, type JudgeReport } from "../eval/judge";
import { EvalUsageError, parsePositiveNumberFlag } from "../eval/options";
import {
  appendScoreboardLine,
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
    k: parsePositiveNumberFlag(one(a, "k"), "k", { integer: true }),
    timeoutMs: parsePositiveNumberFlag(one(a, "judge-timeout-ms"), "judge-timeout-ms", {
      integer: true,
    }),
    maxCostUsd: parsePositiveNumberFlag(one(a, "max-cost-usd"), "max-cost-usd"),
  };
}

// ── fsdev shelling ─────────────────────────────────────────────────────────
// `spawn` with stdio ignored (not `execFile`): `--quiet` silences stderr logs but
// `fsdev run` still emits NDJSON on stdout, and a verbose full run would overflow
// execFile's buffer and be mis-recorded as a non-zero exit. We read the `--capture`
// FILE, never the child's stdout, so discarding both streams is correct.
function runFsdev(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["fsdev", "run", "analysis", ...args], { cwd: APP, env, stdio: "ignore" });
    // This repo's @types/node doesn't surface ChildProcess's event methods (the
    // same gap as packages/tools/moat.ts); the runtime methods exist. Wire
    // completion through a minimal EventEmitter view.
    const emitter = child as unknown as NodeJS.EventEmitter;
    emitter.once("error", () => resolve(1));
    emitter.once("close", (code) => resolve(typeof code === "number" ? code : 1));
  });
}

/** The env a session's read runs under. When a sweep at `outDir` isolated the
 *  session into `<outDir>/data/<sessionId>`, point the read at that dir; else use
 *  the shared store (process.env). Lets `eval`/`variance` reach sweep-isolated
 *  sessions given the same `--out`, and fall back for shared-store sessions. */
function sessionEnv(sessionId: string, outDir: string): NodeJS.ProcessEnv {
  const dir = join(outDir, "data", sessionId);
  return existsSync(dir) ? { ...process.env, TRADING_DESK_DATA_DIR: dir } : process.env;
}

function readBundle(capturePath: string): RunArtifactsBundle | null {
  try {
    const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
      result?: { output?: unknown };
    };
    const output = capture.result?.output;
    if (output == null) return null;
    return runArtifactsStateSchema.parse(output);
  } catch {
    return null;
  }
}

/** Run the zero-model `runArtifacts` read for a session and parse the bundle. */
async function fetchBundle(
  sessionId: string,
  env: NodeJS.ProcessEnv,
  outDir: string,
): Promise<{ bundle: RunArtifactsBundle | null; error?: string }> {
  const cap = join(outDir, "captures", `${sessionId}.artifacts.json`);
  mkdirSync(dirname(cap), { recursive: true });
  const exit = await runFsdev(
    ["runArtifacts", "-i", "{}", "--session", sessionId, "--capture", cap, "--quiet"],
    env,
  );
  if (exit !== 0) return { bundle: null, error: `runArtifacts exited ${exit}` };
  const bundle = readBundle(cap);
  return bundle ? { bundle } : { bundle: null, error: "unreadable runArtifacts capture" };
}

// ── evaluation core ────────────────────────────────────────────────────────
async function evaluate(
  bundle: RunArtifactsBundle,
  ranAt: string | null,
  opts: EvalOptions,
): Promise<QualityRecord> {
  const evaluatedAt = new Date().toISOString();
  const invariants = checkRun(bundle);
  let judges: JudgeReport | null = null;
  if (!opts.noJudges) {
    judges = await runJudges(bundle, {
      judgeModel: opts.judgeModel,
      k: opts.k,
      timeoutMs: opts.timeoutMs,
      maxCostUsd: opts.maxCostUsd,
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function sweep(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const manifestPath = one(a, "manifest");
  if (!manifestPath) {
    console.error("sweep requires --manifest <file.json>");
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestTuple[];
  const concurrency =
    parsePositiveNumberFlag(one(a, "concurrency"), "concurrency", { integer: true }) ?? 2;
  const stamp = Date.now();

  // Phase A: run each tuple's analyze + read (bounded concurrency; each run gets
  // an isolated TRADING_DESK_DATA_DIR so PGlite stays single-process-safe).
  type Prepared = { tuple: ManifestTuple; sessionId: string; ranAt: string; bundle: RunArtifactsBundle | null; error?: string };
  const prepared = await mapLimit(manifest, concurrency, async (tuple, i) => {
    const sessionId = `sweep_${tuple.ticker}_${i}_${stamp}`;
    const dataDir = join(opts.outDir, "data", sessionId);
    const env = { ...process.env, TRADING_DESK_DATA_DIR: dataDir };
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

    const analyzeCapture = join(opts.outDir, "captures", `${sessionId}.analyze.json`);
    mkdirSync(dirname(analyzeCapture), { recursive: true });
    const ranAt = new Date().toISOString();
    const exit = await runFsdev(
      ["analyze", "-i", JSON.stringify(input), "--session", sessionId, "--capture", analyzeCapture, "--quiet"],
      env,
    );
    if (exit !== 0) return { tuple, sessionId, ranAt, bundle: null, error: `analyze exited ${exit}` } as Prepared;
    const { bundle, error } = await fetchBundle(sessionId, env, opts.outDir);
    return { tuple, sessionId, ranAt, bundle, error } as Prepared;
  });

  // Phase B: evaluate + append SEQUENTIALLY so scoreboard lines never interleave.
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
    const record = await evaluate(p.bundle, p.ranAt, opts);
    logRecord(record);
    if (recordFailed(record)) anyFailed = true;
  }

  console.log(`\nScoreboard: ${join(opts.outDir, "scoreboard.jsonl")}`);
  return anyFailed ? 1 : 0;
}

async function evalMode(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const sessions = many(a, "session");
  if (sessions.length === 0) {
    console.error("eval requires at least one --session <id>");
    return 2;
  }
  const concurrency = parsePositiveNumberFlag(one(a, "concurrency"), "concurrency", {
    integer: true,
  });
  if (concurrency !== undefined && concurrency > 1) {
    console.warn("eval mode reads the shared store — --concurrency is ignored (reads run sequentially).");
  }

  let anyFailed = false;
  for (const sessionId of sessions) {
    const { bundle, error } = await fetchBundle(sessionId, sessionEnv(sessionId, opts.outDir), opts.outDir);
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
    const record = await evaluate(bundle, ranAt, opts);
    logRecord(record);
    if (recordFailed(record)) anyFailed = true;
  }

  console.log(`\nScoreboard: ${join(opts.outDir, "scoreboard.jsonl")}`);
  return anyFailed ? 1 : 0;
}

async function variance(a: Args): Promise<number> {
  const opts = evalOptions(a);
  const sessions = many(a, "session");
  if (sessions.length === 0) {
    console.error("variance requires at least one --session <id>");
    return 2;
  }
  const k = opts.k ?? 5;

  type PerSession = { sessionId: string; dimensions: Record<string, number[]> };
  const perSession: PerSession[] = [];
  for (const sessionId of sessions) {
    const { bundle, error } = await fetchBundle(sessionId, sessionEnv(sessionId, opts.outDir), opts.outDir);
    if (bundle === null) {
      console.error(`skipping ${sessionId}: ${error}`);
      continue;
    }
    const report = await runJudges(bundle, {
      judgeModel: opts.judgeModel,
      k,
      timeoutMs: opts.timeoutMs,
      maxCostUsd: opts.maxCostUsd,
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
  process.exit(code);
}

void main();
