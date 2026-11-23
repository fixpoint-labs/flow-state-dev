/**
 * The flow tree a workforce app shows in the rail (FIX-2875).
 *
 * The tree is the one an operator saw in a workforce app: the default `agent`
 * worker flow holding two workers' sessions, the `coder` flow holding the
 * dispatch runs of two tasks, `github-service` holding one-off deliveries, and
 * two flows nobody talks to. Every id there is a hash, so a rail that prints
 * ids prints nothing an operator can read.
 *
 * The transport is a stubbed `fetch` answering with what the server sends:
 * each flow's `description`, and each session's `label`, which the flow's
 * `session.label` computed from the session's own state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { DevToolProvider } from "../src/react/context/devtool-context";
import { FlowRail } from "../src/react/components/flows/flow-rail";

const flow = (id: string, name: string, cardinality: "singleton" | "collection", description?: string) => ({
  id,
  kind: name,
  cardinality,
  requireUser: false,
  actions: [],
  ...(description === undefined ? {} : { description }),
});

const CLAUDE_CODE_DESCRIPTION = "Where the Claude Code harness records its runs. Nobody talks to it.";
const HARNESSES_DESCRIPTION = "The coding harnesses' readiness and the coding board.";

/** One copy of each worker flow, as workforce registers them. */
const FLOWS = [
  flow("agent", "agent", "collection", "The default worker flow."),
  flow("claude-code", "claude-code", "singleton", CLAUDE_CODE_DESCRIPTION),
  flow("coder", "coder", "collection"),
  flow("github-service", "github-service", "singleton"),
  flow("harnesses", "harnesses", "singleton", HARNESSES_DESCRIPTION),
];

const AMY = "wks_9b744c6dbc4edf6a951b20c1d4e5f60718293a4b";
const RESEARCHER = "wks_51ed356607fb0fecb95623aa01bc02cd03de04ef";
const RUN_A = "dsx_82668ab49c0d1e2f3a4b5c6d7e8f90a1b2c3d4e5";
const RUN_B = "dsx_eea767e884f0e1d2c3b4a5968778695a4b3c2d1e";
const DELIVERY_A = "ephemeral_1763800000000_7c1a2b94dde8";
const DELIVERY_B = "ephemeral_1763800100000_3f0e9d5ebe98";

const SESSIONS: Record<string, Record<string, unknown>[]> = {
  "flowId=agent": [
    { id: AMY, label: "Amy" },
    { id: RESEARCHER, label: "Researcher" },
  ],
  "flowId=coder": [
    // Runs a conversation of the `agent` flow dispatched: the parent is listed
    // under another flow, so they draw at the left margin.
    {
      id: RUN_A,
      label: "Claude Code · FIX-2816",
      parentSessionId: AMY,
      topic: "task|5:board|8:FIX-2816",
      coordinate: "task:work",
    },
    {
      id: RUN_B,
      label: "Claude Code · FIX-2820",
      parentSessionId: AMY,
      topic: "task|5:board|8:FIX-2820",
      coordinate: "task:work",
    },
  ],
  "flowKind=github-service": [{ id: DELIVERY_A }, { id: DELIVERY_B }],
};

function stubTransport() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes("/api/flows/sessions")
        ? {
            sessions: (Object.entries(SESSIONS).find(([key]) => url.includes(key))?.[1] ?? []).map((session) => ({
              flowKind: "x",
              userId: "devuser",
              createdAt: 1,
              updatedAt: 1,
              ...session,
            })),
          }
        : { flows: FLOWS };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

const flowLine = (name: string) => document.querySelector<HTMLButtonElement>(`[data-kind="${name}"]`)!;
const sessionLine = (id: string) => document.querySelector<HTMLButtonElement>(`[data-session-id="${id}"]`);

const open = async (name: string) => {
  await act(async () => {
    flowLine(name).click();
  });
};

beforeEach(() => {
  stubTransport();
  render(
    <DevToolProvider initialConfig={{ userId: "devuser" }} userIdControl="host">
      <FlowRail />
    </DevToolProvider>,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a workforce app's flow tree reads by who and what", () => {
  it("draws a flow with one copy as one level: its sessions hang under the flow's own line", async () => {
    await waitFor(() => expect(flowLine("agent")).toBeTruthy());
    await open("agent");

    // No copy level: with one copy, a second line saying "agent" again tells
    // the operator nothing.
    expect(document.querySelector("[data-instance-id]")).toBeNull();
    await waitFor(() => expect(sessionLine(AMY)).toBeTruthy());
  });

  it("labels a worker's session by the worker, and a dispatch run by its worker and task", async () => {
    await waitFor(() => expect(flowLine("agent")).toBeTruthy());
    await open("agent");
    await open("coder");
    await waitFor(() => expect(sessionLine(RUN_A)).toBeTruthy());

    expect(sessionLine(AMY)!.textContent).toContain("Amy");
    expect(sessionLine(RESEARCHER)!.textContent).toContain("Researcher");
    expect(sessionLine(RUN_A)!.textContent).toContain("Claude Code · FIX-2816");
    expect(sessionLine(RUN_B)!.textContent).toContain("Claude Code · FIX-2820");
  });

  it("keeps raw ids out of the primary text: they are in the tooltip and the copy button only", async () => {
    await waitFor(() => expect(flowLine("agent")).toBeTruthy());
    await open("agent");
    await open("coder");
    await waitFor(() => expect(sessionLine(RUN_A)).toBeTruthy());

    for (const id of [AMY, RESEARCHER, RUN_A, RUN_B]) {
      const line = sessionLine(id)!;
      expect(line.textContent).not.toMatch(/wks_|dsx_/);
      expect(line.getAttribute("title")).toBe(id);
      expect(document.querySelector(`[aria-label="Copy session ID ${id}"]`)).toBeTruthy();
    }
  });

  it("folds one-off deliveries into one closed line with their count", async () => {
    await waitFor(() => expect(flowLine("github-service")).toBeTruthy());
    await open("github-service");

    const group = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("[data-one-off-runs]");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(group.textContent).toContain("One-off runs (2)");
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(sessionLine(DELIVERY_A)).toBeNull();

    await act(async () => {
      group.click();
    });
    expect(sessionLine(DELIVERY_A)).toBeTruthy();
    expect(sessionLine(DELIVERY_B)).toBeTruthy();
  });

  it("says what a flow with no sessions is, so its empty list does not read as a fault", async () => {
    await waitFor(() => expect(flowLine("claude-code")).toBeTruthy());
    await open("claude-code");
    await open("harnesses");

    const leaf = (address: string) => document.querySelector(`[data-leaf="${address}"]`)!;
    await waitFor(() => expect(leaf("claude-code").textContent).toContain("No sessions yet"));
    expect(leaf("claude-code").textContent).toContain(CLAUDE_CODE_DESCRIPTION);
    await waitFor(() => expect(leaf("harnesses").textContent).toContain(HARNESSES_DESCRIPTION));
    // The description is the flow line's tooltip too.
    expect(flowLine("claude-code").getAttribute("title")).toBe(CLAUDE_CODE_DESCRIPTION);
  });
});
