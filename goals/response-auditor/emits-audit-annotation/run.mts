/**
 * Goal check — the responseAuditor pattern renders audit findings.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * FIX-847 moved the emit into the `responseAuditor` pattern: when it surfaces
 * results it emits an `audit-annotation` component item, which is what a UI card
 * renders off. The harness runs the REAL `biasAnalyzer` (the same one
 * apps/kitchen-sink wires into `responseAuditor`) over a held-out, deliberately
 * one-sided response, through the real block engine, with a real model bound
 * via the gateway. Whether the real analyzer's model call scores this response
 * above threshold is inherently probabilistic, so this file retries a bounded
 * number of times and passes on the first surfacing run — the retry is over the
 * analyzer's real judgment call, which is exactly the thing this goal proves,
 * not a workaround for FIX-847's emit (that's deterministic given a surfaced
 * result, and is covered directly by the `*.spec.ts` unit tests).
 *
 * The harness runs via `tsx -e` with cwd = apps/kitchen-sink so
 * `@flow-state-dev/*`, `@thought-fabric/core`, and `@ai-sdk/gateway` resolve
 * (goals/ is not a package). It reports on a single `__GOAL__<json>` line; this
 * file owns the assertions and the retry loop.
 *
 * Run: pnpm tsx goals/response-auditor/emits-audit-annotation/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/input.json", import.meta.url), "utf8"),
) as { userInput: string; aiResponse: string };

const harness = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const MODEL = process.env.GOAL_MODEL ?? "vercel/openai/gpt-5.4-mini";
const MAX_ATTEMPTS = Number(process.env.GOAL_ATTEMPTS ?? "3");

// The harness builds its own gateway-bound resolver with no declared intents;
// `createModelResolver` throws if FSDEV_INTENT_* / FSDEV_DEFAULT_MODEL are set
// but unmapped, so strip them (the analyzer resolves its explicit model id).
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GOAL_MODEL: MODEL,
  GOAL_USER_INPUT: fixture.userInput,
  GOAL_AI_RESPONSE: fixture.aiResponse,
};
for (const k of Object.keys(childEnv)) {
  if (k.startsWith("FSDEV_INTENT_") || k === "FSDEV_DEFAULT_MODEL") delete childEnv[k];
}

type Observation = {
  auditorError: string | null;
  cardEmitted: boolean;
  surfaced: number;
  overallScore: number | null;
  model: string;
};

function attempt(): Observation {
  const stdout = execFileSync("pnpm", ["tsx", "-e", harness], {
    cwd: KITCHEN_SINK,
    encoding: "utf8",
    env: childEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const line = stdout.split("\n").find((l) => l.startsWith("__GOAL__"));
  if (line === undefined) {
    throw new Error("harness produced no result line:\n" + stdout);
  }
  return JSON.parse(line.slice("__GOAL__".length)) as Observation;
}

let last: Observation | undefined;
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  try {
    last = attempt();
  } catch (err) {
    console.error("FAIL — harness exited non-zero:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (last.auditorError !== null) {
    console.error(`FAIL — auditor errored: ${last.auditorError}`);
    process.exit(1);
  }
  if (last.cardEmitted && last.surfaced > 0) break;
  console.error(
    `attempt ${i}/${MAX_ATTEMPTS}: real analyzer scored ${last.overallScore} — did not ` +
      `surface this run; retrying`,
  );
}

const failures: string[] = [];
if (last === undefined || !last.cardEmitted) {
  failures.push(
    `no audit-annotation component item was emitted after ${MAX_ATTEMPTS} attempts — either ` +
      "the real analyzer never scored the held-out response above threshold, or the pattern's " +
      "emit is not wired (the *.spec.ts unit test would catch the latter deterministically)",
  );
} else if (last.surfaced === 0) {
  failures.push("audit-annotation card was emitted with zero surfacedResults — hollow card");
}

if (failures.length === 0 && last !== undefined) {
  console.log(
    `PASS — the real biasAnalyzer (model: ${last.model}) scored the held-out response ` +
      `${last.overallScore} and responseAuditor emitted an audit-annotation component item with ` +
      `${last.surfaced} surfaced result(s) into the stream. Asserted the emitted component item, ` +
      `not the auditor block's return value.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  console.error("last observation: " + JSON.stringify(last));
  process.exit(1);
}
