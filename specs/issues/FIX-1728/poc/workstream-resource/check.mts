/**
 * FIX-1728 · workstream resource → owner talk session.
 *
 * Throwaway experiment. Not production code, not a workspace package, not in
 * any default test/lint/knip discovery. Run it by hand; see README.md.
 *
 * The load-bearing claim: an org can list workstream owner + status from an
 * org-scoped resource without reading any Flow session, while the owner still
 * gets a bound talk session about that row.
 *
 * Each check has a control that is run. A green check nobody has seen fail is
 * not evidence (tenet 7).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "../../../../../packages/core/src/index";
import { createFlowState, inMemoryStores, runAction } from "../../../../../packages/engine/src/index";
import {
  channelInstances,
  type ChannelManifest,
} from "../../../../../packages/workforce/src/channel";
import {
  defineWorkstreamCollection,
  openWorkstreamTalk,
  talkSessionIdOf,
  workstreamRowSchema,
  workstreamTalkManifest,
  type WorkstreamRow,
} from "./sketch.mts";

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const bad = (name: string, detail: string) => {
  failures += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const expect = (name: string, cond: boolean, detail: string) =>
  cond ? ok(name) : bad(name, detail);

const workstreams = defineWorkstreamCollection();

const writeRow = handler({
  name: "write-workstream",
  inputSchema: workstreamRowSchema,
  outputSchema: workstreamRowSchema,
  resources: { workstreams },
  execute: async (input: WorkstreamRow, ctx: { resources: { workstreams: { create: (key: string, row: WorkstreamRow) => Promise<unknown> } } }) => {
    await ctx.resources.workstreams.create(input.id, input);
    return input;
  },
});

const listRows = handler({
  name: "list-workstreams",
  inputSchema: z.object({}),
  outputSchema: z.object({ workstreams: z.array(workstreamRowSchema) }),
  resources: { workstreams },
  execute: async (
    _input: Record<string, never>,
    ctx: { resources: { workstreams: { list: () => Promise<Array<{ state: WorkstreamRow }>> } } }
  ) => ({
    workstreams: (await ctx.resources.workstreams.list()).map((ref) => ref.state),
  }),
});

const desk = defineFlow({
  kind: "workstream-desk",
  actions: {
    write: { block: writeRow },
    list: { block: listRows },
  },
} as never);

type SessionRecord = {
  id: string;
  flowKind: string;
  userId: string;
  orgId?: string;
  state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function sessionApi(stores: {
  session: {
    get: (id: string) => Promise<SessionRecord | undefined>;
    set: (id: string, record: SessionRecord, mode: string) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
  };
}) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      description?: string;
      state?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }): Promise<{ id: string }> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          userId: options.userId,
          orgId: DEFAULT_ORG_ID,
          state: options.state ?? {},
          metadata: options.metadata ?? {},
          // extra fields the store accepts; unused by this check
          ...( { flowId: options.flowKind, lineageId: `lin_${id}`, version: 0, createdAt: now, updatedAt: now, journal: [] } as object),
        } as SessionRecord,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        userId: String(found?.userId),
        orgId: found?.orgId,
        state: found?.state,
        metadata: found?.metadata,
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    },
  };
}

async function boot() {
  const alice = row("ship-q1", "Ship Q1 brief", "u_alice", "open");
  const bob = row("parked-audit", "Parked audit", "u_bob", "parked");
  const manifests = [workstreamTalkManifest(alice), workstreamTalkManifest(bob)];
  const instances = channelInstances(manifests);
  const byKind: Record<string, unknown> = Object.fromEntries(
    instances.map((instance) => [instance.kind, instance])
  );
  const deskInstance = (desk as () => { kind: string })();
  const state = createFlowState({
    flows: { ...byKind, [deskInstance.kind]: deskInstance },
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  const runtime = await state.getRuntime();
  const client = sessionApi(runtime.stores);
  return { alice, bob, runtime, client, desk: deskInstance, dispose: () => state.dispose() };
}

function row(
  id: string,
  title: string,
  ownerUserId: string,
  status: WorkstreamRow["status"]
): WorkstreamRow {
  return { id, title, ownerUserId, status, talkSessionId: talkSessionIdOf(id) };
}

async function write(host: Awaited<ReturnType<typeof boot>>, input: WorkstreamRow, orgId = DEFAULT_ORG_ID) {
  const result: { output?: WorkstreamRow; error?: unknown } = await runAction({
    flow: host.desk,
    actionName: "write",
    input,
    userId: "u_desk",
    orgId,
    sessionId: "desk.inventory",
    stores: host.runtime.stores,
    runtimeConfig: { ...host.runtime.runtimeConfig },
  } as never);
  if (result.error !== undefined) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
  return result.output ?? input;
}

async function list(
  host: Awaited<ReturnType<typeof boot>>,
  orgId = DEFAULT_ORG_ID,
  sessionId = "desk.inventory"
) {
  const result: { output?: { workstreams: WorkstreamRow[] }; error?: unknown } = await runAction({
    flow: host.desk,
    actionName: "list",
    input: {},
    userId: "u_desk",
    orgId,
    sessionId,
    stores: host.runtime.stores,
    runtimeConfig: { ...host.runtime.runtimeConfig },
  } as never);
  if (result.error !== undefined) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
  return result.output?.workstreams ?? [];
}

console.log("FIX-1728 POC · workstream resource → owner talk session\n");

// ---------------------------------------------------------------------------
// Check 1 — create writes the org row, then mints an owner-bound talk session.
// ---------------------------------------------------------------------------
console.log("Check 1 · create resource, then open owner talk session");

{
  const host = await boot();
  await write(host, host.alice);
  await openWorkstreamTalk(host.alice, { client: host.client });

  const stored = await host.runtime.stores.resourceState.get("org", DEFAULT_ORG_ID, `workstreams/${host.alice.id}`);
  const session = await host.runtime.stores.session.get(host.alice.talkSessionId);

  expect(
    "row lands in org storage",
    stored?.state?.ownerUserId === "u_alice" && stored?.state?.status === "open",
    `row was ${JSON.stringify(stored?.state)}`
  );
  expect(
    "talk session is bound to the owner, not the desk user",
    session?.userId === "u_alice" && session?.flowKind === "channel",
    `session userId=${String(session?.userId)} kind=${String(session?.flowKind)}`
  );
  expect(
    "session metadata carries resourceId",
    (session as { metadata?: { resourceId?: string } } | undefined)?.metadata?.resourceId === host.alice.id,
    `metadata=${JSON.stringify((session as { metadata?: unknown } | undefined)?.metadata)}`
  );

  // Control: putting resourceId on the CHANNEL.md-shaped record is refused.
  let refused = "";
  try {
    channelInstances([
      {
        id: "ws.illegal",
        declared: { resourceId: "ship-q1", description: "illegal" },
        body: "",
      } satisfies ChannelManifest,
    ]);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  expect(
    "control · declared resourceId is refused (closed CHANNEL.md list)",
    refused.includes("`resourceId`") && refused.includes("does not"),
    `throw was: ${refused || "(no throw)"}`
  );

  host.dispose();
}

// ---------------------------------------------------------------------------
// Check 2 — org list sees workstreams without reading sessions.
// ---------------------------------------------------------------------------
console.log("Check 2 · org inventory lists owner + status without sessions");

{
  const host = await boot();
  await write(host, host.alice);
  await write(host, host.bob);
  await openWorkstreamTalk(host.alice, { client: host.client });
  await openWorkstreamTalk(host.bob, { client: host.client });

  const before = await list(host);
  const listed = new Map(before.map((row) => [row.id, row]));
  expect(
    "both rows listed with owner and status",
    listed.get("ship-q1")?.ownerUserId === "u_alice" &&
      listed.get("ship-q1")?.status === "open" &&
      listed.get("parked-audit")?.ownerUserId === "u_bob" &&
      listed.get("parked-audit")?.status === "parked",
    `list was ${JSON.stringify(before)}`
  );

  // Control: delete the talk sessions. The inventory is the resource, so the
  // list must still answer. If it went empty, discovery was reading sessions.
  await host.client.deleteSession(host.alice.talkSessionId);
  await host.client.deleteSession(host.bob.talkSessionId);
  const afterDelete = await list(host);
  expect(
    "control · list survives deleted talk sessions",
    afterDelete.length === 2 && afterDelete.every((row) => row.ownerUserId && row.status),
    `after delete: ${JSON.stringify(afterDelete)}`
  );

  const otherOrg = await list(host, "org_other", "desk.other");
  expect(
    "control · another org lists nothing",
    otherOrg.length === 0,
    `other org listed ${JSON.stringify(otherOrg)}`
  );

  host.dispose();
}

// ---------------------------------------------------------------------------
// Check 3 — session state is talk shape only. Owner/status stay on the row.
// ---------------------------------------------------------------------------
console.log("Check 3 · session holds no owner/status");

{
  const host = await boot();
  await write(host, host.alice);
  await openWorkstreamTalk(host.alice, { client: host.client });
  const session = await host.runtime.stores.session.get(host.alice.talkSessionId);
  const state = (session?.state ?? {}) as Record<string, unknown>;
  const stateKeys = Object.keys(state).sort();

  expect(
    "session state is the channel talk shape",
    JSON.stringify(stateKeys) === JSON.stringify(["instructions", "members", "transcript"]) &&
      Array.isArray(state.members) &&
      (state.members as unknown[]).length === 0,
    `state keys=${JSON.stringify(stateKeys)} members=${JSON.stringify(state.members)}`
  );
  expect(
    "session state has no ownerUserId or status",
    !Object.hasOwn(state, "ownerUserId") && !Object.hasOwn(state, "status"),
    `state=${JSON.stringify(state)}`
  );

  const stored = await host.runtime.stores.resourceState.get("org", DEFAULT_ORG_ID, `workstreams/${host.alice.id}`);
  expect(
    "control · those fields are on the resource",
    stored?.state?.ownerUserId === "u_alice" && stored?.state?.status === "open",
    `row=${JSON.stringify(stored?.state)}`
  );

  host.dispose();
}

// ---------------------------------------------------------------------------
// Check 4 — fences: no CHANNELS.md, no L1 Workstream type.
// ---------------------------------------------------------------------------
console.log("Check 4 · fences hold on the sketch");

{
  const sketch = readFileSync(resolve(HERE, "sketch.mts"), "utf8");
  const check = readFileSync(resolve(HERE, "check.mts"), "utf8");

  expect(
    "no write of CHANNELS.md",
    !/writeFile(?:Sync)?\([^)]*CHANNELS\.md/.test(`${sketch}\n${check}`),
    "found a write of CHANNELS.md"
  );
  expect(
    "no L1 Workstream class / defineWorkstream",
    !/\bclass Workstream\b/.test(sketch) && !/\bdefineWorkstream\b/.test(sketch),
    "found a Workstream type constructor"
  );
  expect(
    "control · the sketch *does* name defineResourceCollection + openChannels",
    sketch.includes("defineResourceCollection") && sketch.includes("openChannels"),
    "sketch lost the two primitives this pattern is made of"
  );
  expect(
    "no CHANNELS.md file in this folder",
    existsSync(resolve(HERE, "CHANNELS.md")) === false,
    "CHANNELS.md exists beside the POC"
  );
}

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
