/**
 * A post to `support.help` runs the specialist the route picked once, on this
 * app's own wiring: the real config, the hired roster, and the scripted model
 * and route.
 *
 * What is graded is always the seats' own conversations, read back through the
 * same routes the page reads, never the fan-out's output. A seat's channel
 * conversation is a dispatch run of the channel, so it is listed only with
 * dispatch runs included.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1590/BUSINESS-RULES.md`, V3),
 * re-pointed onto the routed roster by FIX-1611, and the red state each was
 * seen in before its green was trusted:
 *
 *   BR-1  a post with no author runs the specialist it was routed to once, in
 *         one conversation of its own, the post heard once with one scripted
 *         reply under it, and no other specialist hears it (FIX-1611 BR-4).
 *         Red: the name-only stub (`GOAL_CONTROL=name-only-notify`) runs
 *         nobody; the route taken off (`GOAL_CONTROL=no-route`) runs everyone.
 *   BR-3  a post a seat wrote, through the internal seat entry, runs no seat,
 *         the writer included (FIX-1602's BR-3). A public post that only
 *         claims that seat as `author` still runs the specialist. Red: the
 *         seat mark stripped before the wake (`GOAL_CONTROL=no-author-filter`).
 *   BR-9  a second post lands in the same conversation of the specialist.
 *   BR-10 two posts at once each run exactly once, in that same conversation.
 *   BR-14 the post's own request carries no seat's answer: the wake runs in
 *         the channel's hand-off request.
 *   FIX-1602 BR-11: a seat conversation this app's own wake opened before
 *         it moved onto Workforce's `wakeMemberSeats` takes the next post.
 *         Red: the helper's key changed, so the next post opens a second.
 *   BR-11, BR-12 need a roster this app does not have (a seat in two
 *         channels, a refused wake), so they are held on the factory below,
 *         with a roster built for them.
 *
 * BR-2 and BR-6 (the name-only line for a member the wake does not run) and
 * BR-4 (a channel with no agent member) left with the roster that had such
 * members: every member of `support.help` is an agent, so the notify has no
 * name-only line to give. FIX-1602's fixture host still proves the wake
 * without one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, dispatcher, handler, utility, type BlockDefinition } from "@flow-state-dev/core";
import { z } from "zod";
import type { FlowState, StoreRegistry } from "@flow-state-dev/engine";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  CHANNEL_KIND,
  channelNotifyInputSchema,
  defineChannelFlow,
  hireWorkforce,
  type ChannelNotifyInput,
} from "@flow-state-dev/workforce";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 60_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

const USER = "devuser";
const CHANNEL = "support.help";
const SPECIALISTS = ["support.devices", "support.accounts", "support.fsd", "support.general"];
/** The specialist each post names with `[route:<member>]`, which the scripted route honours. */
const ROUTED = "support.accounts";
const OTHERS = SPECIALISTS.filter((seat) => seat !== ROUTED);

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
});

async function bootApp(control?: string): Promise<Router> {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
  vi.stubEnv("GOAL_CONTROL", control ?? "");
  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  return await flowstate.getRouter();
}

async function call(router: Router, method: "GET" | "POST", segments: string[], body?: unknown, query = "") {
  const res = await router[method](
    new Request(`http://localhost/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, {
      method,
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path: segments } },
  );
  return { status: res.status, text: await res.text() };
}

/**
 * Post the way the page's composer does. `author`, when set, is only the
 * caller's claim. It is not a seat's post.
 */
async function post(router: Router, sessionId: string, body: string, author?: string) {
  const input = author === undefined ? { body } : { body, author };
  const res = await call(router, "POST", ["channel", "actions", "post"], { userId: USER, sessionId, input });
  expect(res.status, res.text).toBe(200);
  return res;
}

/**
 * Post the way a seat does: the channel's `seatPost` action, which is what
 * marks the line a seat's. `author` is the name on the line.
 */
async function seatPost(sessionId: string, body: string, author: string) {
  const flowstate = (globalThis as { __fsdFlowstate?: FlowState }).__fsdFlowstate;
  if (flowstate === undefined) throw new Error("the app is not booted");
  const runtime = await flowstate.getRuntime();
  const channel = runtime.registry.get(CHANNEL_KIND);
  if (channel === undefined) throw new Error("the channel kind is not registered");
  const { KITCHEN_SINK_ORG_ID } = await import("@/lib/kitchen-sink-principal");
  const result = await runAction({
    source: "internal",
    orgId: KITCHEN_SINK_ORG_ID,
    flow: channel,
    actionName: "seatPost",
    input: { body, author },
    userId: USER,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
  expect(result.error, JSON.stringify(result.error)).toBeUndefined();
}

type Message = { role: string; text: string };
type Conversation = { sessionId: string; parentSessionId?: string; messages: Message[] };

/** Every conversation of a seat, dispatch runs included, with its kept messages. */
async function conversationsOf(router: Router, seat: string): Promise<Conversation[]> {
  const listed = await call(router, "GET", ["sessions"], undefined, `?flowId=${encodeURIComponent(seat)}&userId=${USER}&include=dispatch-runs&limit=100`);
  expect(listed.status, listed.text).toBe(200);
  const rows = (JSON.parse(listed.text) as { sessions: Array<{ id: string; parentSessionId?: string | null }> }).sessions;
  const out: Conversation[] = [];
  for (const row of rows) {
    const state = await call(router, "GET", ["sessions", row.id, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
    const items = (JSON.parse(state.text) as { items?: Array<{ role?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
    out.push({
      sessionId: row.id,
      ...(row.parentSessionId == null ? {} : { parentSessionId: row.parentSessionId }),
      messages: items
        .filter((item) => item.transient !== true)
        .map((item) => ({ role: item.role ?? "", text: (item.content ?? []).map((c) => c.text ?? "").join("") })),
    });
  }
  return out;
}

/** The conversations of a seat that hold `token`. */
async function holding(router: Router, seat: string, token: string): Promise<Conversation[]> {
  return (await conversationsOf(router, seat)).filter((c) => c.messages.some((m) => m.text.includes(token)));
}

async function until(predicate: () => Promise<boolean>, label: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Whether the routed specialist has answered the post carrying `token`. */
async function routedAnswered(router: Router, token: string): Promise<boolean> {
  return (await holding(router, ROUTED, token)).some((c) => {
    const heard = c.messages.findIndex((m) => m.role === "user" && m.text.includes(token));
    return c.messages.slice(heard + 1).some((m) => m.role === "assistant" && m.text.includes("[reply:wake]"));
  });
}

const token = (label: string) => `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

describe("V3 · a post runs the specialist it was routed to once, on the app's own channel", () => {
  it("runs support.accounts once, in a conversation of its own, and nobody else", async () => {
    const router = await bootApp();
    const mark = token("wake");
    const body = `[route:${ROUTED}] [scenario:wake] ${mark} can someone look at my refund?`;
    const posted = await post(router, CHANNEL, body);

    await until(() => routedAnswered(router, mark), "the routed specialist to answer");
    // Give a wrongly woken specialist time to answer, so its absence is not a race.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const convs = await holding(router, ROUTED, mark);
    expect(convs, `${ROUTED}'s conversations holding the post`).toHaveLength(1);
    const [conv] = convs;
    // A run the channel started, not a conversation the person opened.
    expect(conv!.parentSessionId).toBe(CHANNEL);
    expect(conv!.messages).toEqual([
      { role: "user", text: expect.stringContaining(`${USER} in ${CHANNEL}: ${body}`) },
      { role: "assistant", text: expect.stringContaining("[reply:wake]") },
    ]);
    // Only the routed specialist heard it.
    for (const seat of OTHERS) expect(await holding(router, seat, mark), seat).toEqual([]);
    // BR-14: the post's own request streamed no seat's answer.
    expect(posted.text).not.toContain("[reply:wake]");
  });

  it("lands a second post in the same conversation of the specialist", async () => {
    const router = await bootApp();
    const first = token("first");
    const second = token("second");
    await post(router, CHANNEL, `[route:${ROUTED}] [scenario:wake] ${first}`);
    await until(() => routedAnswered(router, first), "the first answer");
    await post(router, CHANNEL, `[route:${ROUTED}] [scenario:wake] ${second}`);
    await until(() => routedAnswered(router, second), "the second answer");

    const a = await holding(router, ROUTED, first);
    const b = await holding(router, ROUTED, second);
    expect(a).toHaveLength(1);
    expect(b.map((c) => c.sessionId)).toEqual([a[0]!.sessionId]);
    expect(b[0]!.messages.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("runs two posts that arrive together once each, in the one conversation", async () => {
    const router = await bootApp();
    const a = token("together-a");
    const b = token("together-b");
    await Promise.all([
      post(router, CHANNEL, `[route:${ROUTED}] [scenario:wake] ${a}`),
      post(router, CHANNEL, `[route:${ROUTED}] [scenario:wake] ${b}`),
    ]);
    await until(async () => (await routedAnswered(router, a)) && (await routedAnswered(router, b)), "both posts answered");

    const convs = (await conversationsOf(router, ROUTED)).filter((c) => c.parentSessionId === CHANNEL);
    expect(convs, `${ROUTED}'s channel conversations`).toHaveLength(1);
    const turns = convs[0]!.messages.filter((m) => m.role === "user").map((m) => m.text);
    // Each post heard exactly once, in no guaranteed order.
    expect(turns.filter((t) => t.includes(a))).toHaveLength(1);
    expect(turns.filter((t) => t.includes(b))).toHaveLength(1);
  });

  it("runs no seat on a post a seat wrote, the writer included", async () => {
    const router = await bootApp();
    const mark = token("authored");
    await seatPost(CHANNEL, `[route:${ROUTED}] [scenario:wake] ${mark}`, "support.devices");
    // A wrongly woken seat answers within this in every run of the scripted model.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    for (const seat of SPECIALISTS) expect(await holding(router, seat, mark), seat).toEqual([]);
  });

  it("still runs the routed specialist when a public post claims a hire address as author", async () => {
    const router = await bootApp();
    const mark = token("claimed");
    const body = `[route:${ROUTED}] [scenario:wake] ${mark} can someone look at my refund?`;
    await post(router, CHANNEL, body, "support.devices");

    await until(() => routedAnswered(router, mark), "the routed specialist to answer a claimed author");
    const convs = await holding(router, ROUTED, mark);
    expect(convs, `${ROUTED}'s conversations holding the claimed post`).toHaveLength(1);
    expect(convs[0]!.messages[0]?.text).toEqual(expect.stringContaining(`support.devices in ${CHANNEL}: ${body}`));
  });
});

// ---------------------------------------------------------------------------
// The factory, on a roster built for the cases the app's own cannot reach.
// ---------------------------------------------------------------------------

async function bind(stores: StoreRegistry, sessionId: string, members: string[]): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      state: { members, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );
}

describe("V3 · the wake factory, off the app's own roster", () => {
  /**
   * `support.otto` is hired and registered. `support.iris` is hired and handed
   * to the wake, but its flow is not registered, so its dispatch is refused.
   * `support.lost` never loaded, so it has no seat to wake.
   */
  async function host() {
    vi.resetModules();
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "");
    const { notifyFor } = await import("@/workforce/channel-notify");
    const { createKitchenSinkTestModelResolver } = await import("@/test/mock-flowstate");
    const [iris, otto] = hireWorkforce([
      { id: "support.iris", declared: {}, body: "You answer questions." },
      { id: "support.otto", declared: {}, body: "You answer questions." },
    ]);
    const channel = defineChannelFlow({ notify: notifyFor([iris!, otto!]) })();
    const state = createFlowState({
      flows: { [CHANNEL_KIND]: channel, [otto!.id]: otto! },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createKitchenSinkTestModelResolver(),
    });
    const runtime = await state.getRuntime();
    const send = (sessionId: string, body: string) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow: channel,
        actionName: "post",
        input: { body },
        userId: USER,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });
    const ottoRuns = async () => {
      const sessions = await runtime.stores.session.list({ flowId: "support.otto", parentage: "all" });
      return sessions.filter((s) => s.parentSessionId != null);
    };
    return { state, runtime, send, ottoRuns };
  }

  it("still runs the other members when one wake is refused, or has no seat", async () => {
    const { state, runtime, send, ottoRuns } = await host();
    try {
      await bind(runtime.stores, "room.one", ["support.iris", "support.otto", "support.lost"]);
      const sent = await send("room.one", "[scenario:wake] refused-one");
      expect(sent.error).toBeUndefined();

      await until(async () => (await ottoRuns()).length === 1, "otto's run");
      const channelItems = async () =>
        JSON.stringify(await runtime.stores.request.list({ sessionId: "room.one", withItems: true }));
      // BR-12: iris's refusal is recorded in the fan-out's own request.
      await until(async () => (await channelItems()).includes("flow-not-found"), "iris's refusal");
      const items = await channelItems();
      // The post stays written, whatever the wakes did.
      expect(items).toContain('"component":"channel-post"');
      expect(items).toContain("refused-one");
    } finally {
      await state.dispose();
    }
  });

  it("keeps one conversation per channel for a seat in two channels", async () => {
    const { state, runtime, send, ottoRuns } = await host();
    try {
      await bind(runtime.stores, "room.one", ["support.otto"]);
      await bind(runtime.stores, "room.two", ["support.otto"]);
      await send("room.one", "[scenario:wake] in room one");
      await send("room.two", "[scenario:wake] in room two");
      await until(async () => (await ottoRuns()).length === 2, "a conversation per channel");

      const runs = await ottoRuns();
      expect(runs.map((r) => r.parentSessionId).sort()).toEqual(["room.one", "room.two"]);
      for (const run of runs) {
        const [request] = await runtime.stores.request.list({ sessionId: run.id, withItems: true });
        const text = JSON.stringify(request?.items ?? []);
        // Neither sees the other's post.
        const other = run.parentSessionId === "room.one" ? "room two" : "room one";
        expect(text).not.toContain(other);
      }
    } finally {
      await state.dispose();
    }
  });
});

describe("V3 · a restart onto the package's wake", () => {
  it("lands the next post in the seat conversation the app's own wake opened before the move (BR-11)", async () => {
    vi.resetModules();
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "");
    const { notifyFor } = await import("@/workforce/channel-notify");
    // The old wake's fallback, as it was: a name-only line for a member it did not run.
    const notifyMember = handler({
      name: "kitchen-sink-notify-member",
      inputSchema: channelNotifyInputSchema,
      outputSchema: z.object({ notified: z.string() }),
      execute: (input: ChannelNotifyInput) => ({ notified: input.member }),
    });
    const { createKitchenSinkTestModelResolver } = await import("@/test/mock-flowstate");
    const [otto] = hireWorkforce([{ id: "support.otto", declared: {}, body: "You answer questions." }]);
    const stores = inMemoryStores();

    // The wake this app built for itself before it moved onto the package's,
    // as it was in what finds a conversation: the dispatcher's name, target,
    // entry and key.
    const before = utility.keyedRouter({
      name: "kitchen-sink-notify",
      inputSchema: channelNotifyInputSchema,
      blocks: {
        "support.otto": dispatcher({
          name: "wake-support.otto",
          flowKind: "support.otto",
          action: "onChannelPost",
          inputSchema: channelNotifyInputSchema,
          session: { key: (p: ChannelNotifyInput) => `channel:${p.channelId}` },
        }),
      },
      select: (p: ChannelNotifyInput) => (p.author !== undefined ? "" : p.member),
      fallback: notifyMember,
    });

    /** Boot on one wake, post once, wait for otto to hear it, and shut down. */
    const runOn = async (notify: BlockDefinition<any, any>, body: string) => {
      const channel = defineChannelFlow({ notify })();
      const state = createFlowState({
        flows: { [CHANNEL_KIND]: channel, [otto!.id]: otto! },
        stores: { default: { primary: stores } },
        modelResolver: createKitchenSinkTestModelResolver(),
      });
      try {
        const runtime = await state.getRuntime();
        if ((await runtime.stores.session.get("room.one")) === undefined) {
          await bind(runtime.stores, "room.one", ["support.otto"]);
        }
        const sent = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow: channel,
          actionName: "post",
          input: { body },
          userId: USER,
          sessionId: "room.one",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig },
        });
        expect(sent.error).toBeUndefined();
        const runs = async () =>
          (await runtime.stores.session.list({ flowId: "support.otto", parentage: "all" })).filter(
            (s) => s.parentSessionId === "room.one",
          );
        const heard = async () => {
          for (const run of await runs()) {
            const requests = await runtime.stores.request.list({ sessionId: run.id });
            if (requests.some((r) => r.status === "completed" && JSON.stringify(r.input).includes(body))) return true;
          }
          return false;
        };
        await until(heard, `otto to hear "${body}"`);
        return (await runs()).map((r) => r.id);
      } finally {
        await state.dispose();
      }
    };

    const opened = await runOn(before, "[scenario:wake] before the move");
    expect(opened).toHaveLength(1);
    const after = await runOn(notifyFor([otto!]), "[scenario:wake] after the move");
    expect(after).toEqual(opened);
  });
});
