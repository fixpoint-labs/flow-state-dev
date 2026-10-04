/**
 * The boot serves the support desk the team's files describe: one routed
 * channel, four specialists on the built-in kind, and one board nobody
 * drains.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1611/PLAN.md`, V1):
 *
 *   - the boot hires `support.devices`, `support.accounts`, `support.fsd` and
 *     `support.general`, each on the `agent` kind, and no other seat;
 *   - it opens one channel, `support.help`, on the built-in channel kind;
 *   - it warns once that a board is unattended, and names `escalations`
 *     (BR-12);
 *   - the generated map holds `escalate` and no kind of the app's own;
 *   - the rail lists `support.help` alone under the channel kind, though a
 *     store kept across the upgrade still holds a channel the old roster
 *     declared (BR-1). Red: the rail reading the kind's listing, which draws
 *     `support.desk` beside it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetDeprecationWarningsForTests } from "@flow-state-dev/core";
import type { FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";

vi.setConfig({ testTimeout: 30_000 });

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function boot() {
  // Each boot is a fresh server start. Boot diagnostics print once per process
  // and their claims survive `vi.resetModules()`, so forget them here too.
  __resetDeprecationWarningsForTests();
  vi.resetModules();
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
  vi.stubEnv("STORE_TYPE", "memory");
  vi.stubEnv("WORKFORCE_ADMIN_TOKENS", "");
  vi.stubEnv("GOAL_CONTROL", "");
  const flowstate = (await import("@/fsdev.config")).default as FlowState;
  const router = await flowstate.getRouter();
  const get = async (segments: string[], query = "") => {
    const res = await router.GET(new Request(`http://localhost/api/flows/${segments.join("/")}${query}`), {
      params: { path: segments },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as unknown;
  };
  // The page's session client, over the app's own router.
  const sessions = createSessionClient({
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname
        .replace(/^\/api\/flows\/?/, "")
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
      return await router[method](new Request(url, init), { params: { path } });
    },
  });
  return { get, sessions };
}

describe("V1 · the boot serves one routed channel and four specialists", () => {
  it("hires the four specialists on the agent kind, and no other seat", async () => {
    const { get } = await boot();
    const { flows } = (await get([])) as { flows: Array<{ id: string; kind: string; cardinality: string }> };
    const seats = flows.filter((flow) => flow.cardinality === "collection" && flow.id !== flow.kind);
    expect(seats.map((seat) => [seat.id, seat.kind]).sort()).toEqual([
      ["support.accounts", "agent"],
      ["support.devices", "agent"],
      ["support.fsd", "agent"],
      ["support.general", "agent"],
    ]);
  });

  it("opens one channel, support.help, on the built-in channel kind, beside the app's own flows", async () => {
    const { get } = await boot();
    const { flows } = (await get([])) as { flows: Array<{ id: string; kind: string }> };
    // The workforce's kinds are the two built-ins; the rest are the app's own flows.
    expect([...new Set(flows.map((flow) => flow.kind))].sort()).toEqual([
      "agent",
      "channel",
      "chat-agent",
      "rich-text-component",
      "weekly-digest",
    ]);
    const { sessions } = (await get(["sessions"], "?flowId=channel&limit=100")) as { sessions: Array<{ id: string }> };
    expect(sessions.map((session) => session.id)).toEqual(["support.help"]);
  });

  it("lists support.help alone in the rail, though a kept store still holds a retired channel", async () => {
    const { sessions } = await boot();
    const { railSessions } = await import("@/lib/rail-sessions");
    // What an earlier roster leaves in a store kept across the upgrade: a
    // session of the same channel kind, for a channel the tree no longer declares.
    await sessions.createSession({ flowKind: "channel", userId: "devuser", sessionId: "support.desk" });
    // Not vacuous: the store holds it, and a listing by kind returns it.
    const stored = await sessions.listSessions({ flowKind: "channel", userId: "devuser" });
    expect(stored.map((session) => session.id).sort()).toEqual(["support.desk", "support.help"]);

    // The navigator's own query for a singleton kind's leaf.
    const listed = await railSessions(sessions).listSessions({
      flowKind: "channel",
      userId: "devuser",
      include: "dispatch-runs",
    });
    expect(listed.map((session) => session.id)).toEqual(["support.help"]);
  });

  it("lists every other kind in the rail as the store has it", async () => {
    const { sessions } = await boot();
    const { railSessions } = await import("@/lib/rail-sessions");
    const created = await sessions.createSession({ flowKind: "chat-agent", userId: "devuser" });
    const query = { flowKind: "chat-agent", userId: "devuser" } as const;
    const listed = await railSessions(sessions).listSessions(query);
    expect(listed.map((session) => session.id)).toContain(created.id);
    expect(listed).toEqual(await sessions.listSessions(query));
  });

  it("warns once that a board is unattended, and names support.help's escalations", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
    const unattended = warn.mock.calls.map((call) => call.join(" ")).filter((line) => line.includes("holds board"));
    expect(unattended).toHaveLength(1);
    expect(unattended[0]).toContain('channel "support.help" holds board "escalations"');
  });

  it("generates escalate into the catalog, and no kind of the app's own", async () => {
    const generated = await import("@/workforce/workforce.gen");
    expect(Object.keys(generated.kinds)).toEqual([]);
    expect(Object.keys(generated.channelKinds)).toEqual([]);
    expect(Object.keys(generated.blocks)).toEqual(["escalate"]);
  });
});
