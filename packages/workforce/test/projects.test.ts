/**
 * Projects and their rooms, over the real HTTP router, as three verified users
 * in one organization: `alice` and `bob` (members), and `mallory` (in the org,
 * not a member).
 *
 * Covers the row writes (`createProject`, `setWorkstreams`, workstream claims,
 * the bind repair) and the room (`join`, `post`, `read { after }`, the
 * membership gate, the counter's retry and its committed watermark). Identity
 * comes from a verified header, never the body (BP-031).
 *
 * **Controls.** Two modules are swappable on purpose, and each swap must turn
 * this file red:
 *
 *   FSD_CONTROL=no-gate  pnpm --filter @flow-state-dev/workforce exec vitest run test/projects.test.ts
 *     The membership gate admits everyone: the outsider tests fail.
 *   FSD_CONTROL=no-retry pnpm --filter @flow-state-dev/workforce exec vitest run test/projects.test.ts
 *     The room's own retry runs once: the post burst and the join burst lose writes.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelFlow,
  defineChannelInventoryCollection,
  defineProjectBlocks,
  defineProjectsCollection,
  defineRoomLinesCollection,
  defineRoomSeqCollection,
  defineWorkstreamClaimsCollection,
  roomLineKey,
  type RoomLine,
  type RoomSeq
} from "../src/index";
import { advanceCommitted, allocateSeq, appendRoomLine, readRoom, writeLineAt } from "../src/projects/room-store";
import { postedLines } from "./channel-post-lines";

vi.mock("../src/projects/membership-gate", async (original) =>
  process.env.FSD_CONTROL === "no-gate" ? { isMember: () => true } : original()
);
vi.mock("../src/projects/cas-retry", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return process.env.FSD_CONTROL === "no-retry"
    ? { ...real, retryOnConflict: (write: () => Promise<unknown>) => write() }
    : real;
});

const ORG = "lab";
const DECLARED_CHANNELS = ["eng.feature", "eng.platform", "ops.release", "ops.oncall"];

// --- The app's own flow: the project writes, plus test-only seeds and reads. ---

const inventory = defineChannelInventoryCollection();
const claims = defineWorkstreamClaimsCollection();
const projects = defineProjectsCollection();
const rooms = { lines: defineRoomLinesCollection(), seq: defineRoomSeqCollection() };

/** Registers the declared channels, as `openInventory` does at boot. */
const seedChannels = handler({
  name: "seed-channels",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  resources: { "channel-inventory": inventory },
  execute: async (_input, ctx) => {
    const rows = ctx.resources["channel-inventory"] as unknown as ResourceCollectionRef;
    for (const id of DECLARED_CHANNELS) await rows.upsert(id, { id, kind: CHANNEL_KIND, members: [], openedAt: null });
    return {};
  }
});

/** Reads what a refused write must leave alone: a row and the claims. */
const inspect = handler({
  name: "inspect",
  inputSchema: z.object({ projectId: z.string(), workstreams: z.array(z.string()) }),
  outputSchema: z.object({ row: z.unknown(), claims: z.record(z.string().nullable()) }),
  resources: { projects, "workstream-claims": claims },
  execute: async (input, ctx) => {
    const rows = ctx.resources.projects as unknown as ResourceCollectionRef;
    const held = ctx.resources["workstream-claims"] as unknown as ResourceCollectionRef;
    const row = await rows.getOptional(input.projectId);
    const out: Record<string, string | null> = {};
    for (const id of input.workstreams) {
      out[id] = ((await held.getOptional(id))?.state.projectId as string | undefined) ?? null;
    }
    return { row: row === undefined ? null : { ...row.state }, claims: out };
  }
});

/** The room store's own steps, for the watermark legs. */
const roomRefs = (ctx: unknown) => {
  const resources = (ctx as BlockContext).resources;
  return {
    lines: resources["room-lines"] as unknown as ResourceCollectionRef<RoomLine>,
    seq: resources["room-seq"] as unknown as ResourceCollectionRef<RoomSeq>
  };
};
const roomStep = (name: string, run: (input: any, ctx: unknown) => Promise<unknown>) =>
  handler({
    name,
    inputSchema: z.record(z.unknown()),
    outputSchema: z.unknown(),
    resources: { "room-lines": rooms.lines, "room-seq": rooms.seq },
    execute: run
  });

const projectBlocks = defineProjectBlocks();
const labFlow = defineFlow({
  kind: "lab",
  actions: {
    ...projectBlocks.actions,
    inspect: { block: inspect },
    allocate: { block: roomStep("allocate", (i, ctx) => allocateSeq(roomRefs(ctx), i.projectId)) },
    writeAt: {
      block: roomStep("write-at", (i, ctx) =>
        writeLineAt(roomRefs(ctx), { projectId: i.projectId, userId: "alice", author: null, body: i.body }, i.seq)
      )
    },
    advance: {
      block: roomStep("advance", async (i, ctx) => {
        await advanceCommitted(roomRefs(ctx), i.projectId, { graceMs: i.graceMs });
        return (await roomRefs(ctx).seq.getOptional(i.projectId))?.state;
      })
    },
    append: {
      block: roomStep("append", (i, ctx) =>
        appendRoomLine(
          roomRefs(ctx),
          { projectId: i.projectId, userId: "alice", author: null, body: i.body },
          { graceMs: i.graceMs }
        )
      )
    },
    readRoom: { block: roomStep("read-room", (i, ctx) => readRoom(roomRefs(ctx), i.projectId, i.after)) },
    // What a reader would see with the watermark stubbed out: every line through `next`.
    readThroughNext: {
      block: roomStep("read-through-next", async (i, ctx) => {
        const refs = roomRefs(ctx);
        const next = (await refs.seq.getOptional(i.projectId))?.state.next ?? 0;
        const out: RoomLine[] = [];
        for (let seq = i.after + 1; seq <= next; seq += 1) {
          const line = await refs.lines.getOptional(roomLineKey(i.projectId, seq));
          if (line !== undefined) out.push({ ...line.state });
        }
        return out;
      })
    }
  }
});

/**
 * A flow of its own for the seed: a flow refuses a second declaration of the
 * inventory beside the one the project writes hold.
 */
const seederFlow = defineFlow({ kind: "seeder", actions: { seedChannels: { block: seedChannels } } });

/** The same writes with a talk kind that is not registered: every bind dispatch is refused. */
const brokenLabFlow = defineFlow({
  kind: "lab-broken",
  actions: { ...defineProjectBlocks({ talkKind: "no-such-kind" }).actions }
});

// --- Harness ---

type Answer = { status: number; json: any };

async function boot() {
  const state = createFlowState({
    flows: { lab: labFlow, "lab-broken": brokenLabFlow, seeder: seederFlow, [CHANNEL_KIND]: channelFlow() },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const router = (await state.getRouter()) as any;
  const stores: StoreRegistry = (await state.getRuntime()).stores;

  const call = async (method: "GET" | "POST", user: string, path: string[], body?: unknown, query = ""): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const openSession = async (user: string, flow: string, initial?: unknown): Promise<string> => {
    const { status, json } = await call("POST", user, [flow, "sessions"], {
      userId: user,
      ...(initial === undefined ? {} : { state: initial })
    });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session.id;
  };

  /** Run an action and wait for it to settle: its status, output and error. */
  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) return { http: answer.status, settled: undefined, output: undefined, error: answer.json };
    for (let i = 0; i < 1000; i += 1) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      if (["completed", "errored", "failed", "cancelled"].includes(polled.json?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    return { http: answer.status, settled: found.status as string, output: found.result?.output, error: found.result?.error };
  };

  /** The output of an action that must complete. */
  const ok = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const result = await act(user, flow, sessionId, action, input);
    if (result.settled !== "completed") {
      throw new Error(`${action} as ${user}: ${result.settled} ${JSON.stringify(result.error)}`);
    }
    return result.output;
  };

  await ok("alice", "seeder", await openSession("alice", "seeder"), "seedChannels", {});
  const lab = await openSession("alice", "lab");
  const inspectRow = (projectId: string, workstreams: string[] = []) =>
    ok("alice", "lab", lab, "inspect", { projectId, workstreams }) as Promise<{ row: any; claims: Record<string, string | null> }>;

  /** Wait until the row lists a talk session for `user`, and return it. */
  const sessionFor = async (projectId: string, user: string): Promise<string> => {
    for (let i = 0; i < 400; i += 1) {
      const row = (await inspectRow(projectId)).row;
      const link = (row?.sessions ?? []).find((s: { userId: string }) => s.userId === user);
      if (link !== undefined) return link.sessionId;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no talk session for ${user} on "${projectId}"`);
  };

  return { stores, call, openSession, act, ok, inspectRow, sessionFor };
}

type Harness = Awaited<ReturnType<typeof boot>>;

const refusal = (result: { settled?: string; error?: unknown }) => JSON.stringify(result.error ?? "");

/** alice creates `apollo` with bob, over workstreams from two teams. Returns everyone's talk sessions. */
async function apollo(h: Harness) {
  const aliceLab = await h.openSession("alice", "lab");
  const created = await h.ok("alice", "lab", aliceLab, "createProject", {
    id: "apollo",
    title: "Apollo",
    brief: "Ship the storefront.",
    members: ["bob"],
    workstreams: ["eng.feature", "ops.release"]
  });
  const aliceTalk = await h.sessionFor("apollo", "alice");
  const bobTalk = (await h.ok("bob", CHANNEL_KIND, await h.openSession("bob", CHANNEL_KIND), "join", { projectId: "apollo" }))
    .sessionId as string;
  return { aliceLab, created, aliceTalk, bobTalk };
}

describe("project rows", () => {
  it("creates an org project spanning two teams, owned by the creator, listed by another member of the org", async () => {
    const h = await boot();
    const { created } = await apollo(h);
    expect(created.created).toBe(true);
    expect(created.project).toMatchObject({
      id: "apollo",
      ownerUserId: "alice",
      members: ["alice", "bob"],
      workstreams: ["eng.feature", "ops.release"],
      brief: "Ship the storefront.",
      status: "active"
    });

    // Anyone in the org lists it through the browser read — mallory too: that a
    // project exists is not secret; its room is.
    const malloryLab = await h.openSession("mallory", "lab");
    const listed = await h.call("GET", "mallory", ["sessions", malloryLab, "resources", "projects"]);
    expect(listed.status).toBe(200);
    expect(listed.json.items.map((i: any) => i.clientData)).toEqual([
      expect.objectContaining({ id: "apollo", title: "Apollo", members: ["alice", "bob"] })
    ]);
    expect((await h.inspectRow("apollo", ["eng.feature", "ops.release"])).claims).toEqual({
      "eng.feature": "apollo",
      "ops.release": "apollo"
    });
  });

  it("refuses each bad write and leaves the row and the claims as they were", async () => {
    const h = await boot();
    await apollo(h);
    const before = await h.inspectRow("apollo", ["eng.feature", "ops.release", "eng.platform"]);
    const malloryLab = await h.openSession("mallory", "lab");
    const bobLab = await h.openSession("bob", "lab");

    const held = await h.act("mallory", "lab", malloryLab, "createProject", { id: "apollo", title: "Mine now" });
    expect(held.settled).not.toBe("completed");
    expect(refusal(held)).toContain("project-id-held");

    const reserved = await h.act("bob", "lab", bobLab, "createProject", { id: "unassigned", title: "No project" });
    expect(refusal(reserved)).toContain("invalid-project-id");

    const unknown = await h.act("bob", "lab", bobLab, "createProject", {
      id: "hermes",
      title: "Hermes",
      workstreams: ["eng.platform", "eng.nope"]
    });
    expect(refusal(unknown)).toContain("unknown-workstream");

    const claimed = await h.act("bob", "lab", bobLab, "createProject", {
      id: "hermes",
      title: "Hermes",
      workstreams: ["eng.platform", "eng.feature"]
    });
    expect(refusal(claimed)).toContain("workstream-claimed");
    expect(refusal(claimed)).toContain("eng.feature");

    // Nothing was half written: no hermes, apollo untouched, and the claim
    // hermes took on eng.platform before it was refused was released.
    expect((await h.inspectRow("hermes")).row).toBeNull();
    expect(await h.inspectRow("apollo", ["eng.feature", "ops.release", "eng.platform"])).toEqual(before);
    expect(before.claims["eng.platform"]).toBeNull();

    // setWorkstreams: an outsider is refused; a claimed one is refused and changes nothing.
    await h.ok("bob", "lab", bobLab, "createProject", { id: "hermes", title: "Hermes", workstreams: ["eng.platform"] });
    const outsider = await h.act("mallory", "lab", malloryLab, "setWorkstreams", { projectId: "hermes", workstreams: [] });
    expect(refusal(outsider)).toContain("not-a-member");
    const steal = await h.act("bob", "lab", bobLab, "setWorkstreams", {
      projectId: "hermes",
      workstreams: ["eng.platform", "ops.oncall", "ops.release"]
    });
    expect(refusal(steal)).toContain("workstream-claimed");
    const after = await h.inspectRow("hermes", ["eng.platform", "ops.oncall", "ops.release"]);
    expect(after.row.workstreams).toEqual(["eng.platform"]);
    expect(after.claims).toEqual({ "eng.platform": "hermes", "ops.oncall": null, "ops.release": "apollo" });

    // And a good one moves the claims with the row.
    await h.ok("bob", "lab", bobLab, "setWorkstreams", { projectId: "hermes", workstreams: ["ops.oncall"] });
    const moved = await h.inspectRow("hermes", ["eng.platform", "ops.oncall"]);
    expect(moved.row.workstreams).toEqual(["ops.oncall"]);
    expect(moved.claims).toEqual({ "eng.platform": null, "ops.oncall": "hermes" });
  });

  it("lets exactly one of two projects claiming one workstream at once land", async () => {
    const h = await boot();
    const [a, b] = [await h.openSession("alice", "lab"), await h.openSession("bob", "lab")];
    const results = await Promise.all([
      h.act("alice", "lab", a, "createProject", { id: "left", title: "Left", workstreams: ["ops.oncall"] }),
      h.act("bob", "lab", b, "createProject", { id: "right", title: "Right", workstreams: ["ops.oncall"] })
    ]);
    expect(results.filter((r) => r.settled === "completed")).toHaveLength(1);
    const loser = results.find((r) => r.settled !== "completed")!;
    expect(refusal(loser)).toContain("workstream-claimed");
    const winner = results[0]!.settled === "completed" ? "left" : "right";
    const other = winner === "left" ? "right" : "left";
    expect((await h.inspectRow(other)).row).toBeNull();
    expect((await h.inspectRow(winner, ["ops.oncall"])).claims["ops.oncall"]).toBe(winner);
  });

  it("hands a re-sent create of a project that holds workstreams its row back, rather than refusing it on its own claims", async () => {
    const h = await boot();
    const brokenLab = await h.openSession("alice", "lab-broken");
    // Committed with its claims, and left unbound: its bind was refused.
    await h.ok("alice", "lab-broken", brokenLab, "createProject", {
      id: "atlas",
      title: "Atlas",
      workstreams: ["eng.feature", "ops.release"]
    });
    expect((await h.inspectRow("atlas")).row.sessions).toEqual([]);

    // The owner re-sends it, workstreams and all, from a fresh session.
    const lab = await h.openSession("alice", "lab");
    const resent = await h.ok("alice", "lab", lab, "createProject", {
      id: "atlas",
      title: "Atlas",
      workstreams: ["eng.feature", "ops.release"]
    });
    expect(resent.created).toBe(false);
    expect(resent.project.workstreams).toEqual(["eng.feature", "ops.release"]);
    // The re-send is the repair path: the owner's talk session is bound now.
    await h.sessionFor("atlas", "alice");
    expect((await h.inspectRow("atlas", ["eng.feature", "ops.release"])).claims).toEqual({
      "eng.feature": "atlas",
      "ops.release": "atlas"
    });
  });

  it("re-binds a row whose mint failed after commit, by each repair path, and binds once", async () => {
    const h = await boot();
    const brokenLab = await h.openSession("alice", "lab-broken");
    await h.ok("alice", "lab-broken", brokenLab, "createProject", { id: "zeus", title: "Zeus" });
    await h.ok("alice", "lab-broken", brokenLab, "createProject", { id: "hera", title: "Hera" });
    await new Promise((r) => setTimeout(r, 50));
    // The rows committed; their bind was refused (no such talk kind), so both are unbound.
    expect((await h.inspectRow("zeus")).row.sessions).toEqual([]);
    expect((await h.inspectRow("hera")).row.sessions).toEqual([]);

    // Repair 1: the owner joins.
    const talk = await h.openSession("alice", CHANNEL_KIND);
    expect(await h.ok("alice", CHANNEL_KIND, talk, "join", { projectId: "zeus" })).toEqual({ sessionId: talk });
    // Repair 2: the owner re-sends the create, through a lab whose talk kind is registered.
    const lab = await h.openSession("alice", "lab");
    const resent = await h.ok("alice", "lab", lab, "createProject", { id: "hera", title: "Hera, again" });
    expect(resent.created).toBe(false);
    expect(resent.project.title).toBe("Hera");
    const heraTalk = await h.sessionFor("hera", "alice");

    // Once: repeating either repair hands back the same session and adds no entry.
    const elsewhere = await h.openSession("alice", CHANNEL_KIND);
    expect(await h.ok("alice", CHANNEL_KIND, elsewhere, "join", { projectId: "zeus" })).toEqual({ sessionId: talk });
    await h.ok("alice", "lab", lab, "createProject", { id: "hera", title: "Hera" });
    expect(await h.ok("alice", CHANNEL_KIND, elsewhere, "join", { projectId: "hera" })).toEqual({ sessionId: heraTalk });
    await new Promise((r) => setTimeout(r, 50));
    expect((await h.inspectRow("zeus")).row.sessions).toEqual([{ sessionId: talk, userId: "alice" }]);
    expect((await h.inspectRow("hera")).row.sessions).toEqual([{ sessionId: heraTalk, userId: "alice" }]);
    // The adopting window was left unbound: its state names no project.
    const state = await h.call("GET", "alice", ["sessions", elsewhere, "state"]);
    expect(state.json?.state?.resourceId ?? null).toBeNull();
  });
});

describe("project rows under racing writes", () => {
  /** A gate one write waits on, opened by another; never waits longer than `ms`. */
  const gate = () => {
    let open = () => {};
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { open: () => open(), wait: (ms: number) => Promise.race([opened, new Promise((r) => setTimeout(r, ms))]) };
  };
  const isKey = (key: string, collection: string, id: string) => key === `${collection}/${id}` || key.endsWith(`/${collection}/${id}`);

  it("keeps the claim the winning duplicate create relies on when the losing duplicate releases its own", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const states = h.stores.resourceState;
    const set = states.set.bind(states);
    let injected = false;
    // Between this create's claim on eng.feature and its row write, a duplicate
    // create of the same id lands its row: it found the claim held by "dup",
    // kept it, and won the row.
    states.set = async (scopeType, scopeId, key, state, expected) => {
      const result = await set(scopeType, scopeId, key, state, expected);
      if (!injected && result.ok && isKey(key, "workstream-claims", "eng.feature")) {
        injected = true;
        const token = (state as { token?: string }).token;
        await set(
          scopeType,
          scopeId,
          key.replace(/workstream-claims\/eng\.feature$/, "projects/dup"),
          {
            id: "dup",
            title: "Dup",
            brief: null,
            status: "active",
            ownerUserId: "alice",
            members: ["alice"],
            workstreams: ["eng.feature"],
            sessions: [],
            ...(token === undefined ? {} : { claimTokens: { "eng.feature": token } })
          },
          "absent"
        );
      }
      return result;
    };
    const resent = await h.ok("alice", "lab", lab, "createProject", { id: "dup", title: "Dup", workstreams: ["eng.feature"] });
    states.set = set;
    expect(injected).toBe(true);
    expect(resent.created).toBe(false);
    expect(resent.project.workstreams).toEqual(["eng.feature"]);
    // The winning row lists eng.feature, so its claim must still be there:
    // without it another project could take a workstream "dup" holds.
    expect((await h.inspectRow("dup", ["eng.feature"])).claims["eng.feature"]).toBe("dup");
    const bobLab = await h.openSession("bob", "lab");
    const steal = await h.act("bob", "lab", bobLab, "createProject", { id: "other", title: "Other", workstreams: ["eng.feature"] });
    expect(refusal(steal)).toContain("workstream-claimed");
  });

  it("leaves the claims matching the committed list when two workstream edits race: [a] to [] against [a] to [a, b]", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "createProject", { id: "p", title: "P", workstreams: ["eng.feature"] });
    const [one, two] = [await h.openSession("alice", "lab"), await h.openSession("alice", "lab")];

    const states = h.stores.resourceState;
    const [set, del] = [states.set.bind(states), states.delete.bind(states)];
    const twoClaimedB = gate();
    const twoWroteRow = gate();
    // The interleaving: edit one commits [] only after edit two has claimed b,
    // and edit one's cleanup of a's claim runs only after edit two committed
    // [a, b]. Each wait is bounded, so a fixed writer that never makes the
    // gated write does not hang the test.
    states.set = async (scopeType, scopeId, key, state, expected) => {
      const row = state as { workstreams?: string[] };
      if (isKey(key, "projects", "p") && row.workstreams?.length === 0) await twoClaimedB.wait(1_000);
      const result = await set(scopeType, scopeId, key, state, expected);
      if (result.ok && isKey(key, "workstream-claims", "eng.platform")) twoClaimedB.open();
      if (result.ok && isKey(key, "projects", "p") && row.workstreams?.length === 2) twoWroteRow.open();
      return result;
    };
    states.delete = async (scopeType, scopeId, key, expected) => {
      if (isKey(key, "workstream-claims", "eng.feature")) await twoWroteRow.wait(1_000);
      return del(scopeType, scopeId, key, expected);
    };
    const results = await Promise.all([
      h.act("alice", "lab", one, "setWorkstreams", { projectId: "p", workstreams: [] }),
      h.act("alice", "lab", two, "setWorkstreams", { projectId: "p", workstreams: ["eng.feature", "eng.platform"] })
    ]);
    states.set = set;
    states.delete = del;
    expect(results.map((r) => r.settled)).toEqual(["completed", "completed"]);

    // Whatever list committed last, every workstream it lists is claimed by p,
    // and nothing it does not list is.
    const after = await h.inspectRow("p", ["eng.feature", "eng.platform"]);
    expect(after.row.workstreams).toEqual(["eng.feature", "eng.platform"]);
    for (const id of ["eng.feature", "eng.platform"]) {
      expect(after.claims[id]).toBe(after.row.workstreams.includes(id) ? "p" : null);
    }
  });
  it("releases a failed edit's stamp when the row dropped the workstream while the edit was restoring it", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "createProject", { id: "q", title: "Q", workstreams: ["ops.oncall"] });
    await h.ok("alice", "lab", lab, "createProject", { id: "p", title: "P", workstreams: ["eng.feature"] });
    const recorded = (await h.inspectRow("p")).row.claimTokens?.["eng.feature"] as string | undefined;
    const [editA, editB] = [await h.openSession("alice", "lab"), await h.openSession("alice", "lab")];

    const states = h.stores.resourceState;
    const set = states.set.bind(states);
    let raced = false;
    // Edit A stamps eng.feature, is refused on ops.oncall (q holds it), and
    // hands eng.feature's claim back to the row's token. Just before that
    // hand-back lands, edit B commits [] and finds the claim still carrying
    // A's stamp, so it can't release it.
    states.set = async (scopeType, scopeId, key, state, expected) => {
      const token = (state as { token?: string }).token;
      if (!raced && isKey(key, "workstream-claims", "eng.feature") && token !== undefined && token === recorded) {
        raced = true;
        await h.ok("alice", "lab", editB, "setWorkstreams", { projectId: "p", workstreams: [] });
      }
      return set(scopeType, scopeId, key, state, expected);
    };
    const refused = await h.act("alice", "lab", editA, "setWorkstreams", { projectId: "p", workstreams: ["eng.feature", "ops.oncall"] });
    states.set = set;
    expect(recorded).toBeTypeOf("string");
    expect(raced).toBe(true);
    expect(refusal(refused)).toContain("workstream-claimed");

    // The committed row lists nothing, so nothing may hold eng.feature for p.
    const after = await h.inspectRow("p", ["eng.feature"]);
    expect(after.row.workstreams).toEqual([]);
    expect(after.claims["eng.feature"]).toBeNull();
    const bobLab = await h.openSession("bob", "lab");
    await h.ok("bob", "lab", bobLab, "createProject", { id: "r", title: "R", workstreams: ["eng.feature"] });
  });

  it("never shares a claim between duplicate creates, so the refused one releases nothing the other relies on", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "createProject", { id: "q", title: "Q", workstreams: ["ops.oncall"] });
    const [first, second] = [await h.openSession("alice", "lab"), await h.openSession("alice", "lab")];

    const states = h.stores.resourceState;
    const set = states.set.bind(states);
    let raced = false;
    let other: Awaited<ReturnType<Harness["act"]>> | undefined;
    // The first duplicate creates eng.feature's claim; before it reaches
    // ops.oncall (q holds it), the second duplicate runs whole, over
    // eng.feature alone.
    states.set = async (scopeType, scopeId, key, state, expected) => {
      const result = await set(scopeType, scopeId, key, state, expected);
      if (!raced && result.ok && isKey(key, "workstream-claims", "eng.feature")) {
        raced = true;
        other = await h.act("alice", "lab", second, "createProject", { id: "dup", title: "Dup", workstreams: ["eng.feature"] });
      }
      return result;
    };
    const refused = await h.act("alice", "lab", first, "createProject", {
      id: "dup",
      title: "Dup",
      workstreams: ["eng.feature", "ops.oncall"]
    });
    states.set = set;
    expect(raced).toBe(true);
    expect(refusal(refused)).toContain("workstream-claimed");

    // Whichever way it fell, the claims match the rows: a row listing
    // eng.feature holds its claim, and with no such row nobody does.
    const after = await h.inspectRow("dup", ["eng.feature"]);
    if (after.row === null) {
      expect(refusal(other!)).toContain("workstream-claimed");
      expect(after.claims["eng.feature"]).toBeNull();
    } else {
      expect(after.row.workstreams).toEqual(["eng.feature"]);
      expect(after.claims["eng.feature"]).toBe("dup");
    }
  });
});

describe("a project's room", () => {
  it("two members read each other's lines by cursor, each through their own session", async () => {
    const h = await boot();
    const { aliceTalk, bobTalk } = await apollo(h);
    expect(aliceTalk).not.toBe(bobTalk);

    const posted = await h.ok("alice", CHANNEL_KIND, aliceTalk, "post", { body: "kickoff: brief by Friday" });
    expect(posted).toMatchObject({ projectId: "apollo", seq: 1, userId: "alice", author: null });

    const bobView = await h.ok("bob", CHANNEL_KIND, bobTalk, "read", { after: 0 });
    expect(bobView.lines.map((l: RoomLine) => [l.seq, l.userId, l.body])).toEqual([[1, "alice", "kickoff: brief by Friday"]]);

    await h.ok("bob", CHANNEL_KIND, bobTalk, "post", { body: "on it" });
    const aliceView = await h.ok("alice", CHANNEL_KIND, aliceTalk, "read", { after: bobView.nextCursor });
    expect(aliceView.lines.map((l: RoomLine) => [l.seq, l.userId, l.body])).toEqual([[2, "bob", "on it"]]);
    expect(aliceView.nextCursor).toBe(2);

    // A line's userId is the session owner: a body field can't set it, and a
    // person's line carries no author.
    const forgedUser = await h.act("bob", CHANNEL_KIND, bobTalk, "post", { body: "as alice", userId: "alice" });
    expect(forgedUser.settled).not.toBe("completed");
    const withAuthor = await h.act("bob", CHANNEL_KIND, bobTalk, "post", { body: "as a seat", author: "pm" });
    expect(refusal(withAuthor)).toContain("author-on-a-person-post");

    // No session holds a channel-post item for project talk. (The sessions'
    // requests are there to look in: the check is not vacuous.)
    expect((await h.stores.request.list({ sessionId: aliceTalk })).length).toBeGreaterThan(0);
    expect(await postedLines(h.stores, aliceTalk)).toEqual([]);
    expect(await postedLines(h.stores, bobTalk)).toEqual([]);
  });

  it("refuses a non-member's join, read and post, even from a session forged to name the project", async () => {
    const h = await boot();
    const { aliceTalk } = await apollo(h);
    await h.ok("alice", CHANNEL_KIND, aliceTalk, "post", { body: "secret plan" });

    const mallorys = await h.openSession("mallory", CHANNEL_KIND);
    const join = await h.act("mallory", CHANNEL_KIND, mallorys, "join", { projectId: "apollo" });
    expect(refusal(join)).toContain("not-a-member");

    // Session state is caller-written at create, so this lands — and grants nothing.
    const forged = await h.openSession("mallory", CHANNEL_KIND, { resourceId: "apollo" });
    const read = await h.act("mallory", CHANNEL_KIND, forged, "read", { after: 0 });
    const post = await h.act("mallory", CHANNEL_KIND, forged, "post", { body: "hi from outside" });
    expect(read.settled).not.toBe("completed");
    expect(refusal(read)).toContain("not-a-member");
    expect(post.settled).not.toBe("completed");
    expect(refusal(post)).toContain("not-a-member");

    // Neither room collection is readable by a browser, and alice's session is not hers.
    expect((await h.call("GET", "mallory", ["sessions", forged, "resources", "room-lines"])).status).toBe(403);
    expect((await h.call("GET", "mallory", ["sessions", forged, "resources", "room-seq"])).status).toBe(403);
    expect((await h.act("mallory", CHANNEL_KIND, aliceTalk, "read", { after: 0 })).http).toBe(404);

    const row = (await h.inspectRow("apollo")).row;
    expect(row.members).toEqual(["alice", "bob"]);
    expect(row.sessions.map((s: { userId: string }) => s.userId).sort()).toEqual(["alice", "bob"]);
    const seen = await h.ok("alice", CHANNEL_KIND, aliceTalk, "read", { after: 0 });
    expect(seen.lines.map((l: RoomLine) => l.body)).toEqual(["secret plan"]);
  });

  it("refuses to join from a declared channel's session, which keeps its channel path", async () => {
    const h = await boot();
    await apollo(h);
    const channel = await h.openSession("bob", CHANNEL_KIND, { members: ["bob", "alice"], instructions: "Feature work." });
    const join = await h.act("bob", CHANNEL_KIND, channel, "join", { projectId: "apollo" });
    expect(join.settled).not.toBe("completed");
    expect(refusal(join)).toContain("talk-on-a-channel");

    // Nothing was bound: the session names no project, the row lists bob's
    // own talk session only, and a post there stays a channel post.
    const state = await h.call("GET", "bob", ["sessions", channel, "state"]);
    expect(state.json?.state?.resourceId ?? null).toBeNull();
    const row = (await h.inspectRow("apollo")).row;
    expect(row.sessions.map((s: { sessionId: string }) => s.sessionId)).not.toContain(channel);
    await h.ok("bob", CHANNEL_KIND, channel, "post", { body: "still the channel" });
    expect((await postedLines(h.stores, channel)).length).toBe(1);
  });

  it("lands every post of a parallel burst from four members", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const people = ["alice", "bob", "carol", "dave"];
    await h.ok("alice", "lab", lab, "createProject", { id: "burst", title: "Burst", members: people.slice(1) });
    const talk: Record<string, string> = {};
    for (const user of people) {
      talk[user] = (await h.ok(user, CHANNEL_KIND, await h.openSession(user, CHANNEL_KIND), "join", { projectId: "burst" }))
        .sessionId;
    }
    const PER = 6;
    const outcomes = await Promise.all(
      people.flatMap((user) =>
        Array.from({ length: PER }, (_, i) => h.act(user, CHANNEL_KIND, talk[user]!, "post", { body: `${user}-${i}` }))
      )
    );
    expect(outcomes.filter((o) => o.settled !== "completed").map(refusal)).toEqual([]);
    const room = await h.ok("bob", CHANNEL_KIND, talk.bob!, "read", { after: 0 });
    expect(room.lines).toHaveLength(people.length * PER);
    expect(room.lines.map((l: RoomLine) => l.seq)).toEqual(Array.from({ length: people.length * PER }, (_, i) => i + 1));
  });

  it("leaves exactly one talk session per member after a parallel burst of joins, two windows each, from eight members", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const people = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"];
    await h.ok("alice", "lab", lab, "createProject", { id: "joins", title: "Joins", members: people.slice(1) });
    // Let the create's own bind for alice land first, so the burst races joins only.
    await h.sessionFor("joins", "alice");
    const windows = await Promise.all(
      people.flatMap((user) => [h.openSession(user, CHANNEL_KIND), h.openSession(user, CHANNEL_KIND)].map(async (s) => ({ user, session: await s })))
    );
    const joined = await Promise.all(windows.map((w) => h.act(w.user, CHANNEL_KIND, w.session, "join", { projectId: "joins" })));
    expect(joined.filter((j) => j.settled !== "completed").map(refusal)).toEqual([]);

    const row = (await h.inspectRow("joins")).row;
    expect(row.sessions.map((s: { userId: string }) => s.userId).sort()).toEqual([...people].sort());
    // Both windows of one person were handed the same session: the one the row lists.
    for (const user of people) {
      const listed = row.sessions.find((s: { userId: string }) => s.userId === user).sessionId;
      const handed = joined.filter((_, i) => windows[i]!.user === user).map((j) => j.output.sessionId);
      expect(new Set(handed)).toEqual(new Set([listed]));
    }
  });
});

describe("the committed watermark", () => {
  it("never lets a reader pass a line that was allocated and not yet written", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const run = (action: string, input: Record<string, unknown>) => h.ok("alice", "lab", lab, action, { projectId: "w", ...input });

    await run("append", { body: "one" });
    const paused = await run("allocate", {}); // a writer that allocated 2 and has not written it
    expect(paused).toBe(2);
    await run("append", { body: "three" });

    // The read stops at the gap; it hands back a cursor that will still see line 2.
    expect(await run("readRoom", { after: 1 })).toEqual({ lines: [], nextCursor: 1 });
    // With the watermark stubbed out, a reader would take line 3, move its
    // cursor to 3, and never see line 2.
    const skipped = (await run("readThroughNext", { after: 1 })) as RoomLine[];
    expect(skipped.map((l) => l.body)).toEqual(["three"]);

    // The paused writer finishes, and both lines appear, in order.
    expect(await run("writeAt", { seq: 2, body: "two" })).toBe(true);
    await run("advance", { graceMs: 60_000 });
    const page = (await run("readRoom", { after: 1 })) as { lines: RoomLine[]; nextCursor: number };
    expect(page.lines.map((l) => l.body)).toEqual(["two", "three"]);
    expect(page.nextCursor).toBe(3);
  });

  it("tombstones a line still missing after the grace period, so the watermark moves on", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const run = (action: string, input: Record<string, unknown>) => h.ok("alice", "lab", lab, action, { projectId: "t", ...input });

    await run("append", { body: "one" });
    expect(await run("allocate", {})).toBe(2); // this writer dies
    await run("append", { body: "three", graceMs: 60_000 });
    expect(((await run("readRoom", { after: 0 })) as { lines: RoomLine[] }).lines.map((l) => l.body)).toEqual(["one"]);

    // The next poster finds the gap past its grace period and fills it.
    await run("append", { body: "four", graceMs: 0 });
    const page = (await run("readRoom", { after: 0 })) as { lines: RoomLine[]; nextCursor: number };
    expect(page.lines.map((l) => l.body)).toEqual(["one", "three", "four"]);
    expect(page.nextCursor).toBe(4);

    // The late writer finds its key taken by the tombstone, so it would allocate again.
    expect(await run("writeAt", { seq: 2, body: "two, late" })).toBe(false);
  });

  it("lets the first poster after the grace period fill a dead writer's line, so no second poster is needed", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const run = (action: string, input: Record<string, unknown>) => h.ok("alice", "lab", lab, action, { projectId: "d", ...input });

    await run("append", { body: "one", graceMs: 50 });
    expect(await run("allocate", {})).toBe(2); // this writer dies
    await new Promise((r) => setTimeout(r, 150)); // the gap is now older than the grace period
    await run("append", { body: "three", graceMs: 50 });

    // One later post is enough: the gap's clock started when it was allocated.
    const page = (await run("readRoom", { after: 0 })) as { lines: RoomLine[]; nextCursor: number };
    expect(page.lines.map((l) => l.body)).toEqual(["one", "three"]);
    expect(page.nextCursor).toBe(3);
  });
});
