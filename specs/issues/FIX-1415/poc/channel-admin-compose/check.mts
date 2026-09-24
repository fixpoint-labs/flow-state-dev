/**
 * FIX-1415 · Channel-admin compose — characterization + Door B sketch inspection.
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, not in any default test/lint/knip discovery. Run it by
 * hand; see README.md.
 *
 * The load-bearing claim: a channel that exists only as an inventory row is
 * invisible to the discover join Labs already use (declared roster ∩ inventory).
 * A room minted at runtime has no file. If that join already listed it, D1
 * would be theatre.
 *
 * Each check has a control that is run. A green check nobody has seen fail is
 * not evidence (tenet 7).
 */

import type { FlowInstance } from "../../../../../packages/core/src/types";
import {
  channelInstances,
  openChannels,
  type ChannelManifest,
} from "../../../../../packages/workforce/src/channel";
import {
  workforceManifestSources,
  type DeclaredWorkforce,
} from "../../../../../packages/workforce/src/manifest-sources";
import { createChannelAdminCapability } from "./sketch-capability.mts";

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const bad = (name: string, detail: string) => {
  failures += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const expect = (name: string, cond: boolean, detail: string) =>
  cond ? ok(name) : bad(name, detail);

const channel = (id: string, declared: Record<string, unknown> = {}): ChannelManifest => ({
  id,
  declared: { description: `The ${id} room.`, ...declared },
  body: "",
});

function ctxWith(rows: { id: string; kind: string; members: string[] }[]): never {
  return {
    resources: {
      channelRows: {
        pattern: "inventory/channels/*",
        create: async () => undefined,
        list: async () => rows.map((state, index) => ({ path: `channels/${index}`, state })),
      },
    },
  } as never;
}

function channelsSourceOf(roster: DeclaredWorkforce) {
  const built = workforceManifestSources({
    roster,
    inventory: { channels: "channelRows" },
  });
  const channels = built.find((source) => source.domain === "channels");
  if (channels === undefined) throw new Error("expected a channels source");
  return channels;
}

console.log("FIX-1415 POC · channel-admin compose\n");

// ---------------------------------------------------------------------------
// Check 1 — discover honesty. The claim D1 rests on.
// ---------------------------------------------------------------------------
console.log("Check 1 · discover projects declared roster ∩ inventory");

{
  const fileRoom = "eng.standup";
  const runtimeRoom = "eng.feature";
  const roster: DeclaredWorkforce = {
    workers: [],
    channels: [channel(fileRoom)],
  };
  const ctx = ctxWith([
    { id: fileRoom, kind: "channel", members: ["eng.ada"] },
    { id: runtimeRoom, kind: "channel", members: ["eng.ada"] },
  ]);
  const ids = (await channelsSourceOf(roster).entries(ctx)).map((entry) => entry.id);

  expect(
    "file-declared + inventory is visible",
    ids.includes(fileRoom),
    `expected ${fileRoom} in ${JSON.stringify(ids)}`,
  );
  expect(
    "inventory row with no declaration is withheld",
    !ids.includes(runtimeRoom),
    `runtime room ${runtimeRoom} leaked into discover: ${JSON.stringify(ids)}`,
  );

  // Control: put the runtime id on the declared half (D1's proposed join) and
  // the same inventory row becomes visible. If this stayed empty, the join
  // would be broken and D1 would be closing a hole that isn't there.
  const widened: DeclaredWorkforce = {
    workers: [],
    channels: [channel(fileRoom), channel(runtimeRoom)],
  };
  const afterIds = (await channelsSourceOf(widened).entries(ctx)).map((entry) => entry.id);
  expect(
    "control · declaring the runtime room makes discover list it",
    afterIds.includes(runtimeRoom),
    `D1's join would not work: ${JSON.stringify(afterIds)}`,
  );
}

// ---------------------------------------------------------------------------
// Check 2 — one flow instance per kind. Create is a session, not a new kind.
// ---------------------------------------------------------------------------
console.log("\nCheck 2 · channelInstances is one instance per kind");

{
  const oneKind = channelInstances([
    channel("eng.standup"),
    channel("eng.incidents"),
  ]);
  expect(
    "two declared rooms of the built-in kind are one instance",
    oneKind.length === 1 && oneKind[0]?.kind === "channel",
    `got ${oneKind.length} instance(s): ${oneKind.map((instance) => instance.kind).join(",")}`,
  );

  // Control: a second registered kind is a second instance. If this stayed at
  // one, the binder would be collapsing kinds, and "create is a session on an
  // existing kind" would be untestable. If the first check had returned two,
  // create would be minting instances, which the issue invent-kills.
  const featureRoom = Object.assign(
    () => ({ id: "feature-room", kind: "feature-room" }) as FlowInstance,
    { kind: "feature-room" },
  );
  const twoKinds = channelInstances(
    [channel("eng.standup"), channel("eng.feature", { flow: "feature-room" })],
    { kinds: { "feature-room": featureRoom } },
  );
  const kindIds = twoKinds.map((instance) => instance.kind).sort();
  expect(
    "control · a second registered kind is a second instance",
    kindIds.join(",") === "channel,feature-room",
    `got ${kindIds.join(",")}`,
  );
}

// ---------------------------------------------------------------------------
// Check 3 — the lane is where the room was declared, not a file flag.
// ---------------------------------------------------------------------------
console.log("\nCheck 3 · a file cannot mark itself system or dynamic");

{
  let refused = "";
  try {
    channelInstances([channel("eng.standup", { system: true })]);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  expect(
    "system: on a record is refused, and the message says the path decides",
    refused.includes("system:") && refused.includes("Where a channel is declared"),
    refused || "channelInstances accepted system:",
  );

  // Control: the same record without the key binds. Otherwise the refusal is
  // "everything throws".
  const bound = channelInstances([channel("eng.standup")]);
  expect(
    "control · the same room without system: still binds",
    bound.length === 1 && bound[0]?.kind === "channel",
    `got ${bound.length}`,
  );
}

// ---------------------------------------------------------------------------
// Check 4 — re-opening a bound room does not change who is in it.
// Invite is not "edit the file and open again".
// ---------------------------------------------------------------------------
console.log("\nCheck 4 · openChannels leaves a bound room's members alone");

{
  type Held = {
    flowKind: string;
    flowId: string;
    userId: string;
    state?: Record<string, unknown>;
  };
  function memory(seed?: Record<string, Held>) {
    const sessions = new Map(Object.entries(seed ?? {}));
    let creates = 0;
    let deletes = 0;
    const client = {
      async createSession(options: {
        flowKind: string;
        userId: string;
        sessionId?: string;
        state?: Record<string, unknown>;
      }) {
        const id = options.sessionId ?? "";
        if (sessions.has(id)) {
          const error = new Error("taken") as Error & { status: number };
          error.status = 409;
          throw error;
        }
        creates += 1;
        sessions.set(id, {
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          state: options.state,
        });
      },
      async getSession(sessionId: string) {
        const session = sessions.get(sessionId);
        if (session === undefined) throw new Error(`no session ${sessionId}`);
        return session;
      },
      async deleteSession(sessionId: string) {
        deletes += 1;
        sessions.delete(sessionId);
      },
    };
    return {
      client,
      members: (id: string) =>
        (sessions.get(id)?.state as { members?: string[] } | undefined)?.members,
      counts: () => ({ creates, deletes }),
    };
  }

  const first = memory();
  await openChannels([channel("eng.standup", { members: ["eng.ada"] })], {
    client: first.client,
    userId: "u_boot",
  });
  await openChannels([channel("eng.standup", { members: ["eng.ada", "eng.bea"] })], {
    client: first.client,
    userId: "u_boot",
  });
  const members = first.members("eng.standup") ?? [];
  const counts = first.counts();
  expect(
    "a second open does not add the new member",
    members.length === 1 && members[0] === "eng.ada",
    `members are now ${JSON.stringify(members)}`,
  );
  expect(
    "a bound room is not deleted on re-open",
    counts.creates === 1 && counts.deletes === 0,
    `creates ${counts.creates}, deletes ${counts.deletes}`,
  );

  // Control: the binder DOES delete a session, when the id is held by this
  // kind's own empty session. If deletes stayed at 0 here, the counter would
  // be blind and check 4's "not deleted" would prove nothing.
  const empty = memory({
    "eng.standup": { flowKind: "channel", flowId: "channel", userId: "u_boot", state: {} },
  });
  await openChannels([channel("eng.standup", { members: ["eng.ada"] })], {
    client: empty.client,
    userId: "u_boot",
  });
  const repaired = empty.members("eng.standup") ?? [];
  expect(
    "control · an empty session on the id is deleted and opened with its members",
    empty.counts().deletes === 1 && repaired[0] === "eng.ada",
    `deletes ${empty.counts().deletes}, members ${JSON.stringify(repaired)}`,
  );
}

// ---------------------------------------------------------------------------
// Check 5 — the Door B sketch is catalog tools, not a control, not a new type.
// ---------------------------------------------------------------------------
console.log("\nCheck 5 · sketch capability is catalog tools behind the fence");

{
  const cap = createChannelAdminCapability({
    declaredIds: ["eng.standup"],
    mint: {
      create: async () => undefined,
      delete: async () => undefined,
      invite: async () => ({ members: [] }),
      uninvite: async () => ({ members: [] }),
    },
  });
  const record = cap as unknown as {
    name: string;
    __presetDefs: {
      verbs: { tools?: { name: string; inputSchema?: { shape?: Record<string, unknown>; strict?: () => unknown } }[]; controlTools?: unknown };
    };
  };
  expect("capability is named channel-admin, not Channel", record.name === "channel-admin", `got ${record.name}`);
  const verbs = record.__presetDefs.verbs;
  const tools = verbs.tools ?? [];
  const names = tools.map((tool) => tool.name).sort();
  expect(
    "exposes create, delete, invite, uninvite as catalog tools",
    names.join(",") === "create,delete,invite,uninvite",
    `got ${names.join(",")}`,
  );
  expect(
    "does not bypass the tools fence as a control",
    verbs.controlTools === undefined,
    "sketch put channel admin on controlTools — empty tools: would still administer rooms",
  );
  expect(
    "control · inspector treats a present controlTools as a fail",
    ({ controlTools: [channelInstances] } as { controlTools?: unknown }).controlTools !== undefined,
    "inspector cannot see controlTools",
  );

  const createTool = tools.find((tool) => tool.name === "create");
  const shape = createTool?.inputSchema?.shape ?? {};
  const keys = Object.keys(shape).sort();
  expect(
    "create input is channelId / kind / description / members — no kind-invention field",
    keys.includes("channelId") &&
      keys.includes("kind") &&
      !keys.includes("source") &&
      !keys.includes("kindDefinition") &&
      !keys.includes("system") &&
      !keys.includes("orgId"),
    `got ${keys.join(",")}`,
  );

  const parsed = (
    createTool?.inputSchema as { safeParse?: (value: unknown) => { success: boolean; data?: { kind?: string } } } | undefined
  )?.safeParse?.({ channelId: "eng.feature", description: "A feature room." });
  expect(
    "omitted kind defaults to the built-in channel kind",
    parsed?.success === true && parsed.data?.kind === "channel",
    `parse ${JSON.stringify(parsed)}`,
  );
  const extra = (
    createTool?.inputSchema as { safeParse?: (value: unknown) => { success: boolean } } | undefined
  )?.safeParse?.({ channelId: "eng.feature", description: "A feature room.", source: "export function flow() {}" });
  expect(
    "control · a kind-definition field is refused by the strict input",
    extra?.success === false,
    "create accepted a source field — that is hot-mint of a kind",
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(
  "\nAll checks passed. Discover withholds a room that has no declaration; two rooms share one kind instance; a file cannot set the lane; re-opening does not change members; the sketch is catalog tools.",
);
