/**
 * Goal check — suspension resumes and completes after approval.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Drives kitchen-sink's `requestApproval` durable action end to end against the
 * real checkpoint durability provider:
 *   1. dispatch  → the durable gate suspends
 *   2. approve   → mark the suspension approved with the operator's note
 *                  (exactly what the resume endpoint / DevTool persists)
 *   3. resume    → the same request runs past the gate and completes
 *
 * It grades the RESUMED output's content against the held-out fixture — proving
 * the approved branch ran with the injected note and the original request
 * survived the suspend — not just that the run reported "completed" (see the
 * Anti-game note in goal.md).
 *
 * `requestApproval` is pure handlers + ctx.suspend(); there is no LLM call, so
 * no model credential is needed. The thing under test is the durable
 * suspend/resume/replay path, not a generator.
 *
 * Mechanism: the dispatch and the resume must happen in ONE process so the
 * in-memory dev store carries the suspension between them, and that process must
 * resolve both the kitchen-sink `@/*` aliases and the `@flow-state-dev/*`
 * workspace packages. Only files under `apps/kitchen-sink` (run with that cwd)
 * resolve both. So this runner writes a tiny transient driver there, runs it,
 * reads back a JSON verdict, and deletes it — keeping the goal self-contained.
 *
 * Run: pnpm tsx goals/suspension/resumes-and-completes-after-approval/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const DRIVER_NAME = `.goal-resume-driver.${process.pid}.mts`;
const DRIVER_PATH = `${KITCHEN_SINK}/${DRIVER_NAME}`;
const RESULT_MARKER = "__GOAL_RESULT__";

// Held-out fixture — nothing below hardcodes the request or note.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/approval.json", import.meta.url), "utf8"),
) as { request: string; note: string };

// The driver runs INSIDE apps/kitchen-sink so `@/*` (kitchen-sink tsconfig) and
// `@flow-state-dev/*` (kitchen-sink node_modules) both resolve. It performs the
// real dispatch → approve → resume round trip and prints one JSON verdict line.
const driver = `
import { runAction } from "@flow-state-dev/server";
import { flowstate } from "./lib/flowstate";

const request = process.env.KS_GOAL_REQUEST;
const note = process.env.KS_GOAL_NOTE;
const out = (r) => console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(r));

try {
  const runtime = await flowstate.getRuntime();
  const flow = runtime.registry.get("chat-agent");
  const provider = runtime.runtimeConfig?.durabilityProvider;
  const stores = runtime.stores;
  if (!flow) { out({ ok: false, reason: 'flow "chat-agent" not found' }); process.exit(0); }
  if (!provider) { out({ ok: false, reason: "no durabilityProvider on runtime" }); process.exit(0); }

  const userId = "goal-user";
  const sessionId = "goal_" + Date.now();

  // 1. dispatch → suspends
  const initial = await runAction({
    flow, actionName: "requestApproval", input: { request },
    userId, sessionId, stores, runtimeConfig: runtime.runtimeConfig,
  });

  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s) => s.requestId === initial.requestId);
  if (!suspension) {
    out({ ok: false, reason: "first run did not suspend", output: String(initial.output ?? "") });
    process.exit(0);
  }

  // 2. approve → persist the operator decision (what the resume endpoint does)
  await provider.suspend({ ...suspension, status: "approved", resolvedAt: Date.now(), resumeData: { note } });

  // 3. resume the same request → runs past the gate, completes
  const resumed = await runAction({
    flow, actionName: "requestApproval", input: { request },
    userId, sessionId, stores, runtimeConfig: runtime.runtimeConfig,
    metadata: {
      resumeOf: initial.requestId,
      resumeContext: { suspensionId: suspension.suspensionId, action: "approve", data: { note } },
    },
  });

  const rec = await stores.request.get(resumed.requestId);
  out({
    ok: true,
    suspended: true,
    output: resumed.output ?? null,
    outputType: typeof resumed.output,
    status: rec?.status ?? "unknown",
    error: resumed.error ?? null,
  });
} catch (err) {
  out({ ok: false, reason: "driver threw: " + (err instanceof Error ? err.message : String(err)) });
} finally {
  if (typeof flowstate.dispose === "function") await flowstate.dispose().catch(() => {});
}
process.exit(0);
`;

function fail(msg: string): never {
  console.error("FAIL — " + msg);
  process.exit(1);
}

writeFileSync(DRIVER_PATH, driver, "utf8");
let stdout = "";
try {
  stdout = execFileSync("pnpm", ["tsx", DRIVER_NAME], {
    cwd: KITCHEN_SINK,
    encoding: "utf8",
    env: { ...process.env, FSD_ENV: "dev", KS_GOAL_REQUEST: fixture.request, KS_GOAL_NOTE: fixture.note },
  });
} catch (err: any) {
  // Surface the driver's own output so a resolution/runtime failure is visible.
  fail(`driver process failed:\n${err?.stdout ?? ""}\n${err?.stderr ?? err?.message ?? ""}`);
} finally {
  rmSync(DRIVER_PATH, { force: true });
}

const line = stdout.split("\n").find((l) => l.startsWith(RESULT_MARKER));
if (line === undefined) fail(`no result line from driver. stdout:\n${stdout}`);
const result = JSON.parse(line.slice(RESULT_MARKER.length));

if (result.ok !== true) fail(result.reason ?? "driver reported failure");
if (result.error) fail(`resume errored: ${JSON.stringify(result.error)}`);

// --- The goal grade: resumed OUTPUT content, graded against the fixture ------
// The action's output is a structured object ({ request, approvalId, approved,
// note }); serialize it so the held-out request + note are graded as content
// regardless of whether output is an object or a string.
const output = result.output;
const outputStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
const failures: string[] = [];
if (!outputStr.toLowerCase().includes(fixture.request.toLowerCase())) {
  failures.push(`output missing the original request "${fixture.request}" — input did not survive the suspend`);
}
if (!outputStr.toLowerCase().includes(fixture.note.toLowerCase())) {
  failures.push(`output missing the approver note "${fixture.note}" — the approve payload did not flow through on resume`);
}
if (result.status !== "completed") {
  failures.push(`resumed request status is "${result.status}", expected "completed"`);
}

if (failures.length > 0) {
  fail("\n  - " + failures.join("\n  - ") + `\n  resumed output: ${outputStr}`);
}

console.log(
  `PASS — requestApproval suspended, was approved, and resumed to completion. ` +
    `Resumed output carried both the held-out request and note: ${outputStr}. ` +
    `Graded on output content, not the completion flag or the suspension's presence.`,
);
process.exit(0);
