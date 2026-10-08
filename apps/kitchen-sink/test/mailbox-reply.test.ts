/**
 * A specialist routed a post answers in the mailbox through its post tool,
 * under its own name, once, and its line wakes nobody, on this app's own
 * wiring: the real config, the hired roster, and the scripted model and route.
 *
 * The line is read the way the page reads it (the mailbox's `mailbox-post`
 * items), and the seats' conversations the way the rail lists them (dispatch
 * runs included), after the answers settle.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1594/PLAN.md`, V2 and V3),
 * re-pointed onto the routed roster by FIX-1611 (BR-6):
 *   BR-2   a post carrying `[scenario:reply-in-mailbox]`, routed to
 *          `support.devices`, wakes it, and its scripted `post-to-mailbox`
 *          call lands one line in `support.help` authored `support.devices`.
 *          The tool's line is the answer, so no second line lands (FIX-1610
 *          BR-10).
 *   BR-15  the seat's own conversation holds the tool call and its own reply,
 *          never a copy of the line.
 *   BR-9   the line runs no seat: the specialist heard the token once, in the
 *          person's post, and the others never.
 *
 * These run on the default wiring only. The controls' red states
 * (`GOAL_CONTROL=no-author-filter`, `GOAL_CONTROL=post-without-author`) are
 * graded in `goals/kitchen-sink-talk/agent-replies-in-the-mailbox/run.mts` and
 * the talk Playwright case, not here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 60_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

const USER = "devuser";
const MAILBOX = "support.help";
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

type Line = { author?: string; principal?: string; authorVerified: boolean; body: string };

/** The mailbox's lines as the page reads them: its session's `mailbox-post` items. */
async function linesOf(router: Router, sessionId: string): Promise<Line[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=component&limit=1000");
  expect(res.status, res.text).toBe(200);
  const items = (JSON.parse(res.text) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "mailbox-post").map((item) => item.data!);
}

type Item = {
  type?: string;
  role?: string;
  transient?: boolean;
  content?: Array<{ text?: string }>;
  toolCall?: { name?: string; arguments?: string };
};

/** Every conversation of a worker (its sessions on `agent`'s one copy) that mentions `token`, with its items. */
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

/** Post as the page does, wait for the specialist's line and answer, and give a wrongly woken seat time to run. */
async function postAndSettle(router: Router, mark: string): Promise<void> {
  const res = await call(router, "POST", ["mailbox", "actions", "post"], {
    userId: USER,
    sessionId: MAILBOX,
    input: { body: postBody(mark) },
  });
  expect(res.status, res.text).toBe(200);
  await until(async () => (await linesOf(router, MAILBOX)).some((l) => l.body.includes(LINE_MARKER) && l.body.includes(mark)), "the specialist's line");
  await until(async () => (await conversationsHolding(router, SEAT, mark)).length > 0, `${SEAT}'s answer`);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

describe("V2 · a woken agent seat answers in the mailbox, under its own name", () => {
  it("lands one line in support.help as support.devices, and keeps only the tool call in its conversation", async () => {
    const router = await bootApp();
    const mark = token();
    await postAndSettle(router, mark);

    const lines = await linesOf(router, MAILBOX);
    const at = lines.findIndex((l) => l.author === undefined && l.body.includes(mark));
    // One line after the person's: the tool's. The routed turn's reply does not land a second.
    expect(lines.slice(at + 1)).toHaveLength(1);
    const [reply] = lines.slice(at + 1);
    expect(reply!.body).toContain(LINE_MARKER);
    expect(reply).toMatchObject({ author: SEAT, principal: USER });

    const [seat] = await conversationsHolding(router, SEAT, mark);
    const calls = seat!.filter((i) => i.type === "tool_output" && i.toolCall?.name === "post-to-mailbox");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.toolCall!.arguments!)).toMatchObject({ mailbox: MAILBOX });
    // The line itself is the mailbox's; the seat's conversation holds no copy of it.
    expect(keptMessages(seat!).map(textOf).filter((t) => t.includes(reply!.body))).toEqual([]);
  });
});

describe("V3 · a seat's line wakes nobody", () => {
  it("the specialist hears the token once, in the person's post, and nobody hears its line", async () => {
    const router = await bootApp();
    const mark = token();
    await postAndSettle(router, mark);

    const heard = (await conversationsHolding(router, SEAT, mark))
      .flatMap(keptMessages)
      .filter((m) => m.role === "user" && textOf(m).includes(mark))
      .map(textOf);
    expect(heard, `${SEAT}'s turns carrying the token`).toEqual([
      expect.stringContaining(`${USER} in ${MAILBOX}: ${postBody(mark)}`),
    ]);
    for (const other of OTHERS) {
      expect(await conversationsHolding(router, other, mark), `${other}'s conversations carrying the token`).toEqual([]);
    }
  });
});
