/**
 * A post to `support.help` runs the specialist best fit picked once, on this
 * app's own wiring: the real config, the hired roster, and the scripted model
 * and best-fit evaluation.
 *
 * What is graded is always the specialists' own conversations, read back
 * through the same routes the page reads, never the coordinator's records. A
 * specialist's session for the person's conversation with `support.help` is a
 * dispatch run of that conversation, so it is listed only with dispatch runs
 * included.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1590/BUSINESS-RULES.md`, V3),
 * re-pointed onto the routed roster by FIX-1611 and onto the coordinator by
 * FIX-1792 (BR-8):
 *
 *   BR-1  a post runs the specialist best fit picked once, in one session of
 *         its own under the person's conversation, the post heard once with
 *         one scripted reply under it, and no other specialist hears it
 *         (FIX-1611 BR-4). Red: no flow taking a delegated post
 *         (`GOAL_CONTROL=no-delivery`) runs nobody; best fit read as
 *         `everyone` (`GOAL_CONTROL=no-route`) runs everyone.
 *   BR-3  a specialist's answer runs no specialist, its writer included.
 *         Red: the coordinator read with `rounds: 1`
 *         (`GOAL_CONTROL=answers-go-on`).
 *   BR-9  a second post lands in the same session of the specialist.
 *   BR-10 two posts at once each run exactly once, in that same session.
 *   BR-14 the post's own request carries no specialist's answer: the answer
 *         lands in a request of its own.
 *
 * A post that claims an author is refused at the door: the coordinator takes
 * the post alone, so there is no author to claim. BR-11 and BR-12 (a seat in
 * two mailboxes, a refused wake) left with the mailbox's wake; the
 * coordinator's own suite in `packages/workforce` holds a delegate's session
 * per conversation and a delivery that fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

import { delegateOfRun } from "@/lib/workforce-shell";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 60_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

const USER = "devuser";
const COORDINATOR = "support.help";
const SPECIALISTS = ["support.devices", "support.accounts", "support.fsd", "support.general"];
/** The specialist each post names with `[route:<worker>]`, which the scripted evaluation honours. */
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

/** The person's conversation with `support.help`, opened as a session on `coordinator` naming it. */
async function openConversation(router: Router): Promise<string> {
  const res = await call(router, "POST", ["coordinator", "sessions"], { userId: USER, state: { workerId: COORDINATOR } });
  expect(res.status, res.text).toBe(201);
  return (JSON.parse(res.text) as { session: { id: string } }).session.id;
}

/** Post the way the page's composer does: the coordinator's door, the post only. */
async function post(router: Router, sessionId: string, message: string) {
  const res = await call(router, "POST", ["coordinator", "actions", "run"], { userId: USER, sessionId, input: { message } });
  expect(res.status, res.text).toBe(200);
  return res;
}

type Message = { role: string; text: string };
type Conversation = { sessionId: string; parentSessionId?: string; messages: Message[] };

/**
 * Every session of a worker, dispatch runs included, with its kept messages:
 * the sessions on `agent`'s one copy created naming the worker.
 */
async function conversationsOf(router: Router, seat: string): Promise<Conversation[]> {
  const listed = await call(
    router,
    "GET",
    ["sessions"],
    undefined,
    `?flowId=agent&state.workerId=${encodeURIComponent(seat)}&userId=${USER}&include=dispatch-runs&limit=100`,
  );
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

/** The sessions of a worker that hold `token`. */
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

describe("V3 · a post runs the specialist best fit picked once, on the app's own coordinator", () => {
  it("runs support.accounts once, in a session of its own under the person's conversation, and nobody else", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const mark = token("wake");
    const body = `[route:${ROUTED}] [scenario:wake] ${mark} can someone look at my refund?`;
    const posted = await post(router, conversation, body);

    await until(() => routedAnswered(router, mark), "the routed specialist to answer");
    // Give a wrongly woken specialist time to answer, so its absence is not a race.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const convs = await holding(router, ROUTED, mark);
    expect(convs, `${ROUTED}'s sessions holding the post`).toHaveLength(1);
    const [conv] = convs;
    // A run the person's conversation started, not a conversation the person opened.
    expect(conv!.parentSessionId).toBe(conversation);
    expect(conv!.messages).toEqual([
      { role: "user", text: expect.stringContaining(`${USER}, through ${COORDINATOR}: ${body}`) },
      { role: "assistant", text: expect.stringContaining("[reply:wake]") },
    ]);
    // Only the routed specialist heard it.
    for (const seat of OTHERS) expect(await holding(router, seat, mark), seat).toEqual([]);
    // BR-14: the post's own request streamed no specialist's answer.
    expect(posted.text).not.toContain("[reply:wake]");
    // The run the page lists under the conversation names its delegate by the
    // key the page's working row reads (`delegateOfRun`).
    const children = await call(router, "GET", ["sessions", conversation, "children"]);
    expect(children.status, children.text).toBe(200);
    const runs = (JSON.parse(children.text) as { children: Array<{ id: string; topic?: string }> }).children;
    expect(runs.filter((run) => run.id === conv!.sessionId).map(delegateOfRun)).toEqual([ROUTED]);
  });

  it("lands a second post in the same session of the specialist", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const first = token("first");
    const second = token("second");
    await post(router, conversation, `[route:${ROUTED}] [scenario:wake] ${first}`);
    await until(() => routedAnswered(router, first), "the first answer");
    await post(router, conversation, `[route:${ROUTED}] [scenario:wake] ${second}`);
    await until(() => routedAnswered(router, second), "the second answer");

    const a = await holding(router, ROUTED, first);
    const b = await holding(router, ROUTED, second);
    expect(a).toHaveLength(1);
    expect(b.map((c) => c.sessionId)).toEqual([a[0]!.sessionId]);
    expect(b[0]!.messages.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("runs two posts that arrive together once each, in the one session", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const a = token("together-a");
    const b = token("together-b");
    await Promise.all([
      post(router, conversation, `[route:${ROUTED}] [scenario:wake] ${a}`),
      post(router, conversation, `[route:${ROUTED}] [scenario:wake] ${b}`),
    ]);
    await until(async () => (await routedAnswered(router, a)) && (await routedAnswered(router, b)), "both posts answered");

    const convs = (await conversationsOf(router, ROUTED)).filter((c) => c.parentSessionId === conversation);
    expect(convs, `${ROUTED}'s sessions under the conversation`).toHaveLength(1);
    const turns = convs[0]!.messages.filter((m) => m.role === "user").map((m) => m.text);
    // Each post heard exactly once, in no guaranteed order.
    expect(turns.filter((t) => t.includes(a))).toHaveLength(1);
    expect(turns.filter((t) => t.includes(b))).toHaveLength(1);
  });

  it("runs no specialist on a specialist's answer, the writer included", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const mark = token("answered");
    await post(router, conversation, `[route:${ROUTED}] [scenario:wake] ${mark}`);
    await until(() => routedAnswered(router, mark), "the routed specialist to answer");
    // A wrongly woken specialist answers within this in every run of the scripted model.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    // The answer is "[reply:wake] …": nobody was handed it as a turn.
    for (const seat of SPECIALISTS) {
      const heardAnswer = (await conversationsOf(router, seat))
        .flatMap((c) => c.messages)
        .filter((m) => m.role === "user" && m.text.includes("[reply:wake]"));
      expect(heardAnswer, seat).toEqual([]);
    }
  });

  it("refuses a post that claims an author, and runs nobody on it", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const mark = token("claimed");
    const res = await call(router, "POST", ["coordinator", "actions", "run"], {
      userId: USER,
      sessionId: conversation,
      input: { message: `[route:${ROUTED}] [scenario:wake] ${mark}`, author: "support.devices" },
    });
    // Refused in the request's own stream, naming the key the door does not take.
    expect(res.text).toContain("request.failed");
    expect(res.text).toContain("Unrecognized key(s) in object: 'author'");
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const seat of SPECIALISTS) expect(await holding(router, seat, mark), seat).toEqual([]);
  });
});
