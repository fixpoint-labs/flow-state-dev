/**
 * Posting to a channel the way the page does, through the app's real config.
 *
 * The page posts with `{ body }` and no `author`, because the person at it is
 * not a member. What it then shows is the channel's `channel-post` items, read
 * from the session like any conversation. This case holds what that promises
 * on this app's own wiring: the line lands once, it names the server's
 * principal, and a specialist answers it.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1585/PLAN.md`), re-pointed onto
 * `support.help` by FIX-1611:
 *
 *   V3 A post with no author lands on `support.help` once, labelled with the
 *      server's principal (`devuser`). It names no specialist, so the scripted
 *      route's call fails and `support.general`, the channel's fallback,
 *      answers it under its own name (FIX-1611 BR-5). (The built-in kind's own
 *      red is `packages/workforce`'s `channel-post-items.test.ts`.)
 *
 * V4, the `digest` kind's post, left with the kind: this app has no channel
 * kind of its own.
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

/** Wait for the post's separate fan-out request to finish. */
async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("V3 · a post from the page, on the app's own channel", () => {
  it("lands on support.help once, as devuser, and the fallback specialist answers it", async () => {
    const router = await bootApp();
    const text = `same line ${Date.now()}`;

    await post(router, "channel", "support.help", text);

    const mine = (await linesOf(router, "support.help")).filter((line) => line.body === text);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.principal).toBe("devuser");
    expect(mine[0]?.author).toBeUndefined();

    // The route cannot pick anyone for a post that names nobody, so the
    // fallback answers, as one line under its own name.
    const answers = async () => {
      const lines = await linesOf(router, "support.help");
      return lines.slice(lines.findIndex((line) => line.body === text) + 1);
    };
    await until(async () => (await answers()).length > 0, "the fallback's line");
    expect((await answers()).map((line) => line.author)).toEqual(["support.general"]);
  });
});
