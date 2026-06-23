/**
 * Goal check — a verified webhook delivery runs the bound handler end to end.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * This file owns the contract and the assertions, graded against the held-out
 * fixture. The real path lives in `harness.mts`, driven via `tsx -e` with
 * cwd = apps/kitchen-sink so `@flow-state-dev/*` and `zod` resolve (goals/ is
 * not a package — same reason the chat-agent goal shells `fsdev` from the app).
 *
 * The harness sends a real signed Stripe-style POST through the real webhook
 * adapter + dispatch + a real generator, and a forged POST, then reports what
 * landed in the session store on a single `__GOAL__<json>` line. We assert that
 * the verified delivery's payload-derived effect (lastInvoice + the model's
 * extracted company) is present and graded against the fixture, and that the
 * forged delivery was rejected with no effect.
 *
 * Run: pnpm tsx goals/webhook-transport/runs-the-bound-handler-on-a-verified-delivery/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/event.json", import.meta.url), "utf8"),
) as { invoiceId: string; customer: string; memo: string; expectCompany: string };

const harness = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));

const SECRET = "whsec_goal_check";
// Real model. Default is the documented portable id; override with GOAL_MODEL to
// match your gateway's naming (this repo's container resolves the Vercel AI
// Gateway, so a `vercel/<provider>/<model>` id is used for the recorded run).
const MODEL = process.env.GOAL_MODEL ?? "openai/gpt-5.4-mini";

// The harness builds its OWN runtime with no declared intents, so strip the
// app's `FSDEV_INTENT_*` env (the default model resolver throws if they're set
// but unmapped). The generator resolves its explicit model id via the gateway.
const childEnv: NodeJS.ProcessEnv = { ...process.env };
for (const k of Object.keys(childEnv)) {
  if (k.startsWith("FSDEV_INTENT_") || k === "FSDEV_DEFAULT_MODEL") delete childEnv[k];
}

let stdout = "";
try {
  stdout = execFileSync("pnpm", ["tsx", "-e", harness], {
    cwd: KITCHEN_SINK,
    encoding: "utf8",
    env: {
      ...childEnv,
      GOAL_FIXTURE: JSON.stringify(fixture),
      GOAL_SECRET: SECRET,
      GOAL_MODEL: MODEL,
    },
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
  verifiedStatus: number;
  forgedStatus: number;
  forgedSessionExists: boolean;
  state: { lastInvoice?: string; company?: string } | null;
  model: string;
};

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

if (failures.length === 0) {
  const s = r.state ?? {};
  console.log(
    `PASS — verified delivery ran the bound handler: session state ` +
      `{ lastInvoice: "${s.lastInvoice}", company: "${s.company}" } graded against fixture; ` +
      `forged signature → ${r.forgedStatus} with no session. Asserted the payload-derived ` +
      `effect from the session store, not the 202 ack. model: ${r.model}.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  console.error("observations: " + JSON.stringify(r));
  process.exit(1);
}
