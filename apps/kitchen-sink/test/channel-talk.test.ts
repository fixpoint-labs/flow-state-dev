/**
 * Posting to a channel the way the page does, through the app's real config.
 *
 * The page posts with `{ body }` and no `author`, because the person at it is
 * not a member. What it then shows is the channel's `channel-post` items, read
 * from the session like any conversation. These cases hold what that promises
 * on this app's own wiring: which channel the line lands in, who it names,
 * who is woken, and what the app's own `digest` kind does with the same post.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1585/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V3 A post with no author lands on `support.desk` only, labelled with the
 *      server's principal (`devuser`), and the app's notify block runs once
 *      for each member of that channel. A `digest` post lands with no
 *      principal, runs no notify block, and `read` still returns the tail.
 *      Red: the `digest` kind copying the notice into state and emitting no
 *      item — the post leaves nothing for the page to read. (The built-in
 *      kind's own red is `packages/workforce`'s `channel-post-items.test.ts`.)
 *   V4 A `digest` post leaves one `channel-post` item, and `read` counts the
 *      tail from the items. Red: the same.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

// Each case boots the whole app afresh, and the first import is cold.
vi.setConfig({ testTimeout: 30_000 });

type Router = Awaited<ReturnType<FlowState["getRouter"]>>;

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
});

async function bootApp(): Promise<Router> {
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
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

/** Post the way the page's composer does: the channel's own action, body only. */
async function post(router: Router, flowId: string, sessionId: string, body: string) {
  const res = await call(router, "POST", [flowId, "actions", "post"], { userId: "devuser", sessionId, input: { body } });
  expect(res.status, res.text).toBe(200);
  return res;
}

type Line = { id: string; body: string; principal?: string; author?: string };

/** The channel's lines as the page reads them: its session's `channel-post` items. */
async function linesOf(router: Router, sessionId: string): Promise<Line[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=component&limit=1000");
  expect(res.status, res.text).toBe(200);
  const items = (JSON.parse(res.text) as { items?: Array<{ component?: string; data?: Line }> }).items ?? [];
  return items.filter((item) => item.component === "channel-post").map((item) => item.data!);
}

/**
 * Every member the app's notify block was run for on this channel, read off
 * the block's own completed traces. Its message items are transient, so the
 * trace is the durable record of a delivery.
 */
async function notifiedOn(router: Router, sessionId: string): Promise<string[]> {
  const res = await call(router, "GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&item_types=block_trace&limit=5000");
  const items = (JSON.parse(res.text) as { items?: Array<{ blockName?: string; status?: string; output?: { value?: { notified?: string } } }> }).items ?? [];
  return items
    .filter((item) => item.blockName === "kitchen-sink-notify-member" && item.status === "completed")
    .map((item) => item.output?.value?.notified ?? "");
}

/** Wait for the post's separate fan-out request to finish. */
async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const DESK_MEMBERS = ["support.ada", "support.grace", "support.iris", "support.otto", "support.wren"];

describe("V3 · a post from the page, on the app's own channels", () => {
  it("lands on the channel it was sent to only, as devuser, and wakes each member once", async () => {
    const router = await bootApp();
    const text = `same line ${Date.now()}`;

    await post(router, "channel", "support.desk", text);

    const desk = (await linesOf(router, "support.desk")).filter((line) => line.body === text);
    expect(desk).toHaveLength(1);
    expect(desk[0]?.principal).toBe("devuser");
    expect(desk[0]?.author).toBeUndefined();
    expect((await linesOf(router, "support.ada-wren")).some((line) => line.body === text)).toBe(false);

    // Nobody is skipped: the poster is not a member, so nobody is the writer.
    await until(async () => (await notifiedOn(router, "support.desk")).length >= DESK_MEMBERS.length, "the fan-out");
    expect((await notifiedOn(router, "support.desk")).sort()).toEqual(DESK_MEMBERS);

    // The same text to the other channel lands there only.
    await post(router, "channel", "support.ada-wren", text);
    expect((await linesOf(router, "support.ada-wren")).filter((line) => line.body === text)).toHaveLength(1);
    expect((await linesOf(router, "support.desk")).filter((line) => line.body === text)).toHaveLength(1);
  });

  it("lands a digest post with no principal, wakes nobody, and keeps read to the tail", async () => {
    const router = await bootApp();
    const bodies = Array.from({ length: 7 }, (_, i) => `notice ${i}`);
    for (const body of bodies) await post(router, "digest", "support.noticeboard", body);

    // V4: one item per post, carrying the line, and no principal on it.
    const lines = await linesOf(router, "support.noticeboard");
    expect(lines.map((line) => line.body)).toEqual(bodies);
    expect(lines.every((line) => line.principal === undefined)).toBe(true);

    // No notify step on this kind: nothing ran on the channel but its posts.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await notifiedOn(router, "support.noticeboard")).toEqual([]);

    // `read` still returns the last five, newest first, counted from the items.
    const read = await call(router, "POST", ["digest", "actions", "read"], {
      userId: "devuser",
      sessionId: "support.noticeboard",
      input: {},
    });
    expect(read.status, read.text).toBe(200);
    const readOutput = readOutputOf(read.text);
    expect(readOutput.notices.map((n) => n.body)).toEqual(["notice 6", "notice 5", "notice 4", "notice 3", "notice 2"]);
    expect(readOutput.total).toBe(7);
  });
});

/**
 * What `read` returned, off the wire. The action route streams the request's
 * items, and the handler's output rides on its trace's completing patch.
 */
function readOutputOf(sse: string): { notices: Array<{ body: string }>; total: number } {
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5).trim()) as {
      type?: string;
      patch?: { status?: string; output?: { kind?: string; value?: { notices?: unknown } } };
    };
    const output = event.patch?.output;
    if (event.type === "item.updated" && output?.kind === "inline" && Array.isArray(output.value?.notices)) {
      return output.value as { notices: Array<{ body: string }>; total: number };
    }
  }
  throw new Error(`no completed read output in the stream:\n${sse.slice(0, 2000)}`);
}
