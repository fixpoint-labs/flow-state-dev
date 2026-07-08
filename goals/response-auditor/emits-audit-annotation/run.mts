/**
 * Goal check — the responseAuditor pattern renders audit findings.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * FIX-847 moved the emit into the `responseAuditor` pattern: when it surfaces
 * results it emits an `audit-annotation` component item, which is what a UI card
 * renders off. The harness runs a REAL generator (real gateway call) to produce
 * the audited response, then runs `responseAuditor` over it through the real
 * block engine with an always-surfacing analyzer. Fixing the analyzer verdict
 * (which isn't FIX-847's concern, and is model-stochastic in production) makes
 * this a deterministic real-model check of FIX-847's contribution: the emitted
 * component item lands in the stream.
 *
 * The harness runs via `tsx -e` with cwd = apps/kitchen-sink so `@flow-state-dev/*`,
 * `zod`, and `@ai-sdk/gateway` resolve (goals/ is not a package). It reports on a
 * single `__GOAL__<json>` line; this file owns the assertions.
 *
 * Run: pnpm tsx goals/response-auditor/emits-audit-annotation/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const harness = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";

const { topic } = JSON.parse(
  readFileSync(new URL("./fixtures/input.json", import.meta.url), "utf8"),
) as { topic: string };

// The harness builds its own gateway-bound resolver with no declared intents;
// `createModelResolver` throws if FSDEV_INTENT_* / FSDEV_DEFAULT_MODEL are set
// but unmapped, so strip them (the generator resolves its explicit model id).
const childEnv: NodeJS.ProcessEnv = { ...process.env, GOAL_MODEL: MODEL, GOAL_TOPIC: topic };
for (const k of Object.keys(childEnv)) {
  if (k.startsWith("FSDEV_INTENT_") || k === "FSDEV_DEFAULT_MODEL") delete childEnv[k];
}

let stdout = "";
try {
  stdout = execFileSync("pnpm", ["tsx", "-e", harness], {
    cwd: KITCHEN_SINK,
    encoding: "utf8",
    env: childEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (err) {
  console.error("FAIL — harness exited non-zero:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const line = stdout.split("\n").find((l) => l.startsWith("__GOAL__"));
if (line === undefined) {
  console.error("FAIL — harness produced no result line.\n" + stdout);
  process.exit(1);
}

const r = JSON.parse(line.slice("__GOAL__".length)) as {
  generatorOk: boolean;
  auditorError: string | null;
  cardEmitted: boolean;
  surfaced: number;
  model: string;
};

const failures: string[] = [];
if (!r.generatorOk) {
  failures.push("real generator did not produce a response — model call failed");
}
if (r.auditorError !== null) {
  failures.push(`auditor errored: ${r.auditorError}`);
}
// The core FIX-847 assertion: the emitted component item, not the block's return.
if (!r.cardEmitted) {
  failures.push(
    "no audit-annotation component item was emitted — the pattern's emit is not wired",
  );
} else if (r.surfaced === 0) {
  failures.push("audit-annotation card was emitted with zero surfacedResults — hollow card");
}

if (failures.length === 0) {
  console.log(
    `PASS — a real ${r.model} generator produced a response, and responseAuditor emitted an ` +
      `audit-annotation component item with ${r.surfaced} surfaced result(s) into the stream. ` +
      `Asserted the emitted component item, not the auditor block's return value.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  console.error("observations: " + JSON.stringify(r));
  process.exit(1);
}
