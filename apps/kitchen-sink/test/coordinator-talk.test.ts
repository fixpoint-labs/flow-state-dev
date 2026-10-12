/**
 * Posting to `support.help` the way the page does, through the app's real config.
 *
 * The page opens the person's conversation with the coordinator (a session on
 * `coordinator` naming `support.help`) and posts through its door with the
 * post alone. What it then shows is the conversation's kept messages, read
 * from the session like any conversation. This case holds what that promises
 * on this app's own wiring: the post is kept once, as the person's turn, and a
 * specialist answers it under its own name.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1585/PLAN.md`), re-pointed onto
 * `support.help` by FIX-1611 and onto the coordinator by FIX-1792 (BR-8):
 *
 *   V3 A post lands on the person's conversation with `support.help` once, as
 *      a `user` message. It names no specialist, so the scripted best-fit call
 *      fails and `support.general`, the coordinator's fallback, answers it
 *      under its own name. (The coordinator's own red is `packages/workforce`'s
 *      coordinator suite.)
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

/** The person's conversation with `support.help`, opened as a session on `coordinator` naming it. */
async function openConversation(router: Router): Promise<string> {
  const res = await call(router, "POST", ["coordinator", "sessions"], { userId: "devuser", state: { workerId: "support.help" } });
  expect(res.status, res.text).toBe(201);
  return (JSON.parse(res.text) as { session: { id: string } }).session.id;
}

/** Post the way the page's composer does: the coordinator's door, the post only. */
async function post(router: Router, sessionId: string, message: string) {
  const res = await call(router, "POST", ["coordinator", "actions", "run"], { userId: "devuser", sessionId, input: { message } });
  expect(res.status, res.text).toBe(200);
  return res;
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

/** Wait for the delegate's answer to land. */
async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("V3 · a post from the page, on the app's own coordinator", () => {
  it("is kept once, as the person's turn, and the fallback specialist answers it under its own name", async () => {
    const router = await bootApp();
    const conversation = await openConversation(router);
    const text = `same line ${Date.now()}`;

    await post(router, conversation, text);

    const mine = (await linesOf(router, conversation)).filter((line) => line.text === text);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.role).toBe("user");
    expect(mine[0]?.agentName).toBeUndefined();

    // Best fit cannot pick anyone for a post that names nobody, so the
    // fallback answers, as one line under its own name.
    const answers = async () => {
      const lines = await linesOf(router, conversation);
      return lines.slice(lines.findIndex((line) => line.text === text) + 1);
    };
    await until(async () => (await answers()).length > 0, "the fallback's line");
    expect((await answers()).map((line) => line.agentName)).toEqual(["support.general"]);
  });
});
