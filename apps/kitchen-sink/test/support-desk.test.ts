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
 *   - the generated map holds `escalate` and no kind of the app's own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowState } from "@flow-state-dev/engine";

vi.setConfig({ testTimeout: 30_000 });

afterEach(async () => {
  const hmr = globalThis as { __fsdFlowstate?: FlowState };
  await hmr.__fsdFlowstate?.dispose();
  delete hmr.__fsdFlowstate;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function boot() {
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
  return { get };
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
