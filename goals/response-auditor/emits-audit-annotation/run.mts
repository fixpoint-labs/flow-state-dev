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
 * The harness runs with cwd = apps/kitchen-sink so `@flow-state-dev/*`,
 * `@thought-fabric/core`, and `@ai-sdk/gateway` resolve (goals/ is not that
 * app). This file owns the assertions and the retry loop.
 *
 * Run: pnpm tsx goals/response-auditor/emits-audit-annotation/run.mts
 */
import {
  KITCHEN_SINK,
  gatewayModel,
  goalAttempts,
  goalModel,
  loadFixture,
  runGoal,
  runHarness,
} from "../../lib/index.mts";

const fixture = loadFixture<{ userInput: string; aiResponse: string }>(import.meta.url);

// The harness builds its own gateway-bound resolver, so the id names the gateway.
const MODEL = goalModel(gatewayModel());
const MAX_ATTEMPTS = goalAttempts(3);

interface Observation {
  auditorError: string | null;
  cardEmitted: boolean;
  surfaced: number;
  overallScore: number | null;
  model: string;
}

await runGoal(() => {
  let last: Observation | undefined;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    last = runHarness<Observation>({
      app: KITCHEN_SINK,
      harness: new URL("./harness.mts", import.meta.url),
      env: {
        GOAL_MODEL: MODEL,
        GOAL_USER_INPUT: fixture.userInput,
        GOAL_AI_RESPONSE: fixture.aiResponse,
      },
    });
    if (last.auditorError !== null) {
      return { failures: [`auditor errored: ${last.auditorError}`], evidence: "" };
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
  if (failures.length > 0) failures.push(`last observation: ${JSON.stringify(last)}`);

  return {
    failures,
    evidence:
      `the real biasAnalyzer (model: ${last?.model}) scored the held-out response ` +
      `${last?.overallScore} and responseAuditor emitted an audit-annotation component item with ` +
      `${last?.surfaced} surfaced result(s) into the stream. Asserted the emitted component item, ` +
      `not the auditor block's return value.`,
  };
});
