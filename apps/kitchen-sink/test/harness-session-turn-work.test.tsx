// @vitest-environment happy-dom
/**
 * Under a harness session's latest turn, the page says what the host ran
 * around it (FIX-2387): the setup command in the session's fresh worktree
 * when it failed, and the checks a finished turn ran. A red check does not
 * fail the turn; the person reads it and decides what to say next.
 *
 * Red state: drop `TurnWork` from the page and every case but the last fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

/** The turn record the mocked session's state carries for request `r1`. */
let turn: Record<string, unknown> = {};

vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  createClient: () => ({ flow: () => ({ send: async () => ({ id: "x" }) }), sessions: { requests: async () => [] } }),
}));

vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
  FlowProvider: ({ children }: { children: ReactNode }) => children,
  useResourceManifest: () => ({ manifest: undefined, error: undefined }),
  useResourceCollectionList: () => ({ items: [], error: undefined }),
  useSession: () => ({
    flowKind: "claude-code-session",
    sessionId: "s1",
    userId: "u",
    snapshot: { clientData: { session: { turns: { r1: turn } } } },
    refresh: async () => undefined,
    sendAction: async () => undefined,
    followRequest: () => undefined,
    abortRequest: async () => undefined,
    detail: undefined,
    isLoading: false,
    isStreaming: false,
    isFinishing: false,
    statusMessage: "",
    latestRequest: { id: "r1", status: "completed" },
    followedRequest: { id: "r1", status: "completed" },
    items: [{ id: "i1", requestId: "r1", type: "message", role: "assistant", status: "completed", content: [] }],
  }),
}));

vi.mock("@/components/flow-state/request-group", () => ({ RequestGroupRenderer: () => null }));

const { HarnessSessionView } = await import("@/components/harness-session");

afterEach(() => cleanup());

const models = { models: [], defaultId: null, reason: null, fallbackId: null };
const page = () =>
  render(<HarnessSessionView label="Claude Code" flowKind="claude-code-session" sessionId="s1" models={models} repoLine={{ conventions: "not loaded", keys: [] }} />);

const check = (command: string, exitCode: number, tail = "") => ({ command, exitCode, timedOut: false, skipped: false, durationMs: 1200, tail });

describe("what the host ran around the latest turn", () => {
  it("shows a red check, with its output, and the turn still reads as finished", () => {
    turn = { asked: null, confirmed: "c1", checks: [check("pnpm typecheck", 0), check("pnpm test", 1, "CHECK-MARKER: 1 failed")] };
    page();
    expect(screen.getByText("Checks 1/2 passed")).toBeTruthy();
    expect(document.body.textContent).toContain("CHECK-MARKER: 1 failed");
    expect(screen.getByTestId("turn-notice").getAttribute("data-kind")).toBe("started");
  });

  it("keeps a long failed check's output in a bounded, scrolling area, so the composer stays on screen", () => {
    turn = { asked: null, confirmed: "c1", checks: [check("pnpm test", 1, "x\n".repeat(400))] };
    page();
    const work = screen.getByTestId("turn-work");
    expect(work.className).toMatch(/\bmax-h-\[/);
    expect(work.className).toMatch(/\boverflow-y-auto\b/);
    expect(work.textContent).toContain("Checks 0/1 passed");
  });

  it("says when the setup command failed, with the end of its output", () => {
    turn = { asked: null, confirmed: "c1", setup: { state: "failed", tail: "SETUP-MARKER: npm ERR" } };
    page();
    const setup = screen.getByTestId("turn-setup");
    expect(setup.getAttribute("data-state")).toBe("failed");
    expect(setup.textContent).toContain("SETUP-MARKER: npm ERR");
  });

  it("says while the setup command runs", () => {
    turn = { asked: null, confirmed: null, setup: { state: "running", tail: null } };
    page();
    expect(screen.getByTestId("turn-setup").getAttribute("data-state")).toBe("running");
  });

  it("says nothing when setup went fine and no check ran", () => {
    turn = { asked: null, confirmed: "c1", setup: { state: "done", tail: null }, checks: null };
    page();
    expect(screen.queryByTestId("turn-setup")).toBeNull();
    expect(screen.queryByText(/^Checks /)).toBeNull();
  });
});
