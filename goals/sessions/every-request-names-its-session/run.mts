/**
 * Goal check: every request names its session, from its first write.
 *
 * Model-free, in this process, on one host over a SQLite file (`app.mts`):
 * the router's HTTP and scheduled endpoints, the webhook and MCP adapters, and
 * an internal dispatch through an inbound host over the same stores. Graded on
 * the store's own records and on the routes' answers, never on a counter in the
 * code under test.
 *
 *   a:named           each entry point's run: its request record names a session
 *                     while the run is still going, that session's row belongs to
 *                     the run's user and flow, and its listing returns the run
 *   a:one-off         the per-fire fire and the directive-less MCP call each land
 *                     in a one-off session (`isOneOffSessionId`)
 *   b:http            an HTTP send with no session id answers 400 session-required
 *   b:run-action      a runAction with no sessionId throws SessionRequiredError
 *   b:nothing-written neither left a request record, active entry or session
 *   c:parked          a webhook run that parks: its gate and its record name the same session
 *   c:stopped         stopping it by request id settles it
 *   d:listing         a request seeded with no session leaves another session's listing as it was
 *   d:stopped         stopping it finds its gate and settles it
 *   d:resume-refused  resuming another is refused by name, its gate still pending
 *   e:foreign         another user, org and tenant sending to (a)'s HTTP and per-fire
 *                     session ids each get the answer an unused id gets, and leave
 *                     nothing in those sessions
 *
 * Controls (`GOAL_CONTROL=<name>`), each the code before this change in one place:
 *   late-mint   the context mints a session when none is named, and the scheduled
 *               endpoint names none for a per-fire fire: must fail a:named (per-fire)
 *   http-mint   the action route mints a session instead of refusing: must fail b:http
 *   admit-open  session admission lets every caller in: must fail e:foreign
 *
 * Run: pnpm tsx goals/sessions/every-request-names-its-session/run.mts
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { isOneOffSessionId } from "@flow-state-dev/core/helpers";
import { createInProcessFetch, disposeFlowApiRouter, runAction } from "@flow-state-dev/engine";
import { createInboundTransportHost } from "@flow-state-dev/engine/host";
import type { StoreRegistry } from "@flow-state-dev/engine";
import type { RequestRecord } from "@flow-state-dev/engine/host";
import { dispatchInternalAs } from "../../../packages/engine/src/durability/dispatch-internal.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  runGoal,
  type ModulePatch
} from "../../lib/index.mts";
import { sleep } from "../../lib/time.mts";
import { CRON_SECRET, ORG, goalApp, holds } from "./app.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("every-request-names-its-session");

const PATCHES: Record<string, ModulePatch[]> = {
  // Before: nothing refuses a run with no session, the context mints one after
  // the record is written, and a per-fire fire reaches the engine with none.
  "late-mint": [
    {
      module: "packages/engine/src/transports/host/createInboundTransportHost.ts",
      from: String.raw`if \(typeof envelope\.sessionId !== "string" \|\| envelope\.sessionId\.length === 0\) \{`,
      to: "if (envelope.sessionId === undefined) return; if (false) {"
    },
    {
      module: "packages/engine/src/execution/runAction.ts",
      from: String.raw`if \(typeof options\.sessionId !== "string" \|\| options\.sessionId\.length === 0\)`,
      to: "if (false)"
    },
    {
      module: "packages/engine/src/context/createExecutionContext.ts",
      from: String.raw`const sessionId: string = noSession \? "" : options\.sessionId;`,
      to: 'const sessionId: string = noSession ? "" : (options.sessionId || `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`);'
    },
    {
      module: "packages/engine/src/context/createExecutionContext.ts",
      from: String.raw`if \(!noSession && \(typeof options\.sessionId !== "string" \|\| options\.sessionId\.length === 0\)\)`,
      to: "if (false)"
    },
    {
      module: "packages/engine/src/transports/scheduled/routes.ts",
      from: String.raw`: oneOffSessionId\(\)`,
      to: ": (undefined as unknown as string)"
    }
  ],
  // Before (the rejected D1 alternative): the action route makes the id up.
  "http-mint": [
    {
      module: "packages/engine/src/routes/action-routes.ts",
      from: String.raw`resourceSend\?\.sessionId \?\? route\.sessionId \?\? getString\(body\.sessionId\)`,
      to: "resourceSend?.sessionId ?? route.sessionId ?? getString(body.sessionId) ?? `ephemeral_${Date.now()}`"
    }
  ],
  // Admission open: a caller reaches a session whatever its owner.
  "admit-open": [
    {
      module: "packages/engine/src/context/binding-errors.ts",
      from: String.raw`if \(session === undefined \|\| !tenantMatches\(session\.tenantId, caller\.tenantId\)\) return;`,
      to: "return;"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const ALICE = "alice";
const stamp = RUN_STAMP.replace(/[^a-zA-Z0-9]/g, "");
const app = goalApp(join(SCRATCH, "goal.sqlite"));
const fetcher = createInProcessFetch(app);
const { stores, registry, runtimeConfig } = await app.getRuntime();

type Answer = { status: number; body: unknown; text: string };
async function call(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<Answer> {
  const response = await fetcher(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON: keep the text
  }
  return { status: response.status, body: parsed, text };
}
const as = (userId: string, orgId = ORG, tenantId?: string): Record<string, string> => ({
  "x-user": userId,
  "x-org": orgId,
  ...(tenantId === undefined ? {} : { "x-tenant-id": tenantId })
});

async function allRequests(): Promise<RequestRecord[]> {
  return (await stores.request.list({ orderBy: "none", limit: 1000 } as never)) as RequestRecord[];
}
async function until<T>(read: () => Promise<T | undefined>, what: string, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`setup: ${what} never happened within ${ms} ms`);
    await sleep(20);
  }
}
/** The request a matcher picks, once it is recorded. */
const recorded = (pick: (r: RequestRecord) => boolean, what: string) =>
  until(async () => (await allRequests()).find(pick), `${what}'s request record`);
const settled = (requestId: string, what: string) =>
  until(async () => {
    const r = await stores.request.get(requestId);
    return r !== undefined && !["in_progress", "pending", "queued"].includes(r.status) ? r : undefined;
  }, `${what} settling`);

/** A request's gates (the store filters by session or status, not by request). */
async function gatesOf(requestId: string) {
  return (await stores.suspensions.list({})).filter((gate) => gate.requestId === requestId);
}
/** The request once a stop has settled it: no longer running or parked. */
const stoppedSettled = (requestId: string, what: string) =>
  until(async () => {
    const r = await stores.request.get(requestId);
    return r !== undefined && !["in_progress", "pending", "queued", "suspended"].includes(r.status) ? r : undefined;
  }, `${what} settling`);

/** The newest top of the hour at or before now: a fire time the endpoint accepts. */
function latestHour(): string {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString();
}

async function sessionCount(s: StoreRegistry): Promise<number> {
  return (await s.session.list({ limit: 1000 } as never)).length;
}

await runGoal(async (failures, tell) => {
  await app.ready();
  const evidence: string[] = [];

  // ---- (a) every entry point names its session while the run is still going.
  holds.hold();
  const httpSession = `s_http_${stamp}`;
  const webhookSession = `s_webhook_${stamp}`;
  const mcpSession = `s_mcp_${stamp}`;
  const internalSession = `s_internal_${stamp}`;
  const pending: Promise<unknown>[] = [];
  const started = Date.now();

  const httpSent = await call("POST", `/api/flows/desk/${httpSession}/actions/ask`, as(ALICE), { input: {} });
  if (httpSent.status >= 300) failures.push(`setup: the HTTP send answered ${httpSent.status}: ${httpSent.text}`);
  for (const [type, conversation] of [["named", webhookSession], ["bare", undefined]] as const) {
    const delivered = await call("POST", "/api/flows/desk/webhooks/acme", {}, { type, id: `evt_${type}_${stamp}`, ...(conversation ? { conversation } : {}) });
    if (delivered.status >= 300) failures.push(`setup: the ${type} webhook answered ${delivered.status}: ${delivered.text}`);
  }
  const fireAt = latestHour();
  for (const schedule of ["fire", "poll"]) {
    const fired = await call("POST", `/api/flows/clock/schedules/${schedule}/dispatch`, { authorization: `Bearer ${CRON_SECRET}` }, { nominalFireTime: fireAt });
    if (fired.status >= 300) failures.push(`setup: the ${schedule} fire answered ${fired.status}: ${fired.text}`);
  }
  // An MCP call answers when its run ends, so it is left running here.
  let rpc = 0;
  for (const [name, args] of [["lookup", {}], ["threaded", { conversation: mcpSession }]] as const) {
    pending.push(
      call("POST", "/api/flows/desk/mcp", as(ALICE), { jsonrpc: "2.0", id: (rpc += 1), method: "tools/call", params: { name, arguments: args } })
    );
  }
  const internalHost = createInboundTransportHost({ registry, stores, resolvePrincipal: async () => ({ userId: ALICE, orgId: ORG }), runtimeConfig });
  const internal = dispatchInternalAs(internalHost as never, {
    flowKind: "desk",
    entry: "sweep",
    input: {},
    as: { userId: ALICE, orgId: ORG },
    sessionId: internalSession,
    metadata: {}
  });
  pending.push(internal.finished);

  const since = (r: RequestRecord) => (r.startedAtMs ?? 0) >= started - 1;
  const entries: Array<{ name: string; pick: (r: RequestRecord) => boolean; oneOff?: boolean; session?: string }> = [
    { name: "HTTP send with an id", pick: (r) => r.actionName === "ask" && r.source === "http", session: httpSession },
    { name: "webhook naming its session", pick: (r) => r.source === "webhook" && r.sessionId === webhookSession, session: webhookSession },
    { name: "webhook naming none", pick: (r) => r.source === "webhook" && r.flowKind === "desk" && r.sessionId !== webhookSession && r.status !== "suspended" },
    { name: "per-fire schedule fire", pick: (r) => r.flowKind === "clock" && JSON.stringify(r.metadata ?? {}).includes('"fire"'), oneOff: true },
    { name: "per-schedule schedule fire", pick: (r) => r.flowKind === "clock" && JSON.stringify(r.metadata ?? {}).includes('"poll"') },
    { name: "MCP call with a directive", pick: (r) => r.source === "mcp" && r.actionName === "threaded", session: mcpSession },
    { name: "MCP call with none", pick: (r) => r.source === "mcp" && r.actionName === "lookup", oneOff: true },
    { name: "internal dispatch", pick: (r) => r.source === "internal" && r.actionName === "sweep", session: internalSession }
  ];
  const seen: Array<{ name: string; record: RequestRecord }> = [];
  for (const entry of entries) {
    // Read while the run still holds: a session stamped on at the end can't pass.
    const record = await recorded((r) => since(r) && entry.pick(r), entry.name).catch((error: Error) => {
      failures.push(`a:named · ${entry.name}: ${error.message}`);
      return undefined;
    });
    if (record === undefined) continue;
    seen.push({ name: entry.name, record });
    if (record.status !== "in_progress") {
      failures.push(`setup: ${entry.name}'s run was already ${record.status} when read; the read is not mid-run`);
    }
    const sessionId = record.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      failures.push(`a:named · ${entry.name}: its request record names no session while it runs (${JSON.stringify(sessionId)})`);
      continue;
    }
    if (entry.session !== undefined && sessionId !== entry.session) {
      failures.push(`a:named · ${entry.name}: it ran in ${sessionId}, not the session it named (${entry.session})`);
    }
    if (entry.oneOff === true && !isOneOffSessionId(sessionId)) {
      failures.push(`a:one-off · ${entry.name}: its session ${sessionId} is not a one-off session`);
    }
  }
  tell.over("a:named · entry points read mid-run", seen);
  tell.over("a:one-off · one-off entry points read", seen.filter((s) => entries.find((e) => e.name === s.name)?.oneOff === true));

  holds.release();
  holds.hold = () => {};
  await Promise.allSettled(pending);
  for (const { name, record } of seen) {
    const done = await settled(record.id, name).catch(() => undefined);
    const sessionId = record.sessionId;
    if (typeof sessionId !== "string") continue;
    const session = await stores.session.get(sessionId);
    if (session === undefined) {
      failures.push(`a:named · ${name}: no session row ${sessionId}`);
      continue;
    }
    if (session.userId !== record.userId || session.flowKind !== record.flowKind) {
      failures.push(`a:named · ${name}: session ${sessionId} is ${session.userId}'s on ${session.flowKind}, the run is ${record.userId}'s on ${record.flowKind}`);
    }
    const listed = (await stores.request.list({ sessionId, tenantId: undefined, orderBy: "none", limit: 100 } as never)) as RequestRecord[];
    if (!listed.some((r) => r.id === record.id)) failures.push(`a:named · ${name}: session ${sessionId}'s listing does not return the run ${record.id}`);
    if (done === undefined) failures.push(`setup: ${name}'s run never settled once released`);
  }
  evidence.push(`a: ${seen.length} entry points each named a session mid-run (${seen.map((s) => `${s.name} → ${s.record.sessionId}`).join("; ")})`);
  const perFire = seen.find((s) => s.name === "per-fire schedule fire")?.record.sessionId;

  // ---- (b) a run with no session is refused by name, before anything is written.
  const requestsBefore = (await allRequests()).length;
  const sessionsBefore = await sessionCount(stores);
  const activeBefore = (await stores.activeRequests.listAll()).length;
  const bare = await call("POST", "/api/flows/desk/actions/ask", as(ALICE), { input: {} });
  if (bare.status !== 400 || (bare.body as { error?: string }).error !== "session-required") {
    failures.push(`b:http: an HTTP send with no session id answered ${bare.status} ${bare.text}, not 400 session-required`);
  }
  const direct = await runAction({
    flow: registry.get("desk") as never,
    actionName: "ask",
    input: {},
    userId: ALICE,
    orgId: DEFAULT_ORG_ID,
    stores,
    runtimeConfig
  } as never).then(
    () => undefined,
    (error: Error) => error
  );
  if (direct?.name !== "SessionRequiredError") {
    failures.push(`b:run-action: a runAction with no sessionId ${direct === undefined ? "ran" : `threw ${direct.name}: ${direct.message}`}, not SessionRequiredError`);
  }
  await sleep(200);
  const requestsAfter = (await allRequests()).length;
  const sessionsAfter = await sessionCount(stores);
  const activeAfter = (await stores.activeRequests.listAll()).length;
  tell.over("b:nothing-written · stores counted", [requestsBefore, sessionsBefore]);
  if (requestsAfter !== requestsBefore || sessionsAfter !== sessionsBefore || activeAfter !== activeBefore) {
    failures.push(
      `b:nothing-written: refused sends left records behind (requests ${requestsBefore}→${requestsAfter}, sessions ${sessionsBefore}→${sessionsAfter}, active ${activeBefore}→${activeAfter})`
    );
  }
  evidence.push(`b: HTTP ${bare.status} ${(bare.body as { error?: string }).error}; runAction ${direct?.name}; ${requestsAfter} requests and ${sessionsAfter} sessions before and after`);

  // ---- (c) a webhook run that parks names one session on its record and its gate; a stop settles it.
  const parkFrom = Date.now();
  const parked = await call("POST", "/api/flows/desk/webhooks/acme", {}, { type: "parks", id: `evt_parks_${stamp}` });
  if (parked.status >= 300) failures.push(`setup: the parking webhook answered ${parked.status}: ${parked.text}`);
  const parkedRecord = await recorded((r) => (r.startedAtMs ?? 0) >= parkFrom - 1 && r.source === "webhook" && r.status === "suspended", "the parking webhook").catch(
    (error: Error) => (failures.push(`c:parked: ${error.message}`), undefined)
  );
  if (parkedRecord !== undefined) {
    const gates = await gatesOf(parkedRecord.id);
    tell.over("c:parked · the parked run's gates", gates);
    for (const gate of gates) {
      if (typeof parkedRecord.sessionId !== "string" || gate.sessionId !== parkedRecord.sessionId) {
        failures.push(`c:parked: the gate names session ${JSON.stringify(gate.sessionId)}, the record ${JSON.stringify(parkedRecord.sessionId)}`);
      }
    }
    const stop = await call("POST", `/api/flows/desk/requests/${parkedRecord.id}/abort`, as(parkedRecord.userId, parkedRecord.orgId ?? ORG));
    const after = await stoppedSettled(parkedRecord.id, "the stopped webhook run").catch(() => undefined);
    if (stop.status >= 300 || after?.status !== "aborted") {
      failures.push(`c:stopped: stopping it answered ${stop.status} ${stop.text} and left it ${after?.status ?? "unsettled"}`);
    }
    evidence.push(`c: parked webhook run in ${parkedRecord.sessionId}, gate the same; stop ${stop.status} → ${after?.status}`);
  }

  // ---- (d) a request recorded with no session (an old row) is still read and stopped, never resumed.
  const otherSession = `s_other_${stamp}`;
  const other = await call("POST", `/api/flows/desk/${otherSession}/actions/ask`, as(ALICE), { input: {} });
  const otherId = (other.body as { request?: { id?: string } }).request?.id;
  if (otherId === undefined) failures.push(`setup: the run in ${otherSession} answered ${other.status} ${other.text}`);
  else await settled(otherId, "the other session's run");
  const listedBefore = await call("GET", `/api/flows/sessions/${otherSession}/requests`, as(ALICE));

  const legacy = async (n: number) => {
    const sessionId = `s_legacy_${n}_${stamp}`;
    const sent = await call("POST", `/api/flows/desk/${sessionId}/actions/approve`, as(ALICE), { input: {} });
    const id = (sent.body as { request?: { id?: string } }).request?.id;
    if (id === undefined) throw new Error(`setup: the run to seed as an old row answered ${sent.status} ${sent.text}`);
    const record = await until(async () => {
      const r = await stores.request.get(id);
      return r?.status === "suspended" ? r : undefined;
    }, "the run to seed parking");
    // The shape an old row has: no session on the record or on its gates.
    const { sessionId: _record, ...bareRecord } = record;
    await stores.request.set(id, bareRecord as RequestRecord, "any");
    const gates = await gatesOf(id);
    for (const gate of gates) {
      const { sessionId: _gate, ...bareGate } = gate;
      await stores.suspensions.set(bareGate as typeof gate);
    }
    return { id, gates: await gatesOf(id) };
  };
  const stopped = await legacy(1);
  const resumed = await legacy(2);
  tell.over("d · seeded gates with no session", [...stopped.gates, ...resumed.gates].filter((g) => g.sessionId === undefined));

  const listedAfter = await call("GET", `/api/flows/sessions/${otherSession}/requests`, as(ALICE));
  if (listedAfter.status !== 200 || listedAfter.text !== listedBefore.text) {
    failures.push(`d:listing: ${otherSession}'s listing changed with old rows present: ${listedBefore.status} ${listedBefore.text} → ${listedAfter.status} ${listedAfter.text}`);
  }
  const stopLegacy = await call("POST", `/api/flows/desk/requests/${stopped.id}/abort`, as(ALICE));
  const stoppedAfter = await stoppedSettled(stopped.id, "the stopped old row").catch(() => undefined);
  const stoppedGates = await gatesOf(stopped.id);
  if (stopLegacy.status >= 300 || stoppedAfter?.status !== "aborted" || !stoppedGates.every((g) => g.status === "stopped")) {
    failures.push(
      `d:stopped: stopping the old row answered ${stopLegacy.status} ${stopLegacy.text}, left it ${stoppedAfter?.status ?? "unsettled"}, gates ${stoppedGates.map((g) => g.status).join(",")}`
    );
  }
  const gate = resumed.gates[0];
  const resume = await call("POST", `/api/flows/desk/requests/${resumed.id}/resume`, as(ALICE), { suspensionId: gate?.suspensionId, action: "approve" });
  const gateAfter = (await gatesOf(resumed.id))[0];
  if ((resume.body as { error?: string }).error !== "legacy-sessionless-request" || gateAfter?.status !== "pending") {
    failures.push(`d:resume-refused: resuming the old row answered ${resume.status} ${resume.text}; its gate is ${gateAfter?.status}`);
  }
  evidence.push(`d: listing unchanged; stop ${stopLegacy.status} → ${stoppedAfter?.status}; resume ${resume.status} ${(resume.body as { error?: string }).error}`);

  // ---- (e) another user, org or tenant reaching (a)'s sessions gets an unused id's answer, and changes nothing there.
  const targets = [
    { name: "the HTTP session", id: httpSession },
    ...(perFire === undefined ? [] : [{ name: "the per-fire session", id: perFire }])
  ];
  const callers = [
    { name: "another user", headers: as("bob"), tenant: undefined as string | undefined },
    { name: "another org", headers: as("carol", "globex"), tenant: undefined },
    { name: "another tenant", headers: as(ALICE, ORG, "t2"), tenant: "t2" }
  ];
  const graded: string[] = [];
  for (const target of targets) {
    const ownerBefore = await stores.session.get(target.id);
    const listingBefore = ((await stores.request.list({ sessionId: target.id, tenantId: undefined, orderBy: "none", limit: 100 } as never)) as RequestRecord[]).length;
    for (const caller of callers) {
      const unused = `s_unused_${caller.name.replace(/\W/g, "")}_${stamp}`;
      const reached = await call("POST", `/api/flows/desk/${target.id}/actions/ask`, caller.headers, { input: {} });
      // An unused id: a session this caller may not read answers as one with nothing behind it.
      const baseline =
        caller.tenant === undefined
          ? await call("GET", `/api/flows/sessions/${unused}`, caller.headers)
          : await call("POST", `/api/flows/desk/${unused}/actions/ask`, caller.headers, { input: {} });
      const norm = (a: Answer, id: string) => `${a.status} ${a.text.split(id).join("<id>").replace(/"(req|request)[^"]*"/g, '"<req>"')}`;
      const same =
        caller.tenant === undefined ? norm(reached, target.id) === norm(baseline, unused) : reached.status === baseline.status && reached.status < 300;
      if (!same) failures.push(`e:foreign · ${caller.name} → ${target.name}: answered ${norm(reached, target.id)}, an unused id ${norm(baseline, unused)}`);
      graded.push(`${caller.name}→${target.name}`);
    }
    await sleep(200);
    const ownerAfter = await stores.session.get(target.id);
    const listingAfter = ((await stores.request.list({ sessionId: target.id, tenantId: undefined, orderBy: "none", limit: 100 } as never)) as RequestRecord[]).length;
    if (ownerAfter?.userId !== ownerBefore?.userId || listingAfter !== listingBefore) {
      failures.push(`e:foreign · ${target.name}: foreign sends changed it (owner ${ownerBefore?.userId}→${ownerAfter?.userId}, requests ${listingBefore}→${listingAfter})`);
    }
  }
  const strays = (await allRequests()).filter(
    (r) => (r.userId === "bob" || r.userId === "carol") && targets.some((t) => t.id === r.sessionId)
  );
  tell.over("e:foreign · caller × session pairs", graded);
  tell.over("e:foreign · foreign requests left in (a)'s sessions", strays, { emptyIs: "the claim: no foreign request lands in another's session" });
  if (strays.length > 0) failures.push(`e:foreign: ${strays.length} foreign request records landed in (a)'s sessions`);
  evidence.push(`e: ${graded.length} foreign sends answered as unused ids`);

  await disposeFlowApiRouter(await app.getRouter(), { drainMs: 0 });
  return { failures, evidence: evidence.join(" · ") };
});
