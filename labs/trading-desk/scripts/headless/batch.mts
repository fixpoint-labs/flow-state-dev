/**
 * Batch headless runs — the agent-loop scoreboard.
 *
 *   pnpm batch scripts/headless/manifest.fixture.json
 *   pnpm batch my-manifest.json --model openai/gpt-5.4-mini
 *
 * Reads a manifest (an explicit `runs` list or a `tickers × axes` matrix),
 * executes the runs with bounded concurrency, and appends one `RunSummary` line
 * per run to the JSONL scoreboard — the artifact an agent loop reads instead of
 * a browser. Each run executes in its OWN temp PGlite database (PGlite is
 * single-process, so concurrent runs must not share one), which means batch runs
 * do NOT appear in the app's Past Reports — the scoreboard is the batch artifact.
 *
 * Exit 0 once the batch ran to the end (every run produced a line — completed,
 * stopped, AND error are all recorded data, not batch failures). Exit non-zero
 * only on a harness-fatal condition (manifest unreadable, scoreboard unwritable).
 * Judging whether the runs were good is the eval-suite's job, not this harness's.
 *
 * Run from the app directory (`labs/trading-desk`) — `fsdev` config search is
 * cwd-only.
 */
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapLimit } from "@flow-state-dev/core";
import { runOne } from "./harness";
import { expandManifest, manifestSchema } from "./lib";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const args = process.argv.slice(2);
const manifestArg = args.find((a) => !a.startsWith("--"));
const modelIdx = args.indexOf("--model");
const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;

if (!manifestArg) {
  console.error("usage: pnpm batch <manifest.json> [--model <id>]");
  process.exit(2);
}

const manifestPath = path.resolve(process.cwd(), manifestArg);
const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const inputs = expandManifest(manifest);

const scoreboard = path.resolve(process.cwd(), manifest.scoreboard);
const concurrency = manifest.concurrency ?? 1;

await mkdir(path.dirname(scoreboard), { recursive: true });
await writeFile(scoreboard, ""); // truncate / create

if (inputs.length === 0) {
  console.error(`[batch] 0 runs — nothing to do (${scoreboard})`);
  process.exit(0);
}

const captureRoot = path.join(APP_ROOT, ".fsdev", "headless");

// Serialize scoreboard appends — concurrent appendFile can interleave a long
// JSON line. The runs themselves stay concurrent; only the write is chained.
// The gate swallows errors (`.catch`) so one failed write does not poison the
// chain — a later run's write is still attempted; the returned promise still
// rejects so the caller (and the batch) sees the failure.
let writeChain: Promise<void> = Promise.resolve();
function appendLine(line: string): Promise<void> {
  const write = writeChain.then(() => appendFile(scoreboard, line));
  writeChain = write.catch(() => {});
  return write;
}

console.error(
  `[batch] ${inputs.length} runs, concurrency ${concurrency} → ${scoreboard}`,
);

let summaries;
try {
  summaries = await mapLimit(inputs, concurrency, async (input) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "td-batch-"));
    try {
      const summary = await runOne(input, {
        dataDir,
        captureDir: captureRoot,
        cwd: APP_ROOT,
        model,
      });
      await appendLine(JSON.stringify(summary) + "\n");
      return summary;
    } finally {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
} catch (err) {
  // Harness-fatal: the scoreboard could not be written (disk full, dir removed).
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[batch] FATAL: scoreboard write failed (${scoreboard}): ${message}`);
  process.exit(1);
}

const completed = summaries.filter((s) => s.status === "completed").length;
const stopped = summaries.filter((s) => s.status === "stopped").length;
const errored = summaries.filter((s) => s.status === "error").length;

console.error(
  `[batch] ${summaries.length} runs — ${completed} completed, ${stopped} stopped, ${errored} error → ${scoreboard}`,
);
process.exit(0);
