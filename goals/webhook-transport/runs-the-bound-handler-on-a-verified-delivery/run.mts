/**
 * Goal check — a verified webhook delivery runs the bound handler end to end.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * This file owns the contract and the assertions, graded against the held-out
 * fixture. The real path lives in `harness.mts`, run with cwd = apps/kitchen-sink
 * so `@flow-state-dev/*` and `zod` resolve (goals/ is not that app — same reason
 * the chat-agent goal shells `fsdev` from the app).
 *
 * The harness sends a real signed Stripe-style POST through the real webhook
 * adapter + dispatch + a real generator, and a forged POST, then reports what
 * landed in the session store. We assert that the verified delivery's
 * payload-derived effect (lastInvoice + the model's extracted company) is
 * present and graded against the fixture, and that the forged delivery was
 * rejected with no effect.
 *
 * Run: pnpm tsx goals/webhook-transport/runs-the-bound-handler-on-a-verified-delivery/run.mts
 */
import { KITCHEN_SINK, goalModel, loadFixture, runGoal, runHarness } from "../../lib/index.mts";

const fixture = loadFixture<{
  invoiceId: string;
  customer: string;
  memo: string;
  expectCompany: string;
}>(import.meta.url, "event.json");

const SECRET = "whsec_goal_check";
// The portable id: the harness's resolver applies whatever gateway the env
// provides. Override with GOAL_MODEL to match a differently-named gateway.
const MODEL = goalModel();

interface Observation {
  verifiedStatus: number;
  forgedStatus: number;
  forgedSessionExists: boolean;
  state: { lastInvoice?: string; company?: string } | null;
  model: string;
}

await runGoal(() => {
  const r = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      GOAL_FIXTURE: JSON.stringify(fixture),
      GOAL_SECRET: SECRET,
      GOAL_MODEL: MODEL,
    },
  });

  const failures: string[] = [];

  // The forged-signature negative is the anti-game guard: it proves verification
  // is real, so the positive isn't just "any POST writes state".
  if (r.forgedStatus !== 401) {
    failures.push(`forged signature was not rejected: expected 401, got ${r.forgedStatus}`);
  }
  if (r.forgedSessionExists) {
    failures.push("forged signature created a session — the handler ran without verification");
  }

  // The positive: assert the handler's payload-derived effect, read from the
  // session store, graded against the held-out fixture — NOT the 202 ack.
  if (r.verifiedStatus !== 202) {
    failures.push(`verified delivery was not accepted: expected 202, got ${r.verifiedStatus}`);
  }
  if (r.state === null) {
    failures.push("verified delivery produced no session state within 60s");
  } else {
    if (r.state.lastInvoice !== fixture.invoiceId) {
      failures.push(
        `lastInvoice mismatch: expected "${fixture.invoiceId}", got "${r.state.lastInvoice}" ` +
          "— the handler did not run on this payload",
      );
    }
    const company = String(r.state.company ?? "");
    if (!company.toLowerCase().includes(fixture.expectCompany.toLowerCase())) {
      failures.push(
        `extracted company did not contain "${fixture.expectCompany}" — got "${company}" ` +
          "— the model did not read the memo (or the handler dropped its output)",
      );
    }
  }
  if (failures.length > 0) failures.push(`observations: ${JSON.stringify(r)}`);

  const s = r.state ?? {};
  return {
    failures,
    evidence:
      `verified delivery ran the bound handler: session state ` +
      `{ lastInvoice: "${s.lastInvoice}", company: "${s.company}" } graded against fixture; ` +
      `forged signature → ${r.forgedStatus} with no session. Asserted the payload-derived ` +
      `effect from the session store, not the 202 ack. model: ${r.model}.`,
  };
});
