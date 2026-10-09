/**
 * The boot serves the support desk the team's files describe: one best-fit
 * coordinator, `support.help`, and four specialists on the built-in `agent`
 * flow.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1611/PLAN.md`, V1, converted by
 * `specs/issues/FIX-1792/PLAN.md`, S6):
 *
 *   - the boot runs `support.devices`, `support.accounts`, `support.fsd` and
 *     `support.general` on one copy of `agent`, and `support.help` on one copy
 *     of `coordinator`, and no copy per worker;
 *   - it serves the coordinator flow beside the app's own flows, and no
 *     mailbox flow;
 *   - the generated map holds no block and no kind of the app's own (the
 *     `escalate` block went with the escalation feature);
 *   - the rail lists `support.help` under the coordinator kind as the person's
 *     one conversation with it, found by the coordinator's id (BR-7a). Red:
 *     the rail reading the kind's listing, which on a fresh store lists
 *     nothing.
 *
 * FIX-1611's BR-12 (the boot warns that `escalations` is unattended) left with
 * the board: the escalation feature is removed, and no file declares a board.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetDeprecationWarningsForTests } from "@flow-state-dev/core";
import type { FlowState } from "@flow-state-dev/engine";
import { createSessionClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

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
  const sessionsFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname
      .replace(/^\/api\/flows\/?/, "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent);
    const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
    return await router[method](new Request(url, init), { params: { path } });
  };
  const sessions = createSessionClient({ fetcher: sessionsFetcher });
  // The page's workforce client, over the same router.
  const workforce = createWorkforceClient({ userId: "devuser", fetcher: sessionsFetcher });
  return { get, sessions, workforce };
}

describe("V1 · the boot serves one best-fit coordinator and four specialists", () => {
  it("runs the specialists on one copy of agent and support.help on one copy of coordinator, and no copy per worker", async () => {
    const { get, workforce } = await boot();
    const roster = await workforce.roster();
    expect(roster.map((worker) => [worker.id, worker.flow, worker.standard]).sort()).toEqual([
      ["support.accounts", "agent", true],
      ["support.devices", "agent", true],
      ["support.fsd", "agent", true],
      ["support.general", "agent", true],
      ["support.help", "coordinator", true],
    ]);
    const { flows } = (await get([])) as { flows: Array<{ id: string; kind: string }> };
    expect(flows.filter((flow) => flow.kind === "agent").map((flow) => flow.id)).toEqual(["agent"]);
    expect(flows.filter((flow) => flow.kind === "coordinator").map((flow) => flow.id)).toEqual(["coordinator"]);
    expect(flows.filter((flow) => roster.some((worker) => worker.id === flow.id))).toEqual([]);
  });

  it("serves the coordinator flow beside the app's own flows, and no mailbox flow", async () => {
    const { get } = await boot();
    const { flows } = (await get([])) as { flows: Array<{ id: string; kind: string }> };
    // The workforce's kinds are the built-ins: `agent`, `coordinator` and the roster flow. The rest are the app's own flows.
    expect([...new Set(flows.map((flow) => flow.kind))].sort()).toEqual([
      "agent",
      "chat-agent",
      "coordinator",
      "rich-text-component",
      "weekly-digest",
      "workforce-roster",
    ]);
  });

  it("lists support.help in the rail as the person's one conversation with it, a session on coordinator naming it", async () => {
    const { sessions, workforce } = await boot();
    const { railSessions } = await import("@/lib/rail-sessions");
    // Not vacuous: on a fresh store the coordinator kind's own listing holds nothing.
    expect(await sessions.listSessions({ flowKind: "coordinator", userId: "devuser" })).toEqual([]);

    // The navigator's own query for the kind's leaf.
    const query = { flowKind: "coordinator", userId: "devuser", include: "dispatch-runs" } as const;
    const listed = await railSessions(sessions, workforce).listSessions(query);
    expect(listed.map((session) => [session.title, session.flowKind])).toEqual([["support.help", "coordinator"]]);
    // The same conversation every time, and the one the coordinator's id finds (BR-7a).
    const again = await railSessions(sessions, workforce).listSessions(query);
    expect(again.map((session) => session.id)).toEqual(listed.map((session) => session.id));
    expect((await workforce.findWorkerSession({ worker: "support.help" }))?.id).toBe(listed[0]!.id);
  });

  it("lists every other kind in the rail as the store has it", async () => {
    const { sessions, workforce } = await boot();
    const { railSessions } = await import("@/lib/rail-sessions");
    const created = await sessions.createSession({ flowKind: "chat-agent", userId: "devuser" });
    const query = { flowKind: "chat-agent", userId: "devuser" } as const;
    const listed = await railSessions(sessions, workforce).listSessions(query);
    expect(listed.map((session) => session.id)).toContain(created.id);
    expect(listed).toEqual(await sessions.listSessions(query));
  });

  it("generates no block and no kind of the app's own", async () => {
    const generated = await import("@/workforce/workforce.gen");
    expect(Object.keys(generated.kinds)).toEqual([]);
    expect(Object.keys(generated.mailboxKinds)).toEqual([]);
    expect(Object.keys(generated.blocks)).toEqual([]);
  });
});
