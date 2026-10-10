/**
 * A specialist best fit picked answers in the person's conversation with
 * `support.help`, under its own name, once, and its answer wakes nobody, on
 * this app's own wiring: the real config, the hired roster, and the scripted
 * model and best-fit evaluation.
 *
 * The line is read the way the page reads it (the conversation's kept
 * messages), and the specialists' sessions the way the rail lists them
 * (dispatch runs included), after the answers settle.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1594/PLAN.md`, V2 and V3),
 * re-pointed onto the routed roster by FIX-1611 (BR-6) and onto the
 * coordinator by FIX-1792 (BR-8):
 *   BR-2   a post carrying `[scenario:reply-in-mailbox]`, picked for
 *          `support.devices`, runs it, and its answer lands as one line in
 *          the person's conversation under `support.devices`.
 *   BR-9   the line runs no specialist: the specialist heard the token once,
 *          in the person's post, and the others never.
 *
 * BR-15 (the seat's own conversation holds the tool call, never a copy of the
 * line) left with the post tool: a delegate's answer is its turn's own reply,
 * which its session keeps.
 *
 * These run on the default wiring only. The controls' red states are graded
 * in `goals/kitchen-sink-talk/agent-replies-in-the-mailbox/run.mts`, not here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 60_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

const USER = "devuser";
const COORDINATOR = "support.help";
const SEAT = "support.devices";
const OTHERS = ["support.accounts", "support.fsd", "support.general"];
const LINE_MARKER = "[reply:in-mailbox]";

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
});

async function bootApp(control = ""): Promise<Router> {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
  vi.stubEnv("GOAL_CONTROL", control);
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

type Line = { role?: string; agentName?: string; text: string };

/** The conversation's lines as the page reads them: its session's kept messages. */
async function linesOf(router: Router, sessionId: string): Promise<Line[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
  expect(res.status, res.text).toBe(200);
  const items = (JSON.parse(res.text) as { items?: Array<{ role?: string; agentName?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
  return items
    .filter((item) => item.transient !== true)
    .map((item) => ({ role: item.role, agentName: item.agentName, text: (item.content ?? []).map((c) => c.text ?? "").join("") }));
}

type Item = { type?: string; role?: string; transient?: boolean; content?: Array<{ text?: string }> };

/** Every session of a worker (its sessions on `agent`'s one copy) that mentions `token`, with its items. */
async function conversationsHolding(router: Router, seat: string, token: string): Promise<Item[][]> {
  const listed = await call(router, "GET", ["sessions"], undefined, `?flowId=agent&state.workerId=${encodeURIComponent(seat)}&userId=${USER}&include=dispatch-runs&limit=100`);
  const rows = (JSON.parse(listed.text) as { sessions: Array<{ id: string }> }).sessions;
  const out: Item[][] = [];
  for (const row of rows) {
    const state = await call(router, "GET", ["sessions", row.id, "state"], undefined, "?include_items=true&limit=1000");
    const items = (JSON.parse(state.text) as { items?: Item[] }).items ?? [];
    if (JSON.stringify(items).includes(token)) out.push(items);
  }
  return out;
}

const textOf = (item: Item) => (item.content ?? []).map((c) => c.text ?? "").join("");
const keptMessages = (items: Item[]) => items.filter((i) => i.type === "message" && i.transient !== true);

async function until(predicate: () => Promise<boolean>, label: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const token = () => `reply-token-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The post each case sends, routed to the specialist. */
const postBody = (mark: string) => `[route:${SEAT}] [scenario:reply-in-mailbox] ${mark} when do refunds post?`;

/** Post as the page does, wait for the specialist's line, and give a wrongly woken specialist time to run. */
async function postAndSettle(router: Router, mark: string): Promise<string> {
  const opened = await call(router, "POST", ["coordinator", "sessions"], { userId: USER, state: { workerId: COORDINATOR } });
  expect(opened.status, opened.text).toBe(201);
  const conversation = (JSON.parse(opened.text) as { session: { id: string } }).session.id;
  const res = await call(router, "POST", ["coordinator", "actions", "run"], {
    userId: USER,
    sessionId: conversation,
    input: { message: postBody(mark) },
  });
  expect(res.status, res.text).toBe(200);
  await until(async () => (await linesOf(router, conversation)).some((l) => l.agentName !== undefined && l.text.includes(mark)), "the specialist's line");
  await new Promise((resolve) => setTimeout(resolve, 750));
  return conversation;
}

describe("V2 · a specialist answers in the person's conversation, under its own name", () => {
  it("lands one line in the conversation as support.devices, carrying the post's token", async () => {
    const router = await bootApp();
    const mark = token();
    const conversation = await postAndSettle(router, mark);

    const lines = await linesOf(router, conversation);
    const at = lines.findIndex((l) => l.role === "user" && l.text.includes(mark));
    // One line after the person's: the specialist's answer.
    expect(lines.slice(at + 1)).toHaveLength(1);
    const [reply] = lines.slice(at + 1);
    expect(reply!.text).toContain(LINE_MARKER);
    expect(reply!.text).toContain(mark);
    expect(reply).toMatchObject({ agentName: SEAT });
  });
});

describe("V3 · a specialist's line wakes nobody", () => {
  it("the specialist hears the token once, in the person's post, and nobody hears its line", async () => {
    const router = await bootApp();
    const mark = token();
    await postAndSettle(router, mark);

    const heard = (await conversationsHolding(router, SEAT, mark))
      .flatMap(keptMessages)
      .filter((m) => m.role === "user" && textOf(m).includes(mark))
      .map(textOf);
    expect(heard, `${SEAT}'s turns carrying the token`).toEqual([
      expect.stringContaining(`${USER}, through ${COORDINATOR}: ${postBody(mark)}`),
    ]);
    for (const other of OTHERS) {
      expect(await conversationsHolding(router, other, mark), `${other}'s sessions carrying the token`).toEqual([]);
    }
  });
});
