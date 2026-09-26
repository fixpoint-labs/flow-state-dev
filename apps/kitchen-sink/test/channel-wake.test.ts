/**
 * A post to a channel runs each member agent seat once, on this app's own
 * wiring: the real config, the hired roster, and the scripted model.
 *
 * What is graded is always the seats' own conversations, read back through the
 * same routes the page reads, never the fan-out's output. A seat's channel
 * conversation is a dispatch run of the channel, so it is listed only with
 * dispatch runs included.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1590/BUSINESS-RULES.md`, V3),
 * and the red state each was seen in before its green was trusted:
 *
 *   BR-1  a post with no author runs `support.iris` and `support.otto` once
 *         each, in one conversation of their own, the post heard once with one
 *         scripted reply under it. Red: the name-only stub
 *         (`GOAL_CONTROL=name-only-notify`).
 *   BR-2  `support.ada`, `support.grace` and `support.wren` get the name-only
 *         line and nothing runs on them. Red: the same stub, where the line
 *         reaches all five members.
 *   BR-3  a post a seat wrote runs no seat; the non-agent members get the
 *         line, and the agent members and the writer nothing (FIX-1602's
 *         BR-3). Red: the author dropped before the wake
 *         (`GOAL_CONTROL=no-author-filter`).
 *   BR-4  a post to `support.ada-wren`, which has no agent member, runs nobody.
 *   BR-9  a second post lands in the same conversation of each seat.
 *   BR-10 two posts at once each run exactly once, in that same conversation.
 *   BR-14 the post's own request carries no seat's answer: the wake runs in
 *         the channel's hand-off request.
 *   FIX-1602 BR-11: a seat conversation this app's own wake opened before
 *         it moved onto Workforce's `wakeMemberSeats` takes the next post.
 *         Red: the helper's key changed, so the next post opens a second.
 *   BR-6, BR-11, BR-12 need a roster this app does not have (a member whose
 *         seat is missing, a seat in two channels, a refused wake), so they are
 *         held on the factory below, with a roster built for them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, dispatcher, utility, type BlockDefinition } from "@flow-state-dev/core";
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
const DESK_MEMBERS = ["support.ada", "support.grace", "support.iris", "support.otto", "support.wren"];
const AGENTS = ["support.iris", "support.otto"];
const OTHERS = ["support.ada", "support.grace", "support.wren"];

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

/** Post the way the page's composer does, or as a seat would with `author`. */
async function post(router: Router, sessionId: string, body: string, author?: string) {
  const input = author === undefined ? { body } : { body, author };
  const res = await call(router, "POST", ["channel", "actions", "post"], { userId: USER, sessionId, input });
  expect(res.status, res.text).toBe(200);
  return res;
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

/**
 * Every member the name-only block ran for on a channel, read off its own
 * completed traces. Its line is transient, so the trace is the durable record.
 */
async function notifiedOn(router: Router, sessionId: string): Promise<string[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=block_trace&limit=5000");
  const items = (JSON.parse(res.text) as { items?: Array<{ blockName?: string; status?: string; output?: { value?: { notified?: string } } }> }).items ?? [];
  return items
    .filter((item) => item.blockName === "kitchen-sink-notify-member" && item.status === "completed")
    .map((item) => item.output?.value?.notified ?? "");
}

async function until(predicate: () => Promise<boolean>, label: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Whether every agent seat has answered the post carrying `token`. */
async function agentsAnswered(router: Router, token: string, replies = 1): Promise<boolean> {
  for (const seat of AGENTS) {
    const convs = await holding(router, seat, token);
    const answered = convs.flatMap((c) => c.messages).filter((m) => m.role === "assistant" && m.text.includes("[reply:wake]"));
    if (answered.length < replies) return false;
  }
  return true;
}

const token = (label: string) => `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

describe("V3 · a post runs each member agent seat once, on the app's own channels", () => {
  it("runs support.iris and support.otto once each, in a conversation of their own, and nobody else", async () => {
    const router = await bootApp();
    const mark = token("wake");
    const posted = await post(router, "support.desk", `[scenario:wake] ${mark} can someone look at the refund queue?`);

    await until(() => agentsAnswered(router, mark), "both agent seats to answer");
    await until(async () => (await notifiedOn(router, "support.desk")).length >= OTHERS.length, "the name-only lines");

    for (const seat of AGENTS) {
      const convs = await holding(router, seat, mark);
      expect(convs, `${seat}'s conversations holding the post`).toHaveLength(1);
      const [conv] = convs;
      // A run the channel started, not a conversation the person opened.
      expect(conv!.parentSessionId).toBe("support.desk");
      expect(conv!.messages).toEqual([
        { role: "user", text: `${USER} in support.desk: [scenario:wake] ${mark} can someone look at the refund queue?` },
        { role: "assistant", text: expect.stringContaining("[reply:wake]") },
      ]);
    }
    // BR-2: the clerk and the runner get the line, and nothing runs on them.
    expect((await notifiedOn(router, "support.desk")).sort()).toEqual(OTHERS);
    for (const seat of OTHERS) expect(await holding(router, seat, mark), seat).toEqual([]);
    // BR-14: the post's own request streamed no seat's answer.
    expect(posted.text).not.toContain("[reply:wake]");
  });

  it("lands a second post in the same conversation of each seat", async () => {
    const router = await bootApp();
    const first = token("first");
    const second = token("second");
    await post(router, "support.desk", `[scenario:wake] ${first}`);
    await until(() => agentsAnswered(router, first), "the first answers");
    await post(router, "support.desk", `[scenario:wake] ${second}`);
    await until(() => agentsAnswered(router, second), "the second answers");

    for (const seat of AGENTS) {
      const a = await holding(router, seat, first);
      const b = await holding(router, seat, second);
      expect(a).toHaveLength(1);
      expect(b.map((c) => c.sessionId)).toEqual([a[0]!.sessionId]);
      expect(b[0]!.messages.filter((m) => m.role === "user")).toHaveLength(2);
    }
  });

  it("runs two posts that arrive together once each, in the one conversation", async () => {
    const router = await bootApp();
    const a = token("together-a");
    const b = token("together-b");
    await Promise.all([post(router, "support.desk", `[scenario:wake] ${a}`), post(router, "support.desk", `[scenario:wake] ${b}`)]);
    await until(async () => (await agentsAnswered(router, a)) && (await agentsAnswered(router, b)), "both posts answered");

    for (const seat of AGENTS) {
      const convs = (await conversationsOf(router, seat)).filter((c) => c.parentSessionId === "support.desk");
      expect(convs, `${seat}'s channel conversations`).toHaveLength(1);
      const turns = convs[0]!.messages.filter((m) => m.role === "user").map((m) => m.text);
      // Each post heard exactly once, in no guaranteed order.
      expect(turns.filter((t) => t.includes(a))).toHaveLength(1);
      expect(turns.filter((t) => t.includes(b))).toHaveLength(1);
    }
  });

  it("runs no seat on a post a seat wrote; the non-agent members get the line, the agents and the writer nothing", async () => {
    const router = await bootApp();
    const mark = token("authored");
    await post(router, "support.desk", `[scenario:wake] ${mark}`, "support.otto");
    await until(async () => (await notifiedOn(router, "support.desk")).filter((m) => m !== "").length >= OTHERS.length, "the lines");
    // Give a wrongly woken seat time to answer, so its absence is not a race.
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const seat of DESK_MEMBERS) expect(await holding(router, seat, mark), seat).toEqual([]);
    // support.iris could have woken, so the author withholds its wake and
    // sends it nothing else either: the line goes only where it always would.
    expect((await notifiedOn(router, "support.desk")).filter((m) => m !== "").sort()).toEqual(OTHERS);
  });

  it("runs nobody on a post to a channel with no agent member", async () => {
    const router = await bootApp();
    const mark = token("ada-wren");
    await post(router, "support.ada-wren", `[scenario:wake] ${mark}`);
    await until(async () => (await notifiedOn(router, "support.ada-wren")).length >= 2, "the lines");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((await notifiedOn(router, "support.ada-wren")).sort()).toEqual(["support.ada", "support.wren"]);
    for (const seat of DESK_MEMBERS) expect(await holding(router, seat, mark), seat).toEqual([]);
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

  it("still runs the other members when one wake is refused, and gives a member with no seat the line", async () => {
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
      // BR-6: the member with no dispatcher got the name-only line.
      expect(items).toContain('"notified":"support.lost"');
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
    const { notifyFor, notifyMember } = await import("@/workforce/channel-notify");
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
