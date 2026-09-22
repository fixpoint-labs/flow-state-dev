/**
 * FIX-1503 · Consumer corpus — the epic's factual base, re-derived.
 *
 * The epic claims the expensive part is a named set of HTTP callers that today
 * send no token, and that in-process runAction / testFlow / fsdev run are not
 * in that set. A hand list cannot report the host config nobody wrote down.
 *
 * TOTALITY: every `fsdev.config.ts` / `fsdev.config.mts` under the scanned
 * roots is classified as http-cutover, in-process, or deliberately-out.
 *
 * NEGATIVE CONTROL: `--plant` writes an unclassified config. The totality
 * assertion MUST fail. A green check nobody has watched go red is not evidence.
 *
 * Throwaway retained evidence. Not imported. Not on any build path.
 *
 *   node specs/epics/FIX-1503/poc/consumer-corpus/census.mjs
 *   node specs/epics/FIX-1503/poc/consumer-corpus/census.mjs --plant
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const REPO = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ?? process.cwd();
const PLANT = process.argv.includes("--plant");

const SCAN_ROOTS = [
  "apps",
  "examples",
  "labs",
  "goals",
  "packages/mcp",
  "packages/scheduled",
  "packages/bullmq",
  "packages/voice-openai",
  "packages/devtool",
  "packages/client",
  "packages/cli",
  "packages/node",
  "packages/integration-tests",
];

/** Every scanned host config must appear here. */
const CLASSIFICATION = {
  "apps/kitchen-sink/fsdev.config.ts": "http-cutover",
  "apps/docs": "http-cutover-docs",
  "examples/hello-chat/fsdev.config.ts": "http-cutover",
  "examples/knowledge-base/fsdev.config.ts": "http-cutover",
  "examples/guides/research-team/fsdev.config.ts": "http-cutover",
  "examples/guides/custom-pattern/fsdev.config.ts": "http-cutover",
  "examples/guides/board-lifecycle/fsdev.config.ts": "http-cutover",
  "labs/trading-desk/fsdev.config.ts": "http-cutover",
  "labs/knowledge-hub/fsdev.config.ts": "http-cutover",
  "labs/conductor/fsdev.config.ts": "http-cutover",
  "labs/fsd-coding-skill/fsdev.config.ts": "http-cutover",
};

const NAMED_FAMILIES = [
  "apps/kitchen-sink",
  "packages/devtool",
  "apps/docs",
  "packages/mcp",
  "packages/scheduled",
  "packages/voice-openai",
  "packages/bullmq",
  "goals",
  "packages/integration-tests",
];

const CONFIG_NAME = /^fsdev\.config\.m?ts$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === "dist" ||
      e.name === ".next" ||
      e.name === "test" ||
      e.name === "fixtures-config"
    ) {
      continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CONFIG_NAME.test(e.name)) out.push(p);
  }
  return out;
}

function exists(rel) {
  try {
    readdirSync(join(REPO, rel));
    return true;
  } catch {
    return false;
  }
}

const plantRel = "apps/_fix1503-plant/fsdev.config.ts";
if (PLANT) {
  mkdirSync(join(REPO, dirname(plantRel)), { recursive: true });
  writeFileSync(join(REPO, plantRel), "export default {}\n");
}

try {
  const found = [];
  for (const root of SCAN_ROOTS) {
    found.push(...walk(join(REPO, root)));
  }

  const missingFamily = NAMED_FAMILIES.filter((f) => !exists(f));
  if (missingFamily.length) {
    throw new Error(`named cutover family missing from disk: ${missingFamily.join(", ")}`);
  }

  const unclassified = [];
  const classified = [];
  for (const abs of found) {
    const rel = relative(REPO, abs);
    const cls = CLASSIFICATION[rel];
    if (!cls) unclassified.push(rel);
    else classified.push({ rel, cls });
  }

  const http = classified.filter((r) => r.cls.startsWith("http-cutover"));
  if (http.length < 4) {
    throw new Error(`expected several http-cutover hosts, found ${http.length}`);
  }

  if (unclassified.length) {
    throw new Error(
      `unclassified host configs (totality failed):\n  ${unclassified.join("\n  ")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        families: NAMED_FAMILIES.length,
        configs: classified.length,
        httpCutover: http.map((r) => r.rel),
        plant: PLANT,
      },
      null,
      2,
    ),
  );
} finally {
  if (PLANT) {
    rmSync(join(REPO, "apps/_fix1503-plant"), { recursive: true, force: true });
  }
}
