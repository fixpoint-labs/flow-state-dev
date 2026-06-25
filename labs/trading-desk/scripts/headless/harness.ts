/**
 * `runOne` — execute a single headless `analyze` run and read back its
 * machine-readable `RunSummary`.
 *
 * It composes the already-shipped CLI primitives rather than re-implementing
 * execution: it spawns `fsdev run analysis analyze --capture` (process
 * isolation + the app's real `fsdev.config.ts` wiring), then a zero-model
 * `fsdev run analysis runSummary --capture` against the same session to project
 * the stored decision + memos. Run-level fields (`durationMs`, `exitCode`,
 * `capturePath`) are merged from the analyze capture. A failed analyze run is
 * recorded as a `status: "error"` summary — `runOne` never throws for a single
 * run's failure, so a batch records every attempt.
 *
 * `opts.dataDir` (batch isolation) is passed through as `TRADING_DESK_DATA_DIR`
 * so concurrent runs each get their own PGlite database. cwd stays the app dir
 * (config search is cwd-only).
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyzeInput } from "../../src/flows/analysis/flow-schema";
import {
  runSummaryStateSchema,
  type RunSummary,
} from "../../src/flows/analysis/run-summary";
import { errorSummary, makeSessionId } from "./lib";

export type RunOneOptions = {
  /** Override the PGlite data dir (batch isolation). Unset → the shared default,
   *  so the run appears in the app's Past Reports. */
  dataDir?: string;
  /** Directory the per-run capture files are written under. */
  captureDir: string;
  /** cwd for the `fsdev` subprocess — the app dir (config search is cwd-only). */
  cwd: string;
  /** Optional `fsdev run --model` override. Omit to use the desk's intent ladder. */
  model?: string;
};

/** The `result` slice of a `fsdev run --capture` payload that we read. */
type CaptureResult = {
  success?: boolean;
  output?: unknown;
  error?: unknown;
  execution?: { durationMs?: number };
};

function readCaptureResult(file: string): CaptureResult | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      result?: CaptureResult;
    };
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

function stringifyError(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error);
}

/** Run one `fsdev run analysis <args>` invocation, resolving with its exit code.
 *  Uses async `spawn`, NOT `execFileSync`: a synchronous call would block the
 *  single-threaded event loop for the whole ~2-minute subprocess, so `mapLimit`'s
 *  worker coroutines could never interleave and the batch would run serially
 *  despite its `concurrency` setting. The promise resolves on the async `close`
 *  event, so the worker yields and other runs proceed concurrently.
 *  `stdio: "inherit"` streams the run's output live (and sidesteps execFile's
 *  output-buffer cap on a long, chatty run). */
function runFsdev(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve) => {
    // Default ("pipe") stdio, then forward the streams — equivalent to
    // "inherit" for live output, but it returns `ChildProcessWithoutNullStreams`
    // (whose `.on` the repo's `@types/node` types correctly, unlike the bare
    // `ChildProcess` the "inherit" overload yields). Matches `packages/claude-code`.
    const child = spawn("pnpm", ["fsdev", "run", "analysis", ...args], { cwd, env });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    // This repo's `@types/node` doesn't surface ChildProcess's inherited
    // EventEmitter methods (same as `packages/tools/.../moat.ts`); cast to attach
    // the listeners. ChildProcess genuinely is an EventEmitter at runtime.
    const events = child as unknown as import("node:events").EventEmitter;
    events.on("error", () => resolve(1)); // spawn failure (e.g. binary missing)
    events.on("close", (code: number | null) => resolve(code ?? 1));
  });
}

export async function runOne(
  input: AnalyzeInput,
  opts: RunOneOptions,
): Promise<RunSummary> {
  const ranAt = new Date().toISOString();
  const sessionId = makeSessionId(input);
  mkdirSync(opts.captureDir, { recursive: true });
  const analyzeCapture = path.join(opts.captureDir, `${sessionId}.analyze.json`);
  const summaryCapture = path.join(opts.captureDir, `${sessionId}.summary.json`);

  // The desk's `fsdev.config.ts` declares its OWN intent ladder + default model.
  // Inherited generic overrides (`FSDEV_DEFAULT_MODEL`, `FSDEV_INTENT_*` for
  // intents the desk doesn't declare, e.g. an automation env that pins
  // `FSDEV_INTENT_CHAT`) make the desk's `createModelResolver` throw. Strip them
  // so the config's own wiring applies cleanly — the `goals/` runner precedent
  // (spread-then-delete, so `NODE_ENV` and the rest survive).
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "FSDEV_DEFAULT_MODEL" || key.startsWith("FSDEV_INTENT_")) {
      delete env[key];
    }
  }
  if (opts.dataDir) env.TRADING_DESK_DATA_DIR = opts.dataDir;

  // 1. The real run.
  const analyzeArgs = [
    "analyze",
    "-i",
    JSON.stringify(input),
    "--session",
    sessionId,
    "--capture",
    analyzeCapture,
  ];
  if (opts.model) analyzeArgs.push("--model", opts.model);
  const analyzeExit = await runFsdev(analyzeArgs, opts.cwd, env);
  const analyzeResult = readCaptureResult(analyzeCapture);
  const durationMs = analyzeResult?.execution?.durationMs ?? null;

  // Capture writes are best-effort, so a null `analyzeResult` after a 0 exit
  // (capture failed to write) is reported as `error` here — a rare false
  // negative we accept rather than guess the run succeeded with no record to
  // read back.
  if (analyzeExit !== 0 || analyzeResult?.success !== true) {
    return errorSummary({
      input,
      sessionId,
      ranAt,
      exitCode: analyzeExit,
      error:
        stringifyError(analyzeResult?.error) ?? `analyze exited ${analyzeExit}`,
      durationMs,
      capturePath: analyzeCapture,
    });
  }

  // 2. The zero-model read-back.
  const summaryExit = await runFsdev(
    ["runSummary", "-i", "{}", "--session", sessionId, "--capture", summaryCapture],
    opts.cwd,
    env,
  );
  const summaryResult = readCaptureResult(summaryCapture);
  if (summaryExit !== 0 || summaryResult?.success !== true) {
    return errorSummary({
      input,
      sessionId,
      ranAt,
      exitCode: summaryExit,
      error: `runSummary read failed: ${stringifyError(summaryResult?.error) ?? summaryExit}`,
      durationMs,
      capturePath: analyzeCapture,
    });
  }

  // 3. Validate the action's output, then merge the run-level fields.
  const parsed = runSummaryStateSchema.safeParse(summaryResult.output);
  if (!parsed.success) {
    return errorSummary({
      input,
      sessionId,
      ranAt,
      exitCode: 0,
      error: `runSummary output failed validation: ${parsed.error.message}`,
      durationMs,
      capturePath: analyzeCapture,
    });
  }

  return {
    ...parsed.data,
    sessionId,
    durationMs,
    exitCode: 0,
    error: null,
    capturePath: analyzeCapture,
    ranAt,
  };
}
