/**
 * Single headless run — execute `analyze` once and print its `RunSummary`.
 *
 *   pnpm run:headless '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}'
 *   pnpm run:headless '{"ticker":"NVDA"}' --out summary.json --model openai/gpt-5.4-mini
 *
 * Runs against the shared `.fsdev/pglite` (no data-dir isolation), so the run
 * lands in the same data the app reads and appears in Past Reports. The summary
 * JSON goes to stdout (and `--out <path>` if given); a one-line human recap goes
 * to stderr. Exit code mirrors the run status: 0 completed, 2 stopped, 1 error.
 *
 * Run from the app directory (`labs/trading-desk`) — `fsdev` config search is
 * cwd-only.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeInputSchema } from "../../src/flows/analysis/flow-schema";
import { runOne } from "./harness";
import { exitCodeForStatus } from "./lib";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const args = process.argv.slice(2);
let inputJson: string | undefined;
let out: string | undefined;
let model: string | undefined;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out") out = args[(i += 1)];
  else if (args[i] === "--model") model = args[(i += 1)];
  else inputJson = args[i];
}

if (!inputJson) {
  console.error(
    "usage: pnpm run:headless '<analyze input json>' [--out <path>] [--model <id>]",
  );
  process.exit(2);
}

const input = analyzeInputSchema.parse(JSON.parse(inputJson));
const captureDir = path.join(APP_ROOT, ".fsdev", "headless");

const summary = await runOne(input, { captureDir, cwd: APP_ROOT, model });
const json = JSON.stringify(summary, null, 2);

if (out) writeFileSync(out, json + "\n");
process.stdout.write(json + "\n");

const decision = summary.finalRating ? ` (${summary.finalRating})` : "";
const stop = summary.stopReason ? ` [${summary.stopReason}]` : "";
const err = summary.error ? ` — ${summary.error}` : "";
console.error(
  `[headless] ${summary.ticker} ${summary.date} ${summary.costPreset}/${summary.dataSource} → ${summary.status}${decision}${stop}${err} in ${summary.durationMs ?? "?"}ms`,
);

process.exit(exitCodeForStatus(summary.status));
