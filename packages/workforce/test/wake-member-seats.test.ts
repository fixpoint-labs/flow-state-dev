/**
 * `wakeMemberSeats`: the notify block that wakes each member whose hired seat
 * declares the internal `onChannelPost` entry, on a real in-process host.
 *
 * What is graded is what each seat heard, never the router's output: the
 * listening kind below records every post it runs on (which seat, which
 * conversation, which post), and the fallback records every member it ran for.
 * A dispatch handle proves nothing here; a run does.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1602/BUSINESS-RULES.md`, V1):
 *
 *   BR-1, BR-8, BR-9  a post with no author runs each declaring member once,
 *                     in one conversation per seat per channel, reused by
 *                     the next post. The built-in `agent` kind and an app's
 *                     own kind (BR-6) alike.
 *   BR-2              a member whose kind declares no entry runs nothing and
 *                     gets the fallback.
 *   BR-3, BR-13       a post with an author runs no seat, and a member that
 *                     would have woken gets nothing, not even the fallback;
 *                     every other member gets the fallback as on any post.
 *   BR-4, BR-15       a member with no seat among those passed gets the
 *                     fallback; an empty seat list gives everyone the
 *                     fallback. A hired seat in no channel never runs.
 *   BR-5              a seat minted from a stored roster row, at
 *                     `<org>.<seatId>`, wakes by its logical id. Two such
 *                     seats of one id in two organizations: the post's
 *                     organization decides which.
 *   BR-7              a seat whose entry refuses the post fails alone; the
 *                     others still run.
 *   BR-10             a seat in two channels keeps a conversation per channel.
 *   BR-12             no fallback passed: a member not woken gets nothing.
 *
 * BR-14 (seats, not ids) is the compile-time half, in
 * `wake-member-seats.test-d.ts`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelNotifyInputSchema,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  wakeMemberSeats,
  workerConfigSchema,
  type ChannelNotifyInput,
  type WorkerManifest
} from "../src/index";
import { hiredSeatManifest, toHiredSeatRow } from "../src/roster/rows";

const USER_ID = "u_wake";

/** One run of a listening seat: which seat, in which conversation, on which post. */
type Heard = { seat: string; conversation: string; body: string };

/**
 * The kinds a test hires into, each recording into its own lists.
 *
 * - `listener` is an app's own kind that declares `onChannelPost`.
 * - `note` declares only a public action.
 * - `picky` declares the entry, but its input asks for a field no post has.
 * - `agent` is the built-in, answering from a scripted model.
 */
function kinds() {
  const heard: Heard[] = [];
  const answer = handler({
    name: "test-answer",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true })
  });
  const listen = handler({
    name: "test-listen",
    inputSchema: channelNotifyInputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (post: ChannelNotifyInput, ctx) => {
      heard.push({ seat: ctx.flow.id, conversation: ctx.session.identity.id, body: post.body });
      return { ok: true };
    }
  });
  const pickyInput = channelNotifyInputSchema.extend({ ticket: z.string() });
  const listener = defineFlow({
    kind: "listener",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { ask: { block: answer } },
    internal: { actions: { onChannelPost: { inputSchema: channelNotifyInputSchema, block: listen } } }
  } as never);
  const note = defineFlow({
    kind: "note",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { ask: { block: answer } }
  } as never);
  const picky = defineFlow({
    kind: "picky",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { ask: { block: answer } },
    internal: {
      actions: {
        onChannelPost: {
          inputSchema: pickyInput,
          block: listen.connectInput((post: z.infer<typeof pickyInput>) => post)
        }
      }
    }
  } as never);
  return {
    heard,
    map: { listener, note, picky, agent: defineAgentWorkerFlow() } as never
  };
}

/** A worker record of one kind (`agent` when `flow` is omitted). */
function worker(id: string, flow?: string): WorkerManifest {
  return { id, declared: flow === undefined ? {} : { flow }, body: "" };
}

/** A seat minted from a stored roster row, as the boot reload does: at `<org>.<seatId>`. */
function reloaded(orgId: string, seatId: string, flow: string, ownerUserId?: string): WorkerManifest {
  const bound = hiredSeatManifest(orgId, toHiredSeatRow({ seatId, flow, ownerUserId }));
  if (!("manifest" in bound)) throw new Error(bound.problem);
  return bound.manifest;
}

/** A fallback that records each member it ran for, and on which post. */
function recordingFallback() {
  const ran: string[] = [];
  const block = handler({
    name: "test-fallback",
    inputSchema: channelNotifyInputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (post: ChannelNotifyInput) => {
      ran.push(`${post.member}|${post.body}`);
      return { ok: true };
    }
  });
  return { ran, block };
}

function host(
  seats: FlowInstance[],
  notify: BlockDefinition<any, any>,
  registered: FlowInstance[] = seats
) {
  const channel = defineChannelFlow({ notify })();
  const state = createFlowState({
    flows: { [CHANNEL_KIND]: channel, ...Object.fromEntries(registered.map((s) => [s.id, s])) },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({
          name: "agent-answer",
          script: [{ when: () => true, then: { text: "the reply" } }]
        })
      },
      policy: "allow"
    })
  });
  return { channel, state };
}

async function bind(stores: StoreRegistry, sessionId: string, members: string[], orgId = DEFAULT_ORG_ID) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER_ID,
      orgId,
      state: { members, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

async function post(
  runtime: FlowStateRuntime,
  channel: FlowInstance,
  sessionId: string,
  body: string,
  options: { author?: string; orgId?: string } = {}
) {
  const result = await runAction({
    orgId: options.orgId ?? DEFAULT_ORG_ID,
    flow: channel,
    actionName: "post",
    input: options.author === undefined ? { body } : { body, author: options.author },
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
}

/** Wait until every fan-out request on the channel has settled, then a beat for any stray run. */
async function settle(runtime: FlowStateRuntime, sessionId: string, posts: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const fanOuts = (await runtime.stores.request.list({ sessionId })).filter((r) => r.actionName === "onPosted");
    if (fanOuts.length >= posts && fanOuts.every((r) => r.status !== "in_progress")) {
      // Dispatched runs settle after the fan-out that started them.
      await until(async () => (await pendingChildRuns(runtime)) === 0, "the woken runs");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the fan-out of ${posts} post(s) on ${sessionId} never settled`);
}

async function pendingChildRuns(runtime: FlowStateRuntime): Promise<number> {
  const children = (await runtime.stores.session.list({ parentage: "all" })).filter((s) => s.parentSessionId != null);
  let pending = 0;
  for (const child of children) {
    const requests = await runtime.stores.request.list({ sessionId: child.id });
    pending += requests.filter((r) => r.status === "in_progress").length;
  }
  return pending;
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** The agent seat's kept user turns, per conversation it holds under `parent`. */
async function agentTurns(runtime: FlowStateRuntime, seat: string, parent: string): Promise<string[][]> {
  const runs = (await runtime.stores.session.list({ flowId: seat, parentage: "all" })).filter(
    (s) => s.parentSessionId === parent
  );
  const out: string[][] = [];
  for (const run of runs) {
    const requests = await runtime.stores.request.list({ sessionId: run.id, withItems: true });
    out.push(
      requests
        .flatMap((r) => (r.items ?? []) as Array<{ type?: string; role?: string; content?: Array<{ text?: string }> }>)
        .filter((item) => item.type === "message" && item.role === "user")
        .map((item) => (item.content ?? []).map((c) => c.text ?? "").join(""))
    );
  }
  return out;
}

/** Each seat's heard posts, grouped. */
function bySeat(heard: Heard[]): Record<string, Heard[]> {
  const out: Record<string, Heard[]> = {};
  for (const h of heard) (out[h.seat] ??= []).push(h);
  return out;
}

describe("wakeMemberSeats · who a post wakes", () => {
  it("runs each declaring member once per post, one conversation per seat, and nobody else (BR-1, BR-2, BR-6, BR-8, BR-9, BR-12)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce(
      [worker("desk.amy"), worker("desk.ivy", "listener"), worker("desk.oz", "listener"), worker("desk.ned", "note"), worker("desk.idle", "listener")],
      { kinds: map }
    );
    const { channel, state } = host(seats, wakeMemberSeats(seats));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.amy", "desk.ivy", "desk.oz", "desk.ned"]);
      await post(runtime, channel, "desk.front", "first");
      await settle(runtime, "desk.front", 1);
      await post(runtime, channel, "desk.front", "second");
      await settle(runtime, "desk.front", 2);

      const seen = bySeat(heard);
      // The app's own kind: each member heard both posts once, in one conversation.
      for (const seat of ["desk.ivy", "desk.oz"]) {
        expect(seen[seat]?.map((h) => h.body).sort(), seat).toEqual(["first", "second"]);
        expect(new Set(seen[seat]!.map((h) => h.conversation)).size, seat).toBe(1);
      }
      expect(seen["desk.ivy"]![0]!.conversation).not.toBe(seen["desk.oz"]![0]!.conversation);
      // A hired seat in no channel, and a kind with no entry, heard nothing.
      expect(Object.keys(seen).sort()).toEqual(["desk.ivy", "desk.oz"]);

      // The built-in agent kind: one conversation of the channel, both posts as turns.
      const turns = await agentTurns(runtime, "desk.amy", "desk.front");
      expect(turns).toHaveLength(1);
      expect(turns[0]!.sort()).toEqual(["u_wake in desk.front: first", "u_wake in desk.front: second"]);
      expect(await agentTurns(runtime, "desk.ned", "desk.front")).toEqual([]);

      // No fallback passed: the fan-out wrote nothing for anyone it did not wake.
      const items = JSON.stringify(await runtime.stores.request.list({ sessionId: "desk.front", withItems: true }));
      expect(items).not.toContain('"type":"message"');
    } finally {
      await state.dispose();
    }
  });

  it("wakes nobody on a post with an author; only members that could not wake get the fallback (BR-3, BR-13)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce(
      [worker("desk.amy"), worker("desk.ivy", "listener"), worker("desk.oz", "listener"), worker("desk.ned", "note")],
      { kinds: map }
    );
    const fallback = recordingFallback();
    const { channel, state } = host(seats, wakeMemberSeats(seats, { fallback: fallback.block }));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.amy", "desk.ivy", "desk.oz", "desk.ned", "desk.gone"]);

      await post(runtime, channel, "desk.front", "from a person");
      await settle(runtime, "desk.front", 1);
      await post(runtime, channel, "desk.front", "from ivy", { author: "desk.ivy" });
      await settle(runtime, "desk.front", 2);

      // The seat's post ran no seat.
      expect(heard.filter((h) => h.body === "from ivy")).toEqual([]);
      expect((await agentTurns(runtime, "desk.amy", "desk.front")).flat().filter((t) => t.includes("from ivy"))).toEqual([]);
      // On both posts the fallback ran for exactly the members that could not
      // wake, and never for one that could: the author withholds, never widens.
      expect(fallback.ran.sort()).toEqual([
        "desk.gone|from a person",
        "desk.gone|from ivy",
        "desk.ned|from a person",
        "desk.ned|from ivy"
      ]);
      // The person's post did wake them.
      expect(heard.filter((h) => h.body === "from a person").map((h) => h.seat).sort()).toEqual(["desk.ivy", "desk.oz"]);
    } finally {
      await state.dispose();
    }
  });

  it("gives a member with no seat the fallback, and everyone the fallback when no seats are passed (BR-4, BR-15)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce([worker("desk.ivy", "listener")], { kinds: map });
    const fallback = recordingFallback();
    const { channel, state } = host([], wakeMemberSeats([], { fallback: fallback.block }), seats);
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.ivy", "desk.gone"]);
      await post(runtime, channel, "desk.front", "anyone?");
      await settle(runtime, "desk.front", 1);

      // desk.ivy is registered and declares the entry, but was not passed.
      expect(heard).toEqual([]);
      expect(fallback.ran.sort()).toEqual(["desk.gone|anyone?", "desk.ivy|anyone?"]);
    } finally {
      await state.dispose();
    }
  });
});

describe("wakeMemberSeats · where a woken seat runs", () => {
  it("wakes a seat the boot reload minted at <org>.<seatId>, by its logical id, in the post's organization (BR-5)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce([reloaded("acme", "desk.rex", "listener"), reloaded("globex", "desk.rex", "listener")], {
      kinds: map
    });
    expect(seats.map((s) => s.id).sort()).toEqual(["acme.desk.rex", "globex.desk.rex"]);
    const { channel, state } = host(seats, wakeMemberSeats(seats));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.rex"], "acme");
      await post(runtime, channel, "desk.front", "for acme", { orgId: "acme" });
      await settle(runtime, "desk.front", 1);

      expect(heard.map((h) => `${h.seat}|${h.body}`)).toEqual(["acme.desk.rex|for acme"]);
    } finally {
      await state.dispose();
    }
  });

  it("wakes the caller's own seat when users of one organization each own a seat of that id (BR-5)", async () => {
    const { heard, map } = kinds();
    // Another user's seat first, so a pick by organization alone takes the wrong one.
    const seats = hireWorkforce(
      [reloaded("acme", "desk.rex", "listener", "u_other"), reloaded("acme", "desk.rex", "listener", USER_ID)],
      { kinds: map }
    );
    const fallback = recordingFallback();
    const { channel, state } = host(seats, wakeMemberSeats(seats, { fallback: fallback.block }));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.rex"], "acme");
      await post(runtime, channel, "desk.front", "for me", { orgId: "acme" });
      await settle(runtime, "desk.front", 1);

      const mine = seats.find((s) => s.ownerPin?.userId === USER_ID)!.id;
      expect(heard.map((h) => `${h.seat}|${h.body}`)).toEqual([`${mine}|for me`]);
      expect(fallback.ran).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("keeps one conversation per channel for a seat in two channels (BR-10)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce([worker("desk.ivy", "listener")], { kinds: map });
    const { channel, state } = host(seats, wakeMemberSeats(seats));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "room.one", ["desk.ivy"]);
      await bind(runtime.stores, "room.two", ["desk.ivy"]);
      await post(runtime, channel, "room.one", "in one");
      await settle(runtime, "room.one", 1);
      await post(runtime, channel, "room.two", "in two");
      await settle(runtime, "room.two", 1);
      await post(runtime, channel, "room.one", "in one again");
      await settle(runtime, "room.one", 2);

      const conv = (body: string) => heard.find((h) => h.body === body)!.conversation;
      expect(conv("in one")).toBe(conv("in one again"));
      expect(conv("in two")).not.toBe(conv("in one"));
    } finally {
      await state.dispose();
    }
  });

  it("fails one member's delivery when its entry refuses the post, and still runs the others (BR-7)", async () => {
    const { heard, map } = kinds();
    const seats = hireWorkforce([worker("desk.pip", "picky"), worker("desk.ivy", "listener")], { kinds: map });
    const { channel, state } = host(seats, wakeMemberSeats(seats));
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "desk.front", ["desk.pip", "desk.ivy"]);
      await post(runtime, channel, "desk.front", "hello");
      await settle(runtime, "desk.front", 1);

      expect(heard.map((h) => h.seat)).toEqual(["desk.ivy"]);
      // The refusal is recorded on desk.pip's own run, not thrown out of the post.
      const [pipRun] = (await runtime.stores.session.list({ flowId: "desk.pip", parentage: "all" })).filter(
        (s) => s.parentSessionId === "desk.front"
      );
      const pipRequests = await runtime.stores.request.list({ sessionId: pipRun!.id });
      expect(pipRequests.map((r) => r.status)).toEqual(["failed"]);
    } finally {
      await state.dispose();
    }
  });
});
