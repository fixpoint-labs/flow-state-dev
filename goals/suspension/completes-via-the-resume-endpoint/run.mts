/**
 * Goal check — suspension completes via the HTTP resume endpoint.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract.
 *
 * Drives kitchen-sink's flow router (flowstate.getRouter()) exactly as the
 * DevTool / client does:
 *   POST .../actions/requestApproval     → dispatch (then poll status: suspended)
 *   GET  /sessions/:id/debug/suspensions → the Suspensions tab's source (pending)
 *   POST .../requests/:id/resume         → non-stream 202 (recoveryClient's call)
 *   poll status                          → completed (background continuation)
 *   GET  .../requests/:id/stream         → the reconnect a client issues after a
 *                                          resume; its replay must carry the
 *                                          resumed items (held-out request + note)
 *   GET  /sessions/:id/requests + debug/suspensions → what a reload fetches
 *
 * Grades the re-fetched stream replay CONTENT against the held-out fixture — the
 * exact bytes a reconnecting DevTool receives — not the 202 or the status flag
 * (see goal.md Anti-game). requestApproval has no LLM, so no model credential.
 *
 * Mechanism: getRouter() needs both the kitchen-sink `@/*` aliases and the
 * `@flow-state-dev/*` packages, which only resolve for a file under
 * apps/kitchen-sink run with that cwd. So the runner writes a transient driver
 * there, runs it (with debug endpoints enabled), grades the JSON report, and
 * cleans up.
 *
 * Run: pnpm tsx goals/suspension/completes-via-the-resume-endpoint/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const DRIVER = `.goal-http-resume.${process.pid}.mts`;
const MARKER = "__GOAL_RESULT__";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/approval.json", import.meta.url), "utf8"),
) as { request: string; note: string };

const driver = `
import { flowstate } from "./lib/flowstate";

const FLOW = "chat-agent";
const userId = "goal-http-user";
const sessionId = "goal_http_" + Date.now();
const request = process.env.KS_GOAL_REQUEST;
const note = process.env.KS_GOAL_NOTE;
const out = (r) => console.log(${JSON.stringify(MARKER)} + JSON.stringify(r));
const router = await flowstate.getRouter();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, segs, body, accept = "application/json") {
  const req = new Request("http://local/api/flows/" + segs.join("/"), {
    method,
    headers: { "content-type": "application/json", accept },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await router[method](req, { params: { path: segs } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

async function pollStatus(requestId, want, tries) {
  let snap = null;
  for (let i = 0; i < tries; i++) {
    const r = await call("GET", [FLOW, "requests", requestId, "status"]);
    snap = r.body;
    const st = r.body?.status ?? r.body?.request?.status;
    if (st === want || st === "failed" || st === "completed") return { status: st, snap };
    await sleep(100);
  }
  return { status: snap?.status ?? "unknown", snap };
}

const report = {};
try {
  const dispatch = await call("POST", [FLOW, sessionId, "actions", "requestApproval"], { input: { request }, userId });
  const requestId = dispatch.body?.request?.id ?? dispatch.body?.requestId;
  report.dispatchStatus = dispatch.status;
  report.requestId = requestId;

  report.suspended = (await pollStatus(requestId, "suspended", 50)).status === "suspended";

  const susList = await call("GET", ["sessions", sessionId, "debug", "suspensions"]);
  const pending = Array.isArray(susList.body) ? susList.body : (susList.body?.suspensions ?? []);
  const suspensionId = pending[0]?.suspensionId;
  report.pendingBeforeResume = pending.length;

  const resume = await call("POST", [FLOW, "requests", requestId, "resume"], { suspensionId, action: "approve", data: { note }, resumedBy: userId });
  report.resumeStatus = resume.status;

  report.completed = (await pollStatus(requestId, "completed", 100)).status === "completed";

  // The reconnect a client issues after a resume: replay the request stream.
  const stream = await call("GET", [FLOW, "requests", requestId, "stream"], undefined, "text/event-stream");
  report.streamStatus = stream.status;
  report.streamText = stream.text ?? "";

  // What a reload fetches.
  const reqList = await call("GET", ["sessions", sessionId, "requests"]);
  const reqs = Array.isArray(reqList.body) ? reqList.body : (reqList.body?.requests ?? []);
  report.reloadRequestStatus = reqs.find((r) => r.id === requestId)?.status ?? "missing";
  const susAfter = await call("GET", ["sessions", sessionId, "debug", "suspensions"]);
  const after = Array.isArray(susAfter.body) ? susAfter.body : (susAfter.body?.suspensions ?? []);
  report.pendingAfterResume = after.length;

  report.ok = true;
  out(report);
} catch (err) {
  out({ ok: false, reason: "driver threw: " + (err instanceof Error ? err.message + "\\n" + err.stack : String(err)) });
} finally {
  if (typeof flowstate.dispose === "function") await flowstate.dispose().catch(() => {});
}
process.exit(0);
`;

function fail(msg: string): never {
  console.error("FAIL — " + msg);
  rmSync(`${KITCHEN_SINK}/${DRIVER}`, { force: true });
  process.exit(1);
}

writeFileSync(`${KITCHEN_SINK}/${DRIVER}`, driver, "utf8");
let stdout = "";
try {
  stdout = execFileSync("pnpm", ["tsx", DRIVER], {
    cwd: KITCHEN_SINK,
    encoding: "utf8",
    env: { ...process.env, FSD_ENV: "dev", FSDEV_DEBUG_ENDPOINTS: "1", KS_GOAL_REQUEST: fixture.request, KS_GOAL_NOTE: fixture.note },
  });
} catch (err: any) {
  fail(`driver process failed:\n${err?.stdout ?? ""}\n${err?.stderr ?? err?.message ?? ""}`);
} finally {
  rmSync(`${KITCHEN_SINK}/${DRIVER}`, { force: true });
}

const line = stdout.split("\n").find((l) => l.startsWith(MARKER));
if (line === undefined) fail(`no result line from driver. stdout:\n${stdout}`);
const r = JSON.parse(line.slice(MARKER.length));
if (r.ok !== true) fail(r.reason ?? "driver reported failure");

const stream = String(r.streamText ?? "");
const failures: string[] = [];
if (r.suspended !== true) failures.push("dispatch did not reach suspended");
if (r.pendingBeforeResume < 1) failures.push("no pending suspension was listed before resume");
if (r.resumeStatus !== 202) failures.push(`resume endpoint returned ${r.resumeStatus}, expected 202`);
if (r.completed !== true) failures.push("request did not reach completed after the resume endpoint call");
// Anti-game: the bytes a reconnecting client receives must carry the resumed result.
if (!stream.toLowerCase().includes(fixture.request.toLowerCase())) {
  failures.push(`re-fetched stream replay missing the request "${fixture.request}"`);
}
if (!stream.toLowerCase().includes(fixture.note.toLowerCase())) {
  failures.push(`re-fetched stream replay missing the approver note "${fixture.note}" — resumed items not in the reconnect replay (the DevTool would show a stale view)`);
}
if (!stream.includes("request.completed")) {
  failures.push("re-fetched stream replay has no request.completed event");
}
if (r.reloadRequestStatus !== "completed") failures.push(`reload shows request status "${r.reloadRequestStatus}", expected completed`);
if (r.pendingAfterResume !== 0) failures.push(`reload still lists ${r.pendingAfterResume} pending suspension(s), expected 0`);

if (failures.length > 0) {
  console.error("FAIL —\n  - " + failures.join("\n  - ") + `\n  stream sample: ${stream.slice(0, 400)}`);
  process.exit(1);
}

console.log(
  `PASS — resume endpoint completed the request (202 → completed), and a re-fetched stream replay ` +
    `carried the resumed result (held-out request + note) with a request.completed event; reload shows ` +
    `completed and 0 pending suspensions. This is the exact path a reconnecting DevTool client follows.`,
);
process.exit(0);
