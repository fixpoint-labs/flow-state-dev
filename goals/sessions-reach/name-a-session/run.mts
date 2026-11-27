/**
 * Goal check — name a session: a block in one session reads, lists and writes
 * another of its owner's sessions' copy by naming it,
 * `ctx.resources.at({ session }).<name>` (FIX-2942). The rows, the assertions
 * and what each control fails are in goal.md.
 *
 * **Model-free.** A real `createFlowState` host on in-memory stores, its door
 * resolving the caller from two headers, its router's sweeper firing wakes.
 * Every session a row reaches is born from a real run at a door; the cases a
 * door can't make (another tenant's session, one with no org) are planted as
 * a store holds them. Every answer is what the block got back, and what the
 * named session heard is read off the bus and from the turns its entry ran,
 * never from the admission function.
 *
 * Run: pnpm tsx goals/sessions-reach/name-a-session/run.mts
 * Fixture: GOAL_FIXTURE=<file in fixtures/> (default `default.json`)
 * Controls: GOAL_CONTROL=<name> (see CONTROLS and goal.md), applied as scratch
 *   patches to the engine's modules as this process loads them
 *   (`goals/lib/module-patch.mts`); nothing is written to the checkout.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core/internal";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { InboundTransportHost } from "@flow-state-dev/engine/host";
import { dispatchInternalAs } from "../../../packages/engine/src/durability/dispatch-internal.ts";
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
  sleep,
  stripIntentOverrides,
  type ModulePatch
} from "../../lib/index.mts";

// Model-free: an ambient model ladder would only make a host refuse to build its resolver.
stripIntentOverrides();

const PRINCIPAL = "packages/engine/src/context/principal.ts";
const WAKES = "packages/engine/src/stores/memory/wake-store.ts";
const CONTEXT = "packages/engine/src/context/createExecutionContext.ts";

/** Each control swaps one rule for the wrong one, and must fail the assertion goal.md names. */
const CONTROLS: Record<string, ModulePatch[]> = {
  // The owner comparison checks the user only: another org's session is the user's.
  "owner-user-only": [
    { module: PRINCIPAL, from: String.raw`if \(\(record\.orgId \?\? undefined\) !== principal\.orgId\) return false;`, to: "" },
    { module: PRINCIPAL, from: String.raw`return tenantMatches\(record\.tenantId \?\? undefined, principal\.tenantId\);`, to: "return true;" }
  ],
  // Wakes stop coalescing: each write's is kept apart (by its due time), so each starts a turn.
  "turn-per-write": [
    {
      module: WAKES,
      from: String.raw`return \x60\$\{key\.tenantId \?\? ""\}\\u0000\$\{key\.sessionId\}\\u0000\$\{key\.entry\}\x60;`,
      to: 'return `${key.tenantId ?? ""}\\u0000${key.sessionId}\\u0000${key.entry}\\u0000${key.dueAt ?? ""}`;'
    }
  ],
  // The fence reads the webhook source only, not the origin a delivery's owner runs carry.
  "webhook-source-only": [
    {
      module: CONTEXT,
      from: String.raw`const namedFence = \{ origin: readDeliveryOrigin\(options\.source, options\.metadata\), sessionId \};`,
      to: 'const namedFence = { origin: options.source === "webhook" ? "webhook" : undefined, sessionId };'
    }
  ]
};

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL ${JSON.stringify(CONTROL)}; known: ${Object.keys(CONTROLS).join(", ")}`);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(goalTmpDir("name-a-session"), `patch-mark-${RUN_STAMP}`);
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
  .object({ org: z.string().min(1), otherOrg: z.string().min(1), person: z.string().min(1), otherPerson: z.string().min(1), tenant: z.string().min(1) })
  .parse(loadFixture(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json"));

const ORG = fixture.org;
const PERSON = fixture.person;
const UNKNOWN = "an-id-nobody-holds";
const BURST = 20;

// ── flows ───────────────────────────────────────────────────────────────────

const row = z.object({ text: z.string() });
/** The one definition both flows declare: each session has its own copy. */
const notes = defineResourceCollection({ pattern: "notes/*", scope: "session", stateSchema: row, client: {} });
/** An inbox whose writes from another session start a turn of `inboxChanged` there. */
const inbox = defineResourceCollection({ pattern: "inbox/*", scope: "session", stateSchema: row, wakeEntry: "inboxChanged" });

type Verb = "read" | "list" | "write" | "burst";
/** What each `probe` run got back, in order: the block's own answer, as bytes. */
const answers: string[] = [];
/** Each turn of `inboxChanged`: the session it ran in and how many rows it read. */
const turns: Array<{ session: string; rows: number }> = [];

const probe = handler({
  name: "name-a-session-probe",
  inputSchema: z.object({ target: z.string(), verb: z.enum(["read", "list", "write", "burst"]), text: z.string().optional() }),
  outputSchema: z.object({}),
  execute: async ({ target, verb, text }, ctx) => {
    const copy = (ctx.resources as any).at({ session: target });
    const act: Record<Verb, () => Promise<unknown>> = {
      read: async () => (await copy.notes.getOptional("n1"))?.state.text ?? null,
      list: async () => (await copy.notes.list()).map((r: { state: { text: string } }) => r.state.text).sort(),
      write: async () => (await copy.notes.create(`from-${ctx.request.identity.id}`, { text: text ?? "written" })).state.text,
      burst: async () => {
        for (let i = 0; i < BURST; i += 1) await copy.inbox.create(`m${i}`, { text: `ending ${i}` });
        return BURST;
      }
    };
    try {
      answers.push(JSON.stringify({ ok: await act[verb]() }));
    } catch (error) {
      answers.push(JSON.stringify({ error: (error as Error).name, message: (error as Error).message }));
    }
    return {};
  }
});

const seed = handler({
  name: "name-a-session-seed",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({}),
  execute: async ({ text }, ctx) => {
    await (ctx.resources as any).notes.create("n1", { text });
    return {};
  }
});

/** The turn a write from another session starts: reads what changed, then settles its wake. */
const inboxChanged = handler({
  name: "name-a-session-inbox-changed",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    const wakes = requireRequestHost(ctx).wakes;
    const read = await wakes?.read("inboxChanged");
    turns.push({ session: ctx.session.identity.id, rows: (await (ctx.resources as any).inbox.list()).length });
    if (wakes !== undefined && read !== undefined) await wakes.settle("inboxChanged", read, null);
    return {};
  }
});

const actions = { probe, seed };
const internal = { actions: { probe: { block: probe }, inboxChanged: { block: inboxChanged } } };
const alpha = defineFlow({ kind: "alpha", actions, internal, resources: { notes, inbox } })();
const beta = defineFlow({ kind: "beta", actions, internal, resources: { notes, inbox } })();
/** A flow with a resolver of its own: a principal from the host's door is not one it produced. */
const vault = defineFlow({
  kind: "vault",
  actions,
  resources: { notes, inbox },
  authentication: {
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-verified-user");
      return user === null || user === undefined ? null : { userId: user, orgId: ORG };
    }
  }
})();

// ── the host ────────────────────────────────────────────────────────────────

async function boot() {
  let host: InboundTransportHost | undefined;
  const state = createFlowState({
    flows: [alpha, beta, vault],
    stores: { default: { primary: inMemoryStores() } },
    // Wakes need durable execution; in-memory stores leave it off by default.
    durable: true,
    logger: silentLogger,
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org");
      return typeof user === "string" ? { userId: user, orgId: org ?? ORG } : null;
    },
    adapters: [{ source: "goal", createBindings: (h: InboundTransportHost) => ((host = h), {}) }]
  } as never);
  await state.getRouter();
  if (host === undefined) throw new Error("setup: the host was never handed to the adapter");
  const door = host;
  // The stores the host runs on, its in-memory bus included.
  const stores = door.stores;

  /** Run `action` in `sessionId` as `userId` of `orgId`, through the door at `flowKind`. */
  const runAt = async (flowKind: string, sessionId: string, action: string, input: Record<string, unknown>, who = { userId: PERSON, orgId: ORG }) => {
    const principal = await door.resolvePrincipal({
      source: "http",
      request: new Request("http://localhost", { headers: { "x-user": who.userId, "x-org": who.orgId, "x-verified-user": who.userId } }),
      envelope: { flowKind, action, input, metadata: {} }
    });
    const handle = door.dispatch({ source: "http", flowKind, action, input, sessionId, principal, responseEmitter: null });
    await handle.finished;
    const record = await stores.request.get(handle.requestId);
    if (record?.status !== "completed") throw new Error(`setup: ${flowKind}/${action} in ${sessionId} ended ${record?.status}`);
  };
  /** What a block in alice's session `a` got back for `verb` on `target`. */
  const reach = async (target: string, verb: Verb, from = "a", flowKind = "alpha") => {
    const before = answers.length;
    await runAt(flowKind, from, "probe", { target, verb });
    if (answers.length !== before + 1) throw new Error(`setup: the probe ran ${answers.length - before} times`);
    return answers.at(-1)!;
  };
  /** The same, from a run a webhook delivery fired: an owner run carrying the delivery's origin. */
  const reachFromDelivery = async (target: string, verb: Verb) => {
    const before = answers.length;
    const handle = dispatchInternalAs(door as never, {
      flowKind: "alpha",
      entry: "probe",
      input: { target, verb },
      as: { userId: PERSON, orgId: ORG, kind: "person" },
      sessionId: "a",
      metadata: {},
      origin: "webhook"
    });
    await handle.finished;
    if (answers.length !== before + 1) throw new Error(`setup: the delivery's probe ran ${answers.length - before} times`);
    return answers.at(-1)!;
  };
  /** The same, from a machine's run (a schedule's gateway, a delivery's service principal). */
  const reachAsMachine = async (target: string, verb: Verb) => {
    const before = answers.length;
    const handle = dispatchInternalAs(door as never, {
      flowKind: "alpha",
      entry: "probe",
      input: { target, verb },
      as: { userId: PERSON, orgId: ORG, kind: "machine" },
      sessionId: "machine-own",
      metadata: {}
    });
    await handle.finished;
    if (answers.length !== before + 1) throw new Error(`setup: the machine's probe ran ${answers.length - before} times`);
    return answers.at(-1)!;
  };
  /** Every resource notice on `sessionId`'s topic, from now on. */
  const hear = (sessionId: string, tenantId = "") => {
    const heard: unknown[] = [];
    stores.bus!.subscribe({ scope: "session", id: sessionId, tenantId }, (notice) => {
      if (notice.kind === "resource") heard.push(notice);
    });
    return heard;
  };
  /**
   * Plant a session record as a store holds it: the cases no door can make.
   * Another tenant's is planted at the key the caller's lookup reads, the
   * key-ambiguity case, so only its stored tenant tells it apart.
   */
  const plant = async (id: string, fields: { tenantId?: string; orgId?: string | null }) => {
    const key = id;
    const now = Date.now();
    await stores.session.set(
      key,
      {
        id: key,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: "beta",
        flowId: "beta",
        userId: PERSON,
        journal: [],
        principalKind: "person",
        ...(fields.orgId === null ? {} : { orgId: fields.orgId ?? ORG }),
        ...(fields.tenantId !== undefined ? { tenantId: fields.tenantId } : {})
      },
      "absent"
    );
    await stores.resourceState.set("session", key, "notes/n1", { text: `planted ${id}` } as never, "any");
  };
  /** The stored rows of `sessionId`'s notes copy. */
  const storedNotes = async (sessionId: string) =>
    Object.values(await stores.resourceState.getByPrefix("session", sessionId, "notes/")).map((r) => (r.state as { text: string }).text).sort();
  return { runAt, reach, reachFromDelivery, reachAsMachine, hear, plant, storedNotes, dispose: () => state.dispose() };
}

// ── the rows ────────────────────────────────────────────────────────────────

await runGoal(async (failures, tell) => {
  const env = await boot();
  try {
    const evidence: string[] = [];
    const ok = (value: unknown) => JSON.stringify({ ok: value });

    // Sessions born from real runs: alice's `a` (alpha) and `b` (beta), bob's, alice's in another org, alice's at vault.
    await env.runAt("alpha", "a", "seed", { text: "mine" });
    await env.runAt("beta", "b", "seed", { text: "theirs" });
    await env.runAt("beta", "bob-s", "seed", { text: "bob's" }, { userId: fixture.otherPerson, orgId: ORG });
    await env.runAt("beta", "other-org", "seed", { text: "elsewhere" }, { userId: PERSON, orgId: fixture.otherOrg });
    await env.runAt("vault", "vault-s", "seed", { text: "vaulted" });
    await env.plant("other-tenant", { tenantId: fixture.tenant });
    await env.plant("no-org", { orgId: null });

    // same-owner · B's copy read, listed and written, by alpha's definition at beta's session.
    {
      const read = await env.reach("b", "read");
      if (read !== ok("theirs")) failures.push(`same-owner:read · read ${read}`);
      const listed = await env.reach("b", "list");
      if (listed !== ok(["theirs"])) failures.push(`same-owner:list · listed ${listed}`);
      const onB = env.hear("b");
      const onA = env.hear("a");
      const wrote = await env.reach("b", "write");
      if (wrote !== ok("written")) failures.push(`same-owner:write · wrote ${wrote}`);
      // B's own run reads the write as its own data.
      const own = await env.reach("b", "list", "b", "beta");
      if (own !== ok(["theirs", "written"])) failures.push(`same-owner:write · B's own run lists ${own}`);
      if (onB.length !== 1) failures.push(`same-owner:one-notice-per-write · B's topic heard ${onB.length} notices for one write`);
      if (onA.length !== 0) failures.push(`same-owner:one-notice-per-write · A's topic heard ${onA.length} of B's write`);
      evidence.push(`same-owner: read ${read}, listed ${listed}, wrote ${wrote}; B heard ${onB.length}, A heard ${onA.length}`);
    }

    // same-owner · twenty writes in one burst start one turn of B's entry, as a wake.
    {
      await env.reach("b", "burst");
      const deadline = Date.now() + 15_000;
      while (turns.length === 0 && Date.now() < deadline) await sleep(100);
      // Long enough for a second turn, were each write its own: past the wake's due time and a sweeper tick.
      await sleep(4_000);
      const inB = turns.filter((t) => t.session === "b");
      if (inB.length !== 1) failures.push(`same-owner:one-turn-per-burst · ${BURST} writes started ${inB.length} turns of B's entry`);
      else if (inB[0]!.rows !== BURST) failures.push(`same-owner:one-turn-per-burst · the turn read ${inB[0]!.rows} of ${BURST} rows`);
      if (turns.some((t) => t.session !== "b")) failures.push(`same-owner:one-turn-per-burst · a turn ran in ${JSON.stringify(turns)}`);
      evidence.push(`burst: ${BURST} writes, ${inB.length} turn(s) of inboxChanged in b, reading ${inB[0]?.rows ?? 0} rows`);
    }

    // refusal · each case answers read, list and write exactly as an id nobody holds, and nothing lands.
    {
      const verbs = tell.over("refusal · verbs", ["read", "list", "write"] as const);
      const unknown: Record<string, string> = {};
      for (const verb of verbs) unknown[verb] = await env.reach(UNKNOWN, verb);
      if (!unknown.read!.includes("SessionNotFoundError")) failures.push(`refusal · an unknown id read as ${unknown.read}`);
      const cases: Array<[string, string]> = [
        ["other-user", "bob-s"],
        ["other-org", "other-org"],
        ["other-tenant", "other-tenant"],
        ["no-org", "no-org"],
        ["own-resolver", "vault-s"]
      ];
      for (const [name, target] of tell.over("refusal · cases", cases)) {
        for (const verb of verbs) {
          const got = await env.reach(target, verb);
          if (got !== unknown[verb]) failures.push(`refusal:${name} · ${verb} answered ${got.slice(0, 160)}, an unknown id ${unknown[verb]}`);
        }
      }
      // A machine's run reaches none of its owner's sessions, the person's own included.
      for (const verb of verbs) {
        const got = await env.reachAsMachine("b", verb);
        const missing = await env.reachAsMachine(UNKNOWN, verb);
        if (got !== missing) failures.push(`refusal:machine · ${verb} answered ${got.slice(0, 160)}, an unknown id ${missing}`);
      }
      for (const [target, seeded] of [["bob-s", "bob's"], ["other-org", "elsewhere"], ["vault-s", "vaulted"], ["b", null]] as const) {
        const rows = await env.storedNotes(target);
        if (seeded !== null && JSON.stringify(rows) !== JSON.stringify([seeded])) failures.push(`refusal · ${target} holds ${JSON.stringify(rows)} after the refused writes`);
      }
      evidence.push(`refusal: ${cases.length} cases and a machine's run, ${verbs.length} verbs each, answered ${unknown.read}`);
    }

    // webhook · an owner run a delivery fired is refused alike on every verb, naming the rule; its own session is its own.
    {
      const verbs = tell.over("webhook · verbs", ["read", "list", "write"] as const);
      const said = new Set<string>();
      for (const verb of verbs) {
        const got = await env.reachFromDelivery("b", verb);
        said.add(got);
        if (!got.includes("UntrustedReachError")) failures.push(`webhook:the-owner-run-is-refused · ${verb} on b answered ${got.slice(0, 160)}`);
      }
      const unknownToo = await env.reachFromDelivery(UNKNOWN, "read");
      said.add(unknownToo);
      if (said.size !== 1) failures.push(`webhook:names-the-rule · ${said.size} different refusals: ${[...said].join(" | ").slice(0, 300)}`);
      if ([...said][0]?.includes("\"b\"")) failures.push("webhook:names-the-rule · the refusal names the session");
      const own = await env.reachFromDelivery("a", "list");
      if (own !== ok(["mine"])) failures.push(`webhook:own-session · its own session listed ${own}`);
      const rowsInB = await env.storedNotes("b");
      if (rowsInB.length !== 2) failures.push(`webhook:the-owner-run-is-refused · b holds ${JSON.stringify(rowsInB)} after the refused write`);
      evidence.push(`webhook: refused with ${[...said][0]}`);
    }

    return { failures, evidence: evidence.join("\n") };
  } finally {
    await env.dispose();
  }
});
