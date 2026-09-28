/**
 * `routeByPurpose` in a real in-process host: which member a person's post to a
 * routed channel reaches, and what the route records.
 *
 * The members are seats of a listening kind that records each delivery it
 * hears (whether it was routed, and the lines it carried), so what is graded
 * is who ran, never a router's decision. The route's evaluation is scripted by
 * block name (`channel-route`) and answers from the state it is handed: a post
 * carrying `[route:<member>]` picks that member, `[route:off-list]` picks a
 * member that is not an option, and anything else fails the call.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1610/BUSINESS-RULES.md`, V2):
 *   BR-2  one evaluator call, over the recent lines and the post, choosing among
 *         the members whose seat hears posts, each described verbatim; its pick
 *         runs alone;
 *   BR-1  the person's next post, with no line from that member since, is held:
 *         the same member, no call;
 *   BR-4  a post after a held one is not held, and neither is one whose last
 *         post's route is not recorded yet, as for a post that failed after
 *         its line was kept, which the route reads as the channel shows it;
 *   BR-5  a follow-up after the member's line takes the call, with that line in it;
 *   BR-3  a failed call, or a pick outside the options, runs the fallback alone;
 *         a fan-out cancelled before the ledger takes its route runs nobody
 *         and makes no later write; once the ledger has it, the member runs;
 *   BR-6  a fallback the caller cannot reach, or that is not a member of the open
 *         channel, runs nobody, recorded as failed;
 *   BR-7  nobody else receives a routed post;
 *   BR-8  a post with an `author` takes no route and no call;
 *   BR-18 a channel without `routing:` on a routed kind wakes every member;
 *   BR-19 `routing:` added to an open channel's file routes it from the next
 *         boot, its lines kept;
 *   BR-20 the model string resolves through the app's resolver;
 *   BR-21 a model that cannot evaluate sends every post to the fallback;
 *   BR-29 every route is one `channel-route` item, never a line;
 *   and an error after the route (the member's own run failing) is not a fallback.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver, mockEvaluationModel, type MockEvaluationModel } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  channelInstances,
  channelNotifyInputSchema,
  defineChannelFlow,
  routeByPurpose,
  wakeMemberSeats,
  workerConfigSchema,
  type ChannelManifest,
  type ChannelNotifyInput,
  type WorkerManifest
} from "../src/index";
import { hireWorkforce } from "../src/hire";
import { failLineWrite, postedLines } from "./channel-post-lines";

const USER_ID = "u_route";
const HELP = "support.help";
const LOUNGE = "support.lounge";

const DESCRIPTIONS: Record<string, string> = {
  "support.devices": "Printers, laptops, phones and wifi.",
  "support.accounts": "Passwords, sign-in and billing.",
  "support.general": "Anything that fits no one else."
};
const MEMBERS = [...Object.keys(DESCRIPTIONS), "support.notes"];

/** One delivery a member's seat heard. */
type Heard = { seat: string; body: string; routed?: boolean; recent?: string[] };

/** A listening kind that records each delivery; `failOn` makes one member's run throw. */
function listeningKinds(failOn?: string) {
  const heard: Heard[] = [];
  const listen = handler({
    name: "test-listen",
    inputSchema: channelNotifyInputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (post: ChannelNotifyInput) => {
      heard.push({
        seat: post.member,
        body: post.body,
        ...(post.routed === undefined ? {} : { routed: post.routed }),
        ...(post.recent === undefined ? {} : { recent: post.recent.map((line) => line.body) })
      });
      if (post.member === failOn) throw new Error(`${post.member} could not answer`);
      return { ok: true };
    }
  });
  const answer = handler({ name: "test-answer", execute: () => ({}) });
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
  return { heard, kinds: { listener, note } as never };
}

function workers(pinGeneralTo?: string, undescribed?: string): WorkerManifest[] {
  return [
    ...Object.entries(DESCRIPTIONS).map(([id, description]) => ({
      id,
      declared: { flow: "listener", description },
      body: "",
      ...(id === "support.general" && pinGeneralTo !== undefined ? { ownerPin: { orgId: pinGeneralTo } } : {})
    })),
    { id: "support.notes", declared: { flow: "note", description: "Takes notes." }, body: "" },
    // A seat that hears posts and has no description, as a runtime hire reloads.
    ...(undescribed === undefined ? [] : [{ id: undescribed, declared: { flow: "listener" }, body: "" }])
  ];
}

/**
 * The scripted route evaluation: `[route:<member>]` picks that member,
 * `[route:off-list]` picks one that is not an option, anything else fails.
 */
function scriptedRoute(): MockEvaluationModel {
  return mockEvaluationModel({
    answers: ({ state }) => {
      const text = (state as { post: { text: string } }).post.text;
      const picked = /\[route:([a-z.-]+)\]/.exec(text)?.[1];
      if (picked === undefined) throw new Error("the scripted route has no answer for this post");
      return { member: { type: "choice", choice: picked === "off-list" ? "support.sales" : picked } };
    }
  });
}

function manifests(helpMembers = MEMBERS): ChannelManifest[] {
  return [
    { id: HELP, declared: { members: helpMembers, routing: { fallback: "support.general" } }, body: "Ask support." },
    { id: LOUNGE, declared: { members: MEMBERS }, body: "Chat." }
  ];
}

/** A routed host: the tree's seats, the wake, the route, and one scripted resolver. */
function host(
  options: {
    failOn?: string;
    pinGeneralTo?: string;
    undescribed?: string;
    resolver?: (route: MockEvaluationModel) => ModelResolver;
    stores?: ReturnType<typeof inMemoryStores>;
    channels?: ChannelManifest[];
    /** Build the channel kind with no route at all, as a tree where no channel routes does. */
    withoutRoute?: boolean;
  } = {}
) {
  const { heard, kinds } = listeningKinds(options.failOn);
  const seats = hireWorkforce(workers(options.pinGeneralTo, options.undescribed), { kinds });
  const route = scriptedRoute();
  const [channel] = channelInstances(options.channels ?? manifests(), {
    kinds: {
      channel: defineChannelFlow({
        notify: wakeMemberSeats(seats),
        ...(options.withoutRoute ? {} : { route: routeByPurpose(seats, { model: "typesafe-ai/jev" }) })
      }) as never
    }
  });
  const state = createFlowState({
    flows: { [channel!.id]: channel!, ...Object.fromEntries(seats.map((seat) => [seat.id, seat])) },
    stores: { default: { primary: options.stores ?? inMemoryStores() } },
    modelResolver: options.resolver?.(route) ?? createMockModelResolver({ evaluators: { "channel-route": route } })
  });
  return { channel: channel!, state, heard, route, seats };
}

async function bind(stores: StoreRegistry, sessionId: string, members: string[], orgId = DEFAULT_ORG_ID) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: "channel",
      flowId: "channel",
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

async function post(runtime: FlowStateRuntime, channel: FlowInstance, sessionId: string, body: string, author?: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: channel,
    actionName: "post",
    input: author === undefined ? { body } : { body, author },
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
}

/** One `read` of the channel: ordinary traffic, one request on its session. */
async function readChannel(runtime: FlowStateRuntime, channel: FlowInstance, sessionId: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: channel,
    actionName: "read",
    input: {},
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
  return result.output as { transcript: Array<{ body: string }> };
}

/** Wait until `posts` fan-outs on the channel have settled, and every woken run with them. */
async function settle(runtime: FlowStateRuntime, sessionId: string, posts: number): Promise<void> {
  await until(async () => {
    const fanOuts = (await runtime.stores.request.list({ sessionId })).filter((r) => r.actionName === "onPosted");
    return fanOuts.length >= posts && fanOuts.every((r) => r.status !== "in_progress");
  }, `the fan-out of ${posts} post(s) on ${sessionId}`);
  await until(async () => (await pendingChildRuns(runtime)) === 0, "the woken runs");
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

/** Cancel the channel's fan-out through the abort route, as a person stopping it would. */
async function cancelFanOut(state: ReturnType<typeof host>["state"], runtime: FlowStateRuntime, channel: FlowInstance) {
  const [fanOut] = (await runtime.stores.request.list({ sessionId: HELP })).filter(
    (r) => r.actionName === "onPosted" && r.status === "in_progress"
  );
  const router = await state.getRouter();
  const cancel = await router.POST(
    new Request(`http://localhost/api/flows/${channel.id}/requests/${fanOut!.id}/abort`, { method: "POST" }),
    { params: { path: [channel.id, "requests", fanOut!.id, "abort"] } }
  );
  expect(cancel.status).toBe(204);
}

/** `model`, answering only once `before` settles and whatever its abort signal says: an answer already on its way. */
function answeringAfter(model: MockEvaluationModel, before: () => Promise<void>): MockEvaluationModel {
  const evaluate = model.doEvaluate.bind(model);
  return {
    ...model,
    doEvaluate: async (...args: Parameters<typeof evaluate>) => {
      await before();
      return evaluate(...args);
    }
  };
}

/**
 * Run `before` once, while a write is under way on the host's stores: a
 * fan-out's start (`start`), the first `channel-route` record's event
 * (`record`), or the first ledger write that notes a route (`ledger`).
 */
function holdWrite(stores: StoreRegistry, at: "start" | "record" | "ledger", before: () => Promise<void>) {
  let armed = true;
  if (at !== "ledger") {
    const persistEvents = stores.request.persistEvents.bind(stores.request);
    const flushEvents = stores.request.flushEvents.bind(stores.request);
    const writing = new Set<string>();
    stores.request.persistEvents = (requestId, events) => {
      const isHeld = (event: (typeof events)[number]) =>
        at === "start"
          ? event.type === "request.in_progress"
          : event.type === "item.added" && (event.item as { component?: string }).component === "channel-route";
      if (events.some(isHeld)) writing.add(requestId);
      persistEvents(requestId, events);
    };
    stores.request.flushEvents = async (requestId) => {
      if (armed && writing.delete(requestId) && (await stores.request.get(requestId))?.actionName === "onPosted") {
        armed = false;
        await before();
      }
      return flushEvents(requestId);
    };
    return;
  }
  const set = stores.session.set.bind(stores.session);
  stores.session.set = async (...args: Parameters<typeof set>) => {
    const ledger = (args[1].state as { channelRouteLedger?: { lastPost?: { by?: string } } } | undefined)?.channelRouteLedger;
    if (armed && ledger?.lastPost?.by !== undefined) {
      armed = false;
      await before();
    }
    return set(...args);
  };
}

/** Every `channel-route` record on the channel, oldest first. */
async function routeRecords(stores: StoreRegistry, sessionId: string) {
  const requests = await stores.request.list({ sessionId, withItems: true, orderBy: "startedAtMs" });
  return [...requests]
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .flatMap((request) => request.items ?? [])
    .filter((item) => item.type === "component" && (item as { component?: string }).component === "channel-route")
    .map((item) => (item as unknown as { data: { postId: string; by: string; member?: string; reason?: string } }).data);
}

/** The route record of the post whose body contains `marker`. */
async function recordFor(stores: StoreRegistry, marker: string) {
  const line = (await postedLines(stores, HELP)).find((l) => l.body.includes(marker));
  return (await routeRecords(stores, HELP)).find((record) => record.postId === line?.id);
}

/** Who heard the post whose body contains `marker`. */
const who = (heard: Heard[], marker: string) => heard.filter((h) => h.body.includes(marker)).map((h) => h.seat).sort();

/** The evaluator calls made for the post whose body contains `marker`. */
const callsFor = (route: MockEvaluationModel, marker: string) =>
  route.calls.filter((call) => (call.state as { post: { text: string } }).post.text.includes(marker));

describe("a person's post to a routed channel", () => {
  it("runs the one member the evaluator picks, from the members that hear posts, described verbatim (BR-2, BR-7)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);

      expect(who(heard, "laptop")).toEqual(["support.devices"]);
      expect(heard.find((h) => h.body.includes("laptop"))?.routed).toBe(true);
      const calls = callsFor(route, "laptop");
      expect(calls).toHaveLength(1);
      // The options: the members with a seat that hears posts, each by its description.
      const question = (calls[0]!.questions as { member: { criteria: Record<string, string | null> } }).member;
      expect(question.criteria).toEqual(DESCRIPTIONS);
      expect(await recordFor(runtime.stores, "laptop")).toMatchObject({ by: "evaluated", member: "support.devices" });
    } finally {
      await state.dispose();
    }
  });

  it("offers the evaluator only members it can describe; one with no description still takes the fallback and holds (BR-2)", async () => {
    const members = [...MEMBERS, "support.untold"];
    const { channel, state, heard, route } = host({
      undescribed: "support.untold",
      channels: [{ id: HELP, declared: { members, routing: { fallback: "support.untold" } }, body: "Ask support." }]
    });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, members);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      // A purpose is what the evaluator picks by: a seat with none is not a choice.
      const question = (callsFor(route, "laptop")[0]!.questions as { member: { criteria: Record<string, string | null> } })
        .member;
      expect(question.criteria).toEqual(DESCRIPTIONS);

      await post(runtime, channel, HELP, "Try forgetting the network.", "support.devices");
      await settle(runtime, HELP, 2);
      await post(runtime, channel, HELP, "who do I ask about a parking pass?");
      await settle(runtime, HELP, 3);
      expect(who(heard, "parking pass")).toEqual(["support.untold"]);
      expect(await recordFor(runtime.stores, "parking pass")).toMatchObject({ by: "fallback", member: "support.untold" });

      // Still on that post, with no line since: the next one is held for it.
      await post(runtime, channel, HELP, "and the gym?");
      await settle(runtime, HELP, 4);
      expect(who(heard, "the gym")).toEqual(["support.untold"]);
      expect(callsFor(route, "the gym")).toHaveLength(0);
      expect(await recordFor(runtime.stores, "the gym")).toMatchObject({ by: "held", member: "support.untold" });
    } finally {
      await state.dispose();
    }
  });

  it("holds the person's next post for the member still on the last one, with no call (BR-1)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      // Marked for accounts, and still held: the member on the case keeps it.
      await post(runtime, channel, HELP, "[route:support.accounts] and it says wrong password");
      await settle(runtime, HELP, 2);

      expect(who(heard, "wrong password")).toEqual(["support.devices"]);
      expect(callsFor(route, "wrong password")).toHaveLength(0);
      expect(await recordFor(runtime.stores, "wrong password")).toMatchObject({ by: "held", member: "support.devices" });
    } finally {
      await state.dispose();
    }
  });

  it("does not hold after a held post, nor after the member's line; the call then sees that line (BR-4, BR-5)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      await post(runtime, channel, HELP, "it is a new laptop");
      await settle(runtime, HELP, 2);
      // The last post was held, so this one takes the call.
      await post(runtime, channel, HELP, "[route:support.accounts] different thing: I was charged twice");
      await settle(runtime, HELP, 3);
      expect(who(heard, "charged twice")).toEqual(["support.accounts"]);
      expect(callsFor(route, "charged twice")).toHaveLength(1);

      // accounts answers in the channel; the follow-up takes the call, with that line in view.
      await post(runtime, channel, HELP, "Which card was charged?", "support.accounts");
      await settle(runtime, HELP, 4);
      await post(runtime, channel, HELP, "[route:support.accounts] the visa one");
      await settle(runtime, HELP, 5);
      const followUp = callsFor(route, "the visa one");
      expect(followUp).toHaveLength(1);
      const recent = (followUp[0]!.state as { recent: Array<{ from: string; text: string }> }).recent;
      expect(recent.at(-1)).toEqual({ from: "support.accounts", text: "Which card was charged?" });
      expect(who(heard, "the visa one")).toEqual(["support.accounts"]);
      expect(await recordFor(runtime.stores, "the visa one")).toMatchObject({ by: "evaluated" });
    } finally {
      await state.dispose();
    }
  });

  it("hands the routed member the lines before the post, and the call the same lines (BR-24)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      await post(runtime, channel, HELP, "Does it see the network?", "support.devices");
      await settle(runtime, HELP, 2);
      await post(runtime, channel, HELP, "[route:support.general] where can I buy it?");
      await settle(runtime, HELP, 3);

      const delivered = heard.find((h) => h.body.includes("buy it"))!;
      expect(delivered.seat).toBe("support.general");
      expect(delivered.recent).toEqual([
        "[route:support.devices] my laptop won't join the wifi",
        "Does it see the network?"
      ]);
      const read = (callsFor(route, "buy it")[0]!.state as { recent: Array<{ text: string }> }).recent;
      expect(read.map((line) => line.text)).toEqual(delivered.recent);
    } finally {
      await state.dispose();
    }
  });

  // A channel's session loads only its last 50 requests' items, and every read,
  // post and fan-out is one of them. The route reads what it needs past that.
  it("holds the person's next post after more reads of the channel than its history window holds (BR-1)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      for (let i = 0; i < 60; i += 1) await readChannel(runtime, channel, HELP);
      await post(runtime, channel, HELP, "[route:support.accounts] and it says wrong password");
      await settle(runtime, HELP, 2);

      expect(who(heard, "wrong password")).toEqual(["support.devices"]);
      expect(callsFor(route, "wrong password")).toHaveLength(0);
      expect(await recordFor(runtime.stores, "wrong password")).toMatchObject({ by: "held", member: "support.devices" });
    } finally {
      await state.dispose();
    }
  });

  // The ledger holds what the channel shows. A post whose line's event write
  // failed still leaves its line: the failed request's record keeps every item
  // it emitted. So the route reads that line, and the post is the person's
  // last one, with no route recorded, which holds nothing.
  it("reads a post whose line's event write failed as the channel shows it: a recent line, holding nothing (BR-4, BR-24)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      failLineWrite(runtime.stores, "a failed post");
      const failed = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: channel,
        actionName: "post",
        input: { body: "[route:support.general] a failed post" },
        userId: USER_ID,
        sessionId: HELP,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(failed.error).toBeDefined();
      expect((await postedLines(runtime.stores, HELP)).map((line) => line.body)).toContain(
        "[route:support.general] a failed post"
      );
      await post(runtime, channel, HELP, "[route:support.accounts] and it says wrong password");
      await settle(runtime, HELP, 2);

      expect(who(heard, "wrong password")).toEqual(["support.accounts"]);
      expect(callsFor(route, "wrong password")).toHaveLength(1);
      expect(heard.find((h) => h.body.includes("wrong password"))?.recent).toEqual([
        "[route:support.devices] my laptop won't join the wifi",
        "[route:support.general] a failed post"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("hands the member and the call the 20 lines before the post, however many requests came between (BR-24)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      const notes = Array.from({ length: 21 }, (_, i) => `note ${i + 1}`);
      for (const [i, note] of notes.entries()) {
        await post(runtime, channel, HELP, note, "support.notes");
        await settle(runtime, HELP, i + 1);
      }
      for (let i = 0; i < 60; i += 1) await readChannel(runtime, channel, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, notes.length + 1);

      const delivered = heard.find((h) => h.body.includes("laptop"))!;
      expect(delivered.recent).toEqual(notes.slice(-20));
      const read = (callsFor(route, "laptop")[0]!.state as { recent: Array<{ text: string }> }).recent;
      expect(read.map((line) => line.text)).toEqual(notes.slice(-20));
    } finally {
      await state.dispose();
    }
  });

  it("does not hold a post whose last post's route is not recorded yet: both take the call (BR-4)", async () => {
    let release = (): void => {};
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstStarted = false;
    const { channel, state, heard, route } = host({
      // The first post's evaluation waits until the second post's route has run.
      resolver: (scripted) =>
        createMockModelResolver({
          evaluators: {
            "channel-route": {
              ...scripted,
              doEvaluate: async (call: Parameters<MockEvaluationModel["doEvaluate"]>[0]) => {
                if ((call.state as { post: { text: string } }).post.text.includes("first")) {
                  firstStarted = true;
                  await opened;
                }
                return scripted.doEvaluate(call);
              }
            } as never
          }
        })
    });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] first");
      // The first post's route is under way, and has recorded nothing yet.
      await until(async () => firstStarted, "the first post's call");
      expect(await routeRecords(runtime.stores, HELP)).toEqual([]);
      await post(runtime, channel, HELP, "[route:support.accounts] second");
      await until(async () => callsFor(route, "second").length === 1, "the second post's call");
      release();
      await settle(runtime, HELP, 2);

      expect(who(heard, "first")).toEqual(["support.devices"]);
      expect(who(heard, "second")).toEqual(["support.accounts"]);
      expect(await recordFor(runtime.stores, "second")).toMatchObject({ by: "evaluated", member: "support.accounts" });
    } finally {
      release();
      await state.dispose();
    }
  });

  it("runs the fallback alone when the call fails or picks outside the options, and says why (BR-3)", async () => {
    const { channel, state, heard } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "who do I ask about a parking pass?");
      await settle(runtime, HELP, 1);
      await post(runtime, channel, HELP, "Parking is at reception.", "support.general");
      await settle(runtime, HELP, 2);
      await post(runtime, channel, HELP, "[route:off-list] and the gym?");
      await settle(runtime, HELP, 3);

      expect(who(heard, "parking pass")).toEqual(["support.general"]);
      expect(await recordFor(runtime.stores, "parking pass")).toMatchObject({
        by: "fallback",
        member: "support.general",
        reason: expect.stringMatching(/the scripted route has no answer/)
      });
      expect(who(heard, "the gym")).toEqual(["support.general"]);
      expect(await recordFor(runtime.stores, "the gym")).toMatchObject({ by: "fallback", member: "support.general" });
      // The post itself landed both times.
      expect((await postedLines(runtime.stores, HELP)).map((l) => l.body)).toContain("[route:off-list] and the gym?");
    } finally {
      await state.dispose();
    }
  });

  // A cancel is not a failed call: the fallback is for a call that failed, and
  // a cancelled fan-out places the post with nobody and records nothing.
  it("places nothing when the fan-out is cancelled during the call: no record, no ledger entry, no fallback, ended aborted (BR-3)", async () => {
    const pending = mockEvaluationModel({ hold: true });
    const { channel, state, heard } = host({
      resolver: () => createMockModelResolver({ evaluators: { "channel-route": pending } })
    });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await until(async () => pending.calls.length === 1, "the route's call");
      const [fanOut] = (await runtime.stores.request.list({ sessionId: HELP })).filter((r) => r.actionName === "onPosted");
      const router = await state.getRouter();
      const cancel = await router.POST(
        new Request(`http://localhost/api/flows/${channel.id}/requests/${fanOut!.id}/abort`, { method: "POST" }),
        { params: { path: [channel.id, "requests", fanOut!.id, "abort"] } }
      );
      expect(cancel.status).toBe(204);
      await settle(runtime, HELP, 1);

      expect(pending.calls[0]!.abortSignal?.aborted).toBe(true);
      expect((await runtime.stores.request.get(fanOut!.id))?.status).toBe("aborted");
      expect(await routeRecords(runtime.stores, HELP)).toEqual([]);
      expect(heard).toEqual([]);
      // The ledger still has the post as kept, with no route noted against it.
      const [line] = await postedLines(runtime.stores, HELP);
      const session = await runtime.stores.session.get(HELP);
      expect((session?.state as { channelRouteLedger: { lastPost: unknown } }).channelRouteLedger.lastPost).toEqual({
        postId: line!.id,
        spoke: []
      });
    } finally {
      await state.dispose();
    }
  });

  // The ledger write is the route's commit point. A cancel seen before it,
  // even after the call answered, stops the route: no later write, nobody
  // woken, and a record already under way is kept. Once the ledger has the
  // route, the cancel is too late: the member is woken, as the ledger says.
  it.each([
    { at: "answer", when: "as the call answers", outcome: "wakes nobody", records: 0, noted: false, woken: [] },
    { at: "record", when: "while the route's record is written", outcome: "wakes nobody", records: 1, noted: false, woken: [] },
    {
      at: "ledger",
      when: "while the ledger takes the route",
      outcome: "still wakes the member",
      records: 1,
      noted: true,
      woken: ["support.devices"]
    }
  ] as const)(
    "$outcome when the fan-out is cancelled $when (BR-3)",
    async ({ at, records, noted, woken }) => {
      let cancel = async (): Promise<void> => {};
      const { channel, state, heard } = host(
        at === "answer"
          ? {
              resolver: (route) =>
                createMockModelResolver({ evaluators: { "channel-route": answeringAfter(route, () => cancel()) } })
            }
          : {}
      );
      try {
        const runtime = await state.getRuntime();
        cancel = () => cancelFanOut(state, runtime, channel);
        if (at !== "answer") holdWrite(runtime.stores, at, () => cancel());
        await bind(runtime.stores, HELP, MEMBERS);
        await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
        await settle(runtime, HELP, 1);

        const [fanOut] = (await runtime.stores.request.list({ sessionId: HELP })).filter((r) => r.actionName === "onPosted");
        expect(fanOut!.status).toBe("aborted");
        expect(heard.map((h) => h.seat)).toEqual(woken);
        expect(await routeRecords(runtime.stores, HELP)).toHaveLength(records);
        const [line] = await postedLines(runtime.stores, HELP);
        const session = await runtime.stores.session.get(HELP);
        expect((session?.state as { channelRouteLedger: { lastPost: unknown } }).channelRouteLedger.lastPost).toEqual({
          postId: line!.id,
          spoke: [],
          ...(noted ? { by: "evaluated", member: "support.devices" } : {})
        });
      } finally {
        await state.dispose();
      }
    }
  );

  it("records nothing and wakes nobody for a held post whose fan-out was cancelled before it routed (BR-1, BR-3)", async () => {
    const { channel, state, heard } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);
      // The next post is held for support.devices, with no call: the route
      // goes straight to its record. The cancel lands as its fan-out starts.
      holdWrite(runtime.stores, "start", () => cancelFanOut(state, runtime, channel));
      await post(runtime, channel, HELP, "it still drops the connection");
      await settle(runtime, HELP, 2);

      const fanOuts = (await runtime.stores.request.list({ sessionId: HELP })).filter((r) => r.actionName === "onPosted");
      expect(fanOuts.map((r) => r.status).sort()).toEqual(["aborted", "completed"]);
      expect(who(heard, "drops")).toEqual([]);
      expect(await recordFor(runtime.stores, "drops")).toBeUndefined();
      const lines = await postedLines(runtime.stores, HELP);
      const session = await runtime.stores.session.get(HELP);
      expect((session?.state as { channelRouteLedger: { lastPost: unknown } }).channelRouteLedger.lastPost).toEqual({
        postId: lines[1]!.id,
        spoke: []
      });
    } finally {
      await state.dispose();
    }
  });

  it("runs nobody when the caller cannot reach the fallback's seat, recorded as failed (BR-6)", async () => {
    const { channel, state, heard } = host({ pinGeneralTo: "globex" });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "who do I ask about a parking pass?");
      await settle(runtime, HELP, 1);

      expect(who(heard, "parking pass")).toEqual([]);
      const record = await recordFor(runtime.stores, "parking pass");
      expect(record).toMatchObject({ by: "failed" });
      expect(record?.member).toBeUndefined();
      expect(record?.reason).toMatch(/the fallback "support\.general" has no seat this caller can reach/);
    } finally {
      await state.dispose();
    }
  });

  it("runs nobody when the fallback is not a member of the channel as opened (BR-6)", async () => {
    const { channel, state, heard } = host();
    try {
      const runtime = await state.getRuntime();
      // Opened before the file named the fallback a member: the open channel's roster is older.
      await bind(runtime.stores, HELP, ["support.devices", "support.accounts"]);
      await post(runtime, channel, HELP, "who do I ask about a parking pass?");
      await settle(runtime, HELP, 1);

      expect(who(heard, "parking pass")).toEqual([]);
      expect(await recordFor(runtime.stores, "parking pass")).toMatchObject({ by: "failed" });
    } finally {
      await state.dispose();
    }
  });

  it("does not re-route when the routed member's own run fails", async () => {
    const { channel, state, heard } = host({ failOn: "support.devices" });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);

      expect(who(heard, "laptop")).toEqual(["support.devices"]);
      expect(await recordFor(runtime.stores, "laptop")).toMatchObject({ by: "evaluated", member: "support.devices" });
    } finally {
      await state.dispose();
    }
  });

  it("sends every post to the fallback, recorded, when the model cannot evaluate (BR-21)", async () => {
    // No `resolveEvaluationModel` at all: the model string cannot become an evaluation model.
    const { channel, state, heard } = host({ resolver: () => createMockModelResolver({}) });
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);

      expect(who(heard, "laptop")).toEqual(["support.general"]);
      expect(await recordFor(runtime.stores, "laptop")).toMatchObject({
        by: "fallback",
        reason: expect.stringMatching(/resolveEvaluationModel/)
      });
    } finally {
      await state.dispose();
    }
  });

  it("keeps each route out of the channel's lines: one channel-route item per post (BR-29)", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] my laptop won't join the wifi");
      await settle(runtime, HELP, 1);

      expect(await routeRecords(runtime.stores, HELP)).toHaveLength(1);
      expect((await postedLines(runtime.stores, HELP)).map((l) => l.body)).toEqual([
        "[route:support.devices] my laptop won't join the wifi"
      ]);
      const read = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: channel,
        actionName: "read",
        input: {},
        userId: USER_ID,
        sessionId: HELP,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect((read.output as { transcript: unknown[] }).transcript).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("posts the route does not place", () => {
  it("takes no route and no call for a post a seat wrote, and wakes nobody (BR-8)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, channel, HELP, "[route:support.devices] I looked; it is fine.", "support.accounts");
      await settle(runtime, HELP, 1);

      expect(heard).toEqual([]);
      expect(route.calls).toHaveLength(0);
      expect(await routeRecords(runtime.stores, HELP)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("wakes every member that hears posts in a channel without routing:, on a routed kind (BR-18)", async () => {
    const { channel, state, heard, route } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, LOUNGE, MEMBERS);
      await post(runtime, channel, LOUNGE, "[route:support.devices] lunch?");
      await settle(runtime, LOUNGE, 1);

      expect(who(heard, "lunch")).toEqual(["support.accounts", "support.devices", "support.general"]);
      expect(heard.every((h) => h.routed === undefined && h.recent === undefined)).toBe(true);
      expect(route.calls).toHaveLength(0);
      expect(await routeRecords(runtime.stores, LOUNGE)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("routes an open channel from the boot after its file gains routing:, its lines kept (BR-19)", async () => {
    const stores = inMemoryStores();
    const unrouted = manifests().map((m) => (m.id === HELP ? { ...m, declared: { members: MEMBERS } } : m));
    const first = host({ stores, channels: unrouted });
    try {
      const runtime = await first.state.getRuntime();
      await bind(runtime.stores, HELP, MEMBERS);
      await post(runtime, first.channel, HELP, "[route:support.devices] before routing");
      await settle(runtime, HELP, 1);
      expect(who(first.heard, "before routing")).toEqual(["support.accounts", "support.devices", "support.general"]);
    } finally {
      await first.state.dispose();
    }

    const second = host({ stores });
    try {
      const runtime = await second.state.getRuntime();
      await post(runtime, second.channel, HELP, "[route:support.devices] after routing");
      await settle(runtime, HELP, 2);
      expect(who(second.heard, "after routing")).toEqual(["support.devices"]);
      expect((await postedLines(runtime.stores, HELP)).map((l) => l.body)).toEqual([
        "[route:support.devices] before routing",
        "[route:support.devices] after routing"
      ]);
      // Never written into the channel's session: the routing is the kind's, from the file.
      // The session keeps the route's ledger of lines, which names no fallback.
      const record = await runtime.stores.session.get(HELP);
      expect(Object.keys(record?.state ?? {}).sort()).toEqual([
        "channelRouteLedger",
        "instructions",
        "members",
        "transcript"
      ]);
      expect(Object.keys((record?.state as { channelRouteLedger: object }).channelRouteLedger).sort()).toEqual([
        "lastPost",
        "lines"
      ]);
    } finally {
      await second.state.dispose();
    }
  });

  // Posts made while routing is off never reach the route's ledger, so the
  // ledger left from before must not decide the first routed post after.
  it.each([
    ["its file drops routing:, on a kind that still routes others", false],
    ["its kind is built without a route", true]
  ])(
    "reads the lines posted while routing was off, and holds nothing from before, once routing is back: %s (BR-19, BR-24)",
    async (_case, withoutRoute) => {
      const stores = inMemoryStores();
      const unrouted = manifests().map((m) => (m.id === HELP ? { ...m, declared: { members: MEMBERS } } : m));
      const first = host({ stores });
      try {
        const runtime = await first.state.getRuntime();
        await bind(runtime.stores, HELP, MEMBERS);
        // Routed to devices, which never answers in the channel.
        await post(runtime, first.channel, HELP, "[route:support.devices] my laptop won't join the wifi");
        await settle(runtime, HELP, 1);
      } finally {
        await first.state.dispose();
      }

      const second = host({ stores, channels: unrouted, withoutRoute });
      try {
        const runtime = await second.state.getRuntime();
        await post(runtime, second.channel, HELP, "[route:support.accounts] different thing: I was charged twice");
        await settle(runtime, HELP, 2);
        expect(who(second.heard, "charged twice")).toEqual(["support.accounts", "support.devices", "support.general"]);
      } finally {
        await second.state.dispose();
      }

      const third = host({ stores });
      try {
        const runtime = await third.state.getRuntime();
        await post(runtime, third.channel, HELP, "[route:support.accounts] which card was it?");
        await settle(runtime, HELP, 3);

        // The person's last post was not routed, so nothing holds this one: it takes the call.
        expect(callsFor(third.route, "which card")).toHaveLength(1);
        expect(who(third.heard, "which card")).toEqual(["support.accounts"]);
        expect(await recordFor(runtime.stores, "which card")).toMatchObject({ by: "evaluated", member: "support.accounts" });
        // The call and the member both see the line posted while routing was off.
        const lines = [
          "[route:support.devices] my laptop won't join the wifi",
          "[route:support.accounts] different thing: I was charged twice"
        ];
        expect(third.heard.find((h) => h.body.includes("which card"))?.recent).toEqual(lines);
        const read = (callsFor(third.route, "which card")[0]!.state as { recent: Array<{ text: string }> }).recent;
        expect(read.map((line) => line.text)).toEqual(lines);
      } finally {
        await third.state.dispose();
      }
    }
  );

  // The same, with the post made while routing was off pushed out of the
  // history window by reads before routing is back: nothing in that window
  // can tell the route what happened while it was off.
  it.each([
    // A kind that still routes other channels keeps every line, so the route
    // sees the off post however far back it is.
    ["its file drops routing:, on a kind that still routes others", false, [
      "[route:support.devices] my laptop won't join the wifi",
      "[route:support.accounts] different thing: I was charged twice"
    ]],
    // A kind without a route keeps nothing, so the next routed post starts
    // from the lines still in the window, which the reads have filled.
    ["its kind is built without a route", true, []]
  ])(
    "holds nothing from before routing was off, after more requests than the history window holds: %s (BR-1, BR-19, BR-24)",
    async (_case, withoutRoute, recent) => {
      const stores = inMemoryStores();
      const unrouted = manifests().map((m) => (m.id === HELP ? { ...m, declared: { members: MEMBERS } } : m));
      const first = host({ stores });
      try {
        const runtime = await first.state.getRuntime();
        await bind(runtime.stores, HELP, MEMBERS);
        // Routed to devices, which never answers in the channel.
        await post(runtime, first.channel, HELP, "[route:support.devices] my laptop won't join the wifi");
        await settle(runtime, HELP, 1);
      } finally {
        await first.state.dispose();
      }

      const second = host({ stores, channels: unrouted, withoutRoute });
      try {
        const runtime = await second.state.getRuntime();
        await post(runtime, second.channel, HELP, "[route:support.accounts] different thing: I was charged twice");
        await settle(runtime, HELP, 2);
        for (let i = 0; i < 60; i += 1) await readChannel(runtime, second.channel, HELP);
      } finally {
        await second.state.dispose();
      }

      const third = host({ stores });
      try {
        const runtime = await third.state.getRuntime();
        await post(runtime, third.channel, HELP, "[route:support.accounts] which card was it?");
        await settle(runtime, HELP, 3);

        // The person's last post was not routed, so nothing holds this one: it takes the call.
        expect(callsFor(third.route, "which card")).toHaveLength(1);
        expect(who(third.heard, "which card")).toEqual(["support.accounts"]);
        expect(await recordFor(runtime.stores, "which card")).toMatchObject({ by: "evaluated", member: "support.accounts" });
        expect(third.heard.find((h) => h.body.includes("which card"))?.recent).toEqual(recent);
        const read = (callsFor(third.route, "which card")[0]!.state as { recent: Array<{ text: string }> }).recent;
        expect(read.map((line) => line.text)).toEqual(recent);
      } finally {
        await third.state.dispose();
      }
    }
  );
});
