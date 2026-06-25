/**
 * Goal check — suspension resumes after a cold restart.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Unlike the warm sibling (resumes-and-completes-after-approval, one in-memory
 * runtime), this proves the durable guarantee across a process restart:
 *   Process A: dispatch kitchen-sink's `requestApproval` against an on-disk store
 *              → suspends at the gate; the suspension is persisted to disk.
 *   Process B: a FRESH runtime over the SAME on-disk store dir (the cold restart)
 *              → loads the prior runtime's suspension (asserts it's still pending),
 *              approves it, and resumes the same request to completion.
 *
 * It grades the resumed output's content against the held-out fixture (request
 * + note), and requires the reloaded suspension to have survived as `pending`
 * — proving cross-restart persistence, not a brand-new suspension (see goal.md
 * Anti-game). `requestApproval` has no LLM, so no model credential is needed.
 *
 * Persistence uses @flow-state-dev/engine's on-disk filesystem store — it
 * provides the checkpoint/suspension/lease stores and survives a process
 * restart. store-sqlite would work too but is not a kitchen-sink dependency, so
 * it can't be resolved from a driver placed in apps/kitchen-sink.
 *
 * Mechanism: the drivers must resolve both the kitchen-sink `@/*` aliases and
 * the `@flow-state-dev/*` packages, which only holds for files under
 * apps/kitchen-sink run with that cwd. So the runner writes two transient
 * drivers there (one per process / runtime), runs them against a shared on-disk
 * store directory, grades the JSON verdicts, and cleans everything up.
 *
 * Run: pnpm tsx goals/suspension/resumes-after-a-cold-restart/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const SUSPEND_DRIVER = `.goal-cold-suspend.${process.pid}.mts`;
const RESUME_DRIVER = `.goal-cold-resume.${process.pid}.mts`;
const DATA_DIR = `/tmp/goal-cold-restart-${process.pid}`;
const MARKER = "__GOAL_RESULT__";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/approval.json", import.meta.url), "utf8"),
) as { request: string; note: string };

// --- Process A: dispatch → suspend, persisted to disk -----------------------
const suspendDriver = `
import { createFilesystemStores, createCheckpointDurabilityProvider, runAction } from "@flow-state-dev/engine";
import flow from "./flows/chat-agent/flow";

const out = (r) => console.log(${JSON.stringify(MARKER)} + JSON.stringify(r));
const stores = createFilesystemStores({ rootDir: process.env.KS_GOAL_DIR, developmentOnly: true });
try {
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases,
  });
  const userId = "goal-user";
  const sessionId = "goal_cold_" + Date.now();
  const initial = await runAction({
    flow, actionName: "requestApproval", input: { request: process.env.KS_GOAL_REQUEST },
    userId, sessionId, stores, runtimeConfig: { durabilityProvider: provider },
  });
  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s) => s.requestId === initial.requestId);
  if (!suspension) {
    out({ ok: false, reason: "process A did not suspend", output: String(initial.output ?? "") });
  } else {
    out({ ok: true, requestId: initial.requestId, sessionId, suspensionId: suspension.suspensionId });
  }
} catch (err) {
  out({ ok: false, reason: "suspend driver threw: " + (err instanceof Error ? err.message : String(err)) });
} finally {
  if (typeof stores.close === "function") stores.close();
}
process.exit(0);
`;

// --- Process B: FRESH runtime over the same on-disk dir → reload, approve, resume
const resumeDriver = `
import { createFilesystemStores, createCheckpointDurabilityProvider, runAction } from "@flow-state-dev/engine";
import flow from "./flows/chat-agent/flow";

const out = (r) => console.log(${JSON.stringify(MARKER)} + JSON.stringify(r));
const stores = createFilesystemStores({ rootDir: process.env.KS_GOAL_DIR, developmentOnly: true });
try {
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases,
  });
  const requestId = process.env.KS_GOAL_REQUEST_ID;
  const sessionId = process.env.KS_GOAL_SESSION_ID;
  const suspensionId = process.env.KS_GOAL_SUSPENSION_ID;
  const note = process.env.KS_GOAL_NOTE;

  // Cross-restart persistence proof: the prior runtime's suspension must still
  // be loadable here, and still pending (nobody resolved it before the restart).
  const reloaded = await provider.loadSuspension(requestId, suspensionId);
  const foundPending = reloaded != null && reloaded.status === "pending";
  if (reloaded) {
    await provider.suspend({ ...reloaded, status: "approved", resolvedAt: Date.now(), resumeData: { note } });
  }

  const resumed = await runAction({
    flow, actionName: "requestApproval", input: { request: process.env.KS_GOAL_REQUEST },
    userId: "goal-user", sessionId, stores, runtimeConfig: { durabilityProvider: provider },
    metadata: {
      resumeOf: requestId,
      resumeContext: { suspensionId, action: "approve", data: { note } },
    },
  });
  const rec = await stores.request.get(resumed.requestId);
  out({
    ok: true, foundPending,
    output: resumed.output ?? null,
    status: rec?.status ?? "unknown",
    error: resumed.error ?? null,
  });
} catch (err) {
  out({ ok: false, reason: "resume driver threw: " + (err instanceof Error ? err.message : String(err)) });
} finally {
  if (typeof stores.close === "function") stores.close();
}
process.exit(0);
`;

function fail(msg: string): never {
  console.error("FAIL — " + msg);
  cleanup();
  process.exit(1);
}

function cleanup(): void {
  rmSync(`${KITCHEN_SINK}/${SUSPEND_DRIVER}`, { force: true });
  rmSync(`${KITCHEN_SINK}/${RESUME_DRIVER}`, { force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
}

function runDriver(name: string, env: NodeJS.ProcessEnv): any {
  let stdout = "";
  try {
    stdout = execFileSync("pnpm", ["tsx", name], { cwd: KITCHEN_SINK, encoding: "utf8", env });
  } catch (err: any) {
    fail(`${name} process failed:\n${err?.stdout ?? ""}\n${err?.stderr ?? err?.message ?? ""}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith(MARKER));
  if (line === undefined) fail(`no result line from ${name}. stdout:\n${stdout}`);
  return JSON.parse(line.slice(MARKER.length));
}

writeFileSync(`${KITCHEN_SINK}/${SUSPEND_DRIVER}`, suspendDriver, "utf8");
writeFileSync(`${KITCHEN_SINK}/${RESUME_DRIVER}`, resumeDriver, "utf8");

// The drivers build a minimal runtime (no declared model intents) because
// requestApproval has no generator. Strip this container's FSDEV_INTENT_* /
// FSDEV_DEFAULT_MODEL overrides so createModelResolver doesn't try to match a
// pinned intent against the (empty) declared set and throw.
const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key.startsWith("FSDEV_INTENT_") || key === "FSDEV_DEFAULT_MODEL") delete cleanEnv[key];
}
const baseEnv = { ...cleanEnv, FSD_ENV: "dev", KS_GOAL_DIR: DATA_DIR, KS_GOAL_REQUEST: fixture.request, KS_GOAL_NOTE: fixture.note };

// Process A — suspend.
const a = runDriver(SUSPEND_DRIVER, baseEnv);
if (a.ok !== true) fail(a.reason ?? "suspend phase failed");

// Process B — cold restart: fresh runtime over the persisted DB.
const b = runDriver(RESUME_DRIVER, {
  ...baseEnv,
  KS_GOAL_REQUEST_ID: a.requestId,
  KS_GOAL_SESSION_ID: a.sessionId,
  KS_GOAL_SUSPENSION_ID: a.suspensionId,
});
if (b.ok !== true) fail(b.reason ?? "resume phase failed");
if (b.error) fail(`resume errored: ${JSON.stringify(b.error)}`);

// --- Grade -------------------------------------------------------------------
const output = typeof b.output === "string" ? b.output : JSON.stringify(b.output ?? "");
const failures: string[] = [];
if (b.foundPending !== true) {
  failures.push("the prior runtime's suspension did not reload as pending in the fresh runtime — it did not survive the cold restart");
}
if (!output.toLowerCase().includes(fixture.request.toLowerCase())) {
  failures.push(`resumed output missing the original request "${fixture.request}"`);
}
if (!output.toLowerCase().includes(fixture.note.toLowerCase())) {
  failures.push(`resumed output missing the approver note "${fixture.note}" — approve payload did not flow through after the restart`);
}
if (b.status !== "completed") {
  failures.push(`resumed request status is "${b.status}", expected "completed"`);
}

cleanup();

if (failures.length > 0) {
  console.error("FAIL —\n  - " + failures.join("\n  - ") + `\n  resumed output: ${output}`);
  process.exit(1);
}

console.log(
  `PASS — suspension survived a cold restart: process A suspended and persisted to disk; a fresh ` +
    `process B reloaded it as pending, approved, and resumed to completion. Resumed output carried ` +
    `both the held-out request and note: ${output}. Graded on cross-restart persistence + output content.`,
);
process.exit(0);
