/**
 * An agent seat that heard a post answers in the channel, under its own name,
 * and its line wakes nobody, on this app's own wiring: the real config, the
 * hired roster, and the scripted model.
 *
 * The line is read the way the page reads it (the channel's `channel-post`
 * items), and the seats' conversations the way the rail lists them (dispatch
 * runs included), after the answers settle.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1594/PLAN.md`, V2 and V3):
 *   BR-2   a post carrying `[scenario:reply-in-channel]` wakes `support.otto`,
 *          and its scripted `post-to-channel` call lands one line in
 *          `support.desk` authored `support.otto`. `support.iris` hears the
 *          same post and, holding no such tool, posts nothing (BR-7).
 *   BR-15  otto's own conversation holds the tool call and its own reply,
 *          never a copy of the line.
 *   BR-9   otto's line runs no seat: each agent heard the token once, in the
 *          person's post.
 *
 * These run on the default wiring only. The controls' red states
 * (`GOAL_CONTROL=no-author-filter`, `GOAL_CONTROL=post-without-author`) are
 * graded in `goals/kitchen-sink-talk/agent-replies-in-the-channel/run.mts` and
 * the talk Playwright case, not here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 60_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

const USER = "devuser";
const AGENTS = ["support.iris", "support.otto"];
const LINE_MARKER = "[reply:in-channel]";

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

/** The channel's lines as the page reads them: its session's `channel-post` items. */
async function linesOf(router: Router, sessionId: string): Promise<Line[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=component&limit=1000");
  expect(res.status, res.text).toBe(200);
  const items = (JSON.parse(res.text) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "channel-post").map((item) => item.data!);
}

type Item = {
  type?: string;
  role?: string;
  transient?: boolean;
  content?: Array<{ text?: string }>;
  toolCall?: { name?: string; arguments?: string };
};

/** Every conversation of a seat that mentions `token`, with its items. */
async function conversationsHolding(router: Router, seat: string, token: string): Promise<Item[][]> {
  const listed = await call(router, "GET", ["sessions"], undefined, `?flowId=${encodeURIComponent(seat)}&userId=${USER}&include=dispatch-runs&limit=100`);
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

/** Post as the page does, wait for otto's line and every agent's answer, and give a wrongly woken seat time to run. */
async function postAndSettle(router: Router, mark: string): Promise<void> {
  const res = await call(router, "POST", ["channel", "actions", "post"], {
    userId: USER,
    sessionId: "support.desk",
    input: { body: `[scenario:reply-in-channel] ${mark} when do refunds post?` },
  });
  expect(res.status, res.text).toBe(200);
  await until(async () => (await linesOf(router, "support.desk")).some((l) => l.body.includes(LINE_MARKER) && l.body.includes(mark)), "otto's line");
  for (const seat of AGENTS) {
    await until(async () => (await conversationsHolding(router, seat, mark)).length > 0, `${seat}'s answer`);
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}

describe("V2 · a woken agent seat answers in the channel, under its own name", () => {
  it("lands otto's line in support.desk as support.otto, and keeps only the tool call in otto's conversation", async () => {
    const router = await bootApp();
    const mark = token();
    await postAndSettle(router, mark);

    const replies = (await linesOf(router, "support.desk")).filter((l) => l.body.includes(LINE_MARKER) && l.body.includes(mark));
    // One line: iris heard the same post and, without the tool, posted nothing.
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ author: "support.otto", principal: USER });

    const [otto] = await conversationsHolding(router, "support.otto", mark);
    const calls = otto!.filter((i) => i.type === "tool_output" && i.toolCall?.name === "post-to-channel");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.toolCall!.arguments!)).toMatchObject({ channel: "support.desk" });
    // The line itself is the channel's; the seat's conversation holds no copy of it.
    expect(keptMessages(otto!).map(textOf).filter((t) => t.includes(replies[0]!.body))).toEqual([]);
  });
});

describe("V3 · a seat's line wakes nobody", () => {
  it("each agent hears the token once, in the person's post, and never in otto's line", async () => {
    const router = await bootApp();
    const mark = token();
    await postAndSettle(router, mark);

    for (const seat of AGENTS) {
      const heard = (await conversationsHolding(router, seat, mark))
        .flatMap(keptMessages)
        .filter((m) => m.role === "user" && textOf(m).includes(mark))
        .map(textOf);
      expect(heard, `${seat}'s turns carrying the token`).toEqual([
        `${USER} in support.desk: [scenario:reply-in-channel] ${mark} when do refunds post?`,
      ]);
    }
  });
});
