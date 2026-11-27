/**
 * Goal check — one principal: who a named reach admits once a run's principal
 * carries `kind` and `resolvedBy`, set at the door and carried unchanged
 * (FIX-2942). One row per mechanism, each with a control that must fail it;
 * the rows, the assertions and what each control fails are in goal.md.
 *
 * **Model-free.** Real hosts on in-memory stores: an inbound transport host
 * whose door resolves the caller, and a router whose scheduled route fires
 * schedules as its bearer-secret gateway. Sessions a row is about are born
 * from real runs; a row about records from before a field plants them as a
 * store held them. Every reach is judged by the one admission function a
 * block's named reach goes through (`admitNamedSession`), and every refusal is
 * compared with the answer for an id nobody holds.
 *
 * Run: pnpm tsx goals/sessions-reach/one-principal/run.mts
 * Fixture: GOAL_FIXTURE=<file in fixtures/> (default `default.json`)
 * Controls: GOAL_CONTROL=<name> (see CONTROLS and goal.md), applied as scratch
 *   patches to the engine's modules as this process loads them
 *   (`goals/lib/module-patch.mts`); nothing is written to the checkout.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler, type ScheduleConfig } from "@flow-state-dev/core";
import { latestScheduledTime } from "@flow-state-dev/core/internal";
import {
  createBearerSecretPrincipalResolver,
  createFlowApiRouter,
  createFlowRegistry,
  defaultBodyUserIdPrincipalResolver,
  disposeFlowApiRouter,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { createInboundTransportHost, createInMemoryStores, RequestOwnerMismatchError, type Principal } from "@flow-state-dev/engine/host";
import { admitNamedSession } from "../../../packages/engine/src/context/named-session.ts";
import { claimRequestRecord, resolveCallerRequestId } from "../../../packages/engine/src/context/request-principal.ts";
import { createInitialRequestRecord } from "../../../packages/engine/src/context/initial-request-record.ts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  runGoal,
  silentLogger,
  stripIntentOverrides,
  type ModulePatch
} from "../../lib/index.mts";

// Model-free: an ambient model ladder would only make a host refuse to build its resolver.
stripIntentOverrides();

const PRINCIPAL = "packages/engine/src/context/principal.ts";
const SHARED = "packages/engine/src/stores/shared.ts";
const SCOPE_KEYS = "packages/engine/src/stores/scope-keys.ts";
const RESOLVED_BY = String.raw`return resolvedBy !== undefined && target !== undefined && resolvedBy === target;`;

/** Each control swaps one rule for the wrong one, and must fail the assertion goal.md names. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // Every own-resolver target refused.
  "own-resolver-closed": [{ module: PRINCIPAL, from: RESOLVED_BY, to: "return false;" }],
  // An absent `resolvedBy` on both sides compares equal.
  "resolved-by-loose": [{ module: PRINCIPAL, from: RESOLVED_BY, to: "return resolvedBy === target;" }],
  // Every scheduled fire runs as a machine.
  "schedule-as-machine": [
    { module: PRINCIPAL, from: String.raw`if \(effective\.userId === SYSTEM_USER_ID\) return "machine";`, to: `return "machine";` }
  ],
  // A principal no resolver produced matches own-resolver targets too.
  "schedule-person-unscoped": [
    { module: PRINCIPAL, from: RESOLVED_BY, to: "return resolvedBy === undefined || (target !== undefined && resolvedBy === target);" }
  ],
  // The session store writes whatever kind a whole-record write carries.
  "kind-not-sticky": [
    {
      module: SHARED,
      from: String.raw`if \(was !== undefined && kept\[field\] !== was\)`,
      to: `if (field !== "principalKind" && was !== undefined && kept[field] !== was)`
    }
  ],
  // A session with no readable birth request reads as a person's.
  "backfill-as-person": [
    {
      module: PRINCIPAL,
      from: String.raw`if \(request === undefined \|\| request\.userId === SYSTEM_USER_ID\) return "machine";`,
      to: `if (request === undefined) return "person"; if (request.userId === SYSTEM_USER_ID) return "machine";`
    }
  ],
  // A child takes the kind of whatever record holds its parent's id, owner and org alike.
  "parent-by-bare-id": [
    {
      module: SCOPE_KEYS,
      from: String.raw`if \(child\.parentIncarnation != null\) return child\.parentIncarnation === sessionIncarnation\(parent\);`,
      to: "return true;"
    }
  ],
  // The request-id claim compares a pre-org record as it was stored.
  "claim-exact-raw": [
    { module: PRINCIPAL, from: String.raw`if \(record\.orgId != null \|\| record\.sessionId == null\) return record;`, to: "return record;" }
  ]
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL ${JSON.stringify(CONTROL)}; known: ${Object.keys(CONTROLS).join(", ")}`);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(goalTmpDir("one-principal"), `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) }
  });
  assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const fixture = z
  .object({
    org: z.string().min(1),
    person: z.string().min(1),
    otherPerson: z.string().min(1),
    scheduledPerson: z.string().min(1),
    gateway: z.string().min(1)
  })
  .parse(loadFixture(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json"));

const ORG = fixture.org;
const PERSON = fixture.person;
const SECRET = "one-principal-scheduler-secret";
const HOURLY = "0 * * * *";
const GATEWAY = { userId: fixture.gateway, orgId: ORG };
const SCHEDULED = { userId: fixture.scheduledPerson, orgId: ORG };
const UNKNOWN = "an-id-nobody-holds";

/** The latest due fire of `HOURLY`: a fixed date would age past the stale bound. */
function latestFire(): string {
  const latest = latestScheduledTime(HOURLY, "UTC", Date.now());
  if (latest === null) throw new Error("setup: the hourly schedule has no due fire");
  return new Date(latest).toISOString();
}

// ── flows ───────────────────────────────────────────────────────────────────

const run = handler({ name: "one-principal-run", inputSchema: z.object({}).passthrough(), outputSchema: z.object({}).passthrough(), execute: () => ({}) });

/** A resolver of its own: the verified-header stand-in two flows share. */
const verifiedHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-verified-user");
  return user === null || user === undefined ? null : { userId: user, orgId: ORG };
};

const notes = defineFlow({ kind: "notes", actions: { run } })();
const vault = defineFlow({ kind: "vault", actions: { run }, authentication: { resolvePrincipal: verifiedHeader } })();
// The same resolver under another host setting: a principal from its door is another answer.
const vaultLax = defineFlow({ kind: "vault-lax", actions: { run }, authentication: { resolvePrincipal: verifiedHeader, defaultUserId: "anon" } })();

const schedule = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ cron: HOURLY, block: run, session: "per-schedule", onOverlap: "allow", ...extra });
const polls = defineFlow({
  kind: "polls",
  schedules: {
    static: {
      fallback: schedule({}),
      explicit: schedule({ principal: { ...GATEWAY } }),
      named: schedule({ principal: { ...SCHEDULED } }),
      "named-two": schedule({ principal: { ...SCHEDULED } })
    }
  },
  actions: {},
  internal: { actions: { wake: { block: run } } }
})();

// ── hosts ───────────────────────────────────────────────────────────────────

type Caller = { principal: Principal; sessionId: string };

/** The principal a run started from `requestId`'s record carries: the one its door set. */
async function principalOf(stores: StoreRegistry, requestId: string): Promise<Caller> {
  for (let i = 0; i < 300; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") {
      if (record.status !== "completed") throw new Error(`setup: request ${requestId} ended ${record.status}`);
      return {
        principal: {
          userId: record.userId,
          orgId: record.orgId!,
          ...(record.tenantId != null ? { tenantId: record.tenantId } : {}),
          kind: record.principalKind ?? "machine",
          ...(record.resolvedBy != null ? { resolvedBy: record.resolvedBy } : {})
        },
        sessionId: record.sessionId!
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`setup: request ${requestId} did not settle`);
}

/** The answer an admission gives, as bytes: a refusal must be the unknown id's. */
const answer = (record: unknown) => JSON.stringify(record ?? null);

/** A host whose own resolver is the body-userId default, with `vault` and `vault-lax` on their own. */
function doorHost() {
  const registry = createFlowRegistry();
  for (const flow of [notes, vault, vaultLax]) registry.register(flow);
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig: { logger: silentLogger } });
  /** Resolve the person at `flowKind`'s door, then run there in `sessionId`: the session is born from that run. */
  const runAt = async (flowKind: string, sessionId: string) => {
    const principal = await host.resolvePrincipal({
      source: "http",
      request: new Request("http://localhost", { headers: { "x-verified-user": PERSON } }),
      envelope: { flowKind, action: "run", input: {}, metadata: { body: { userId: PERSON } } }
    });
    const handle = host.dispatch({ source: "http", flowKind, action: "run", input: {}, sessionId, principal, responseEmitter: null });
    await handle.finished;
    return principalOf(stores, handle.requestId);
  };
  /** `known: false` is a process that can't name the host's resolver. */
  const admit = (caller: Caller, target: string, known = true) =>
    admitNamedSession({ stores, registry, ...(known ? { hostResolver: defaultBodyUserIdPrincipalResolver } : {}), ...caller }, target);
  return { runAt, admit };
}

const routers: ReturnType<typeof createFlowApiRouter>[] = [];

/** A router whose host resolver is the scheduler's bearer secret. */
function scheduleHost() {
  const registry = createFlowRegistry();
  registry.register(polls);
  registry.register(vault);
  const stores = createInMemoryStores();
  const resolvePrincipal = createBearerSecretPrincipalResolver({ secret: SECRET, principal: GATEWAY });
  const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0, resolvePrincipal, runtimeConfig: { logger: silentLogger } });
  routers.push(router);
  const fire = async (scheduleId: string) => {
    const response = await router.POST(
      new Request(`http://localhost/api/flows/polls/schedules/${scheduleId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ nominalFireTime: latestFire() })
      }),
      { params: { path: ["polls", "schedules", scheduleId, "dispatch"] } }
    );
    const fired = (await response.json()) as { status: string; requestId: string };
    if (fired.status !== "accepted") throw new Error(`setup: schedule ${scheduleId} answered ${JSON.stringify(fired)}`);
    return principalOf(stores, fired.requestId);
  };
  const admit = (caller: Caller, target: string) => admitNamedSession({ stores, registry, hostResolver: resolvePrincipal, ...caller }, target);
  return { fire, admit, stores };
}

/** Plant a session record as a store holds it, born at `at`; no `principalKind` unless given. */
async function plantSession(
  stores: StoreRegistry,
  id: string,
  at: number,
  fields: { userId?: string; parentSessionId?: string; lineageId?: string; principalKind?: "person" | "machine"; flow?: string } = {}
) {
  await stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: at,
      updatedAt: at,
      flowKind: fields.flow ?? "notes",
      flowId: fields.flow ?? "notes",
      userId: fields.userId ?? PERSON,
      orgId: ORG,
      journal: [],
      ...(fields.parentSessionId !== undefined ? { parentSessionId: fields.parentSessionId } : {}),
      ...(fields.lineageId !== undefined ? { lineageId: fields.lineageId } : {}),
      ...(fields.principalKind !== undefined ? { principalKind: fields.principalKind } : {})
    },
    "any"
  );
}

/**
 * Plant a request record in `sessionId`, created at `at`, as a release before
 * `principalKind` stored it. `source: null` is a record from before `source`.
 */
async function plantRequest(
  stores: StoreRegistry,
  id: string,
  sessionId: string,
  at: number,
  fields: { source?: string | null; orgId?: string | null } = {}
) {
  const built = createInitialRequestRecord(
    {
      requestId: id,
      flowKind: "notes",
      flowId: "notes",
      actionName: "run",
      userId: PERSON,
      sessionId,
      ...(fields.orgId === null ? {} : { orgId: fields.orgId ?? ORG }),
      ...(typeof fields.source === "string" ? { source: fields.source } : {})
    },
    at
  );
  const { source, ...unsourced } = built;
  const record = fields.source === null ? (unsourced as typeof built) : { ...built, source };
  await stores.request.set(id, { ...record, status: "completed", finalizedAtMs: at }, "absent");
}

/** A person's run in `sessionId`: what an HTTP turn in a session from before kinds carries. */
const personIn = (sessionId: string): Caller => ({ principal: { userId: PERSON, orgId: ORG, kind: "person" }, sessionId });

// ── the rows ────────────────────────────────────────────────────────────────

await runGoal(async (failures, tell) => {
  try {
    const evidence: string[] = [];
    const refused = (name: string, got: unknown, unknown: unknown) => {
      if (answer(got) !== answer(unknown)) failures.push(`${name} · expected the unknown id's answer ${answer(unknown)}, got ${answer(got).slice(0, 200)}`);
    };

    // own-resolver · a run whose principal the target's own resolver produced reaches that flow's other session.
    {
      const env = doorHost();
      const from = await env.runAt("vault", "v1");
      await env.runAt("vault", "v2");
      if (from.principal.resolvedBy === undefined) failures.push("own-resolver:admit · the door set no resolvedBy");
      const reached = await env.admit(from, "v2");
      if (reached?.flowKind !== "vault") failures.push(`own-resolver:admit · v2 read as ${answer(reached).slice(0, 200)}`);
      evidence.push(`own-resolver: resolvedBy ${JSON.stringify(from.principal.resolvedBy)} reached v2 (${reached?.flowKind ?? "missing"})`);
    }

    // absent · no resolvedBy on the principal, none on the target, or the same resolver under other settings: missing.
    {
      const env = doorHost();
      const from = await env.runAt("vault", "v1");
      await env.runAt("vault", "v2");
      const unknown = await env.admit(from, UNKNOWN);
      const { resolvedBy: _resolvedBy, ...noResolver } = from.principal;
      refused("absent:no-principal-resolver", await env.admit({ ...from, principal: noResolver }, "v2"), unknown);
      refused("absent:no-target-resolver", await env.admit(from, "v2", false), unknown);
      refused("absent:both-absent", await env.admit({ ...from, principal: noResolver }, "v2", false), unknown);
      const lax = await env.runAt("vault-lax", "lax1");
      if (lax.principal.resolvedBy === from.principal.resolvedBy) failures.push("absent:other-settings · two settings gave one resolvedBy");
      refused("absent:other-settings", await env.admit(lax, "v2"), unknown);
      evidence.push(`absent: four refusals compared with ${answer(unknown)}`);
    }

    // schedule · a schedule naming a person reaches that person's host-rule targets, and misses own-resolver ones.
    {
      const env = scheduleHost();
      const first = await env.fire("named");
      const second = await env.fire("named-two");
      if (first.principal.userId !== SCHEDULED.userId) failures.push(`schedule:person-reaches · fired as ${first.principal.userId}`);
      const reached = await env.admit(first, second.sessionId);
      if (reached?.userId !== SCHEDULED.userId) failures.push(`schedule:person-reaches · the other schedule's session read as ${answer(reached).slice(0, 200)}`);
      await plantSession(env.stores, "named-vault", Date.now(), { userId: SCHEDULED.userId, flow: "vault", principalKind: "person" });
      refused("schedule:person-misses-own-resolver", await env.admit(first, "named-vault"), await env.admit(first, UNKNOWN));

      const fallback = await env.fire("fallback");
      const explicit = await env.fire("explicit");
      if (fallback.principal.kind !== "machine" || explicit.principal.kind !== "machine") {
        failures.push(`schedule:gateway-is-machine · fired as ${fallback.principal.kind} and ${explicit.principal.kind}`);
      }
      refused("schedule:gateway-is-machine", await env.admit(fallback, explicit.sessionId), await env.admit(fallback, UNKNOWN));
      if ((await env.admit(fallback, fallback.sessionId)) === undefined) failures.push("schedule:gateway-is-machine · its own session read as missing");
      evidence.push(`schedule: ${first.principal.kind} reached ${second.sessionId}; the gateway's fires ran as ${fallback.principal.kind}`);
    }

    // sticky · a stale whole-record write carrying person leaves a machine's session a machine's, reaching nothing.
    {
      const env = scheduleHost();
      const fallback = await env.fire("fallback");
      const explicit = await env.fire("explicit");
      const stored = await env.stores.session.get(fallback.sessionId);
      if (stored === undefined) throw new Error("setup: the fallback schedule's session is gone");
      await env.stores.session.set(fallback.sessionId, { ...stored, principalKind: "person", version: stored.version + 1 }, "any");
      const kept = (await env.stores.session.get(fallback.sessionId))?.principalKind;
      if (kept !== "machine") failures.push(`sticky:kept · the session reads ${JSON.stringify(kept)} after the stale write`);
      // A later run in it, with no principal kind of its own (a wake), runs as the session's.
      const woke = await runAction({
        flow: polls,
        actionName: "wake" as never,
        input: {},
        userId: fallback.principal.userId,
        orgId: fallback.principal.orgId,
        sessionId: fallback.sessionId,
        source: "internal",
        metadata: {},
        stores: env.stores,
        runtimeConfig: { logger: silentLogger }
      });
      const later = await principalOf(env.stores, woke.requestId!);
      if (later.principal.kind !== "machine") failures.push(`sticky:kept · the woken run ran as ${later.principal.kind}`);
      refused("sticky:reaches-nothing", await env.admit(later, explicit.sessionId), await env.admit(later, UNKNOWN));
      evidence.push(`sticky: kept ${JSON.stringify(kept)}, the woken run was a ${later.principal.kind}'s`);
    }

    // backfill · a session from before kinds reads as its birth request's kind; nothing proven reads as a machine's.
    {
      const stores = createInMemoryStores();
      const registry = createFlowRegistry();
      registry.register(notes);
      const admit = (caller: Caller, target: string) =>
        admitNamedSession({ stores, registry, hostResolver: defaultBodyUserIdPrincipalResolver, ...caller }, target);
      const born = Date.now();
      await plantSession(stores, "target", born, { principalKind: "person" });
      const unknown = await admit(personIn("target"), UNKNOWN);

      // A person's: an HTTP birth (its record written just before the session), and one from before `source`.
      await plantSession(stores, "l-http", born, { lineageId: "lin_http" });
      await plantRequest(stores, "r-http", "l-http", born - 5, { source: "http" });
      await plantRequest(stores, "r-http-2", "l-http", born + 5, { source: "internal" });
      await plantSession(stores, "l-legacy", born);
      await plantRequest(stores, "r-legacy", "l-legacy", born - 5, { source: null });
      // A dispatched child the parent can be proven for, by the lineage it inherited.
      await plantSession(stores, "l-child", born, { parentSessionId: "l-http", lineageId: "lin_http" });
      await plantRequest(stores, "r-child", "l-child", born, { source: "internal" });
      const persons = tell.over("backfill:person-sources · sessions read", ["l-http", "l-legacy", "l-child"]);
      for (const id of persons) {
        if ((await admit(personIn(id), "target")) === undefined) failures.push(`backfill:person-sources · ${id} read as a machine's`);
      }

      // No readable request.
      await plantSession(stores, "l-none", born);
      refused("backfill:no-request", await admit(personIn("l-none"), "target"), unknown);
      // A machine's sources, and one no list names.
      const sources = tell.over("backfill:machine-sources · sources", ["scheduled", "webhook", "notification", "a-custom-transport"]);
      for (const source of sources) {
        await plantSession(stores, `l-${source}`, born);
        await plantRequest(stores, `r-${source}`, `l-${source}`, born, { source });
        refused(`backfill:machine-sources · ${source}`, await admit(personIn(`l-${source}`), "target"), unknown);
      }
      // A parent recreated under its id: a person's again, but a new incarnation with a new lineage.
      await plantSession(stores, "p-recreated", born, { lineageId: "lin_new" });
      await plantRequest(stores, "r-p-recreated", "p-recreated", born, { source: "http" });
      await plantSession(stores, "l-orphan", born, { parentSessionId: "p-recreated", lineageId: "lin_old" });
      await plantRequest(stores, "r-orphan", "l-orphan", born, { source: "internal" });
      refused("backfill:recreated-parent", await admit(personIn("l-orphan"), "target"), unknown);
      // A parent that is gone.
      await plantSession(stores, "l-lost", born, { parentSessionId: "p-gone", lineageId: "lin_gone" });
      await plantRequest(stores, "r-lost", "l-lost", born, { source: "task" });
      refused("backfill:missing-parent", await admit(personIn("l-lost"), "target"), unknown);
      // A chain past the depth bound, rooted at a person's session; the same chain within it is a person's.
      await plantSession(stores, "deep-0", born, { lineageId: "lin_deep" });
      await plantRequest(stores, "r-deep-0", "deep-0", born, { source: "http" });
      for (let i = 1; i <= 33; i += 1) {
        await plantSession(stores, `deep-${i}`, born, { parentSessionId: `deep-${i - 1}`, lineageId: "lin_deep" });
        await plantRequest(stores, `r-deep-${i}`, `deep-${i}`, born, { source: "internal" });
      }
      refused("backfill:past-depth", await admit(personIn("deep-33"), "target"), unknown);
      if ((await admit(personIn("deep-31"), "target")) === undefined) failures.push("backfill:person-sources · deep-31, within the bound, read as a machine's");
      evidence.push(`backfill: ${persons.length} person sessions reached the target; ${sources.length + 5} unproven ones read as missing`);
    }

    // pre-org · an owner retrying a request id whose record predates orgs reuses it, and nobody else does.
    {
      const stores = createInMemoryStores();
      await plantSession(stores, "s-old", Date.now());
      await plantRequest(stores, "req-old", "s-old", Date.now(), { orgId: null });
      const owner = { userId: PERSON, orgId: ORG };
      const other = { userId: fixture.otherPerson, orgId: ORG };
      const ownerId = await resolveCallerRequestId(stores, "req-old", owner);
      if (ownerId !== "req-old") failures.push(`pre-org:owner-reuses · the owner was given ${ownerId}`);
      if ((await resolveCallerRequestId(stores, "req-old", other)) === "req-old") failures.push("pre-org:other-refused · another user was given the id");
      const retry = createInitialRequestRecord(
        { requestId: "req-old", flowKind: "notes", flowId: "notes", actionName: "run", ...owner, sessionId: "s-old" },
        Date.now()
      );
      try {
        const claimed = await claimRequestRecord(stores, notes, retry);
        if (claimed.id !== "req-old") failures.push(`pre-org:owner-reuses · the claim kept ${claimed.id}`);
      } catch (error) {
        failures.push(`pre-org:owner-reuses · the owner's claim was refused: ${String(error)}`);
      }
      try {
        await claimRequestRecord(stores, notes, { ...retry, userId: other.userId });
        failures.push("pre-org:other-refused · another user's claim was accepted");
      } catch (error) {
        if (!(error instanceof RequestOwnerMismatchError)) failures.push(`pre-org:other-refused · refused with ${String(error)}`);
      }
      evidence.push(`pre-org: the owner kept ${ownerId}`);
    }

    return { failures, evidence: evidence.join("\n") };
  } finally {
    await Promise.all(routers.splice(0).map((router) => disposeFlowApiRouter(router)));
  }
});
