// @vitest-environment happy-dom
/**
 * A harness session shows what its latest turn spent (FIX-2398): the model,
 * tokens, the vendor's charge when it reported one, and how long the turn
 * took. The line is read off the turn record the session flow writes when the
 * turn ends (`spend`, `endedAt`), never summed on the page. A subscription
 * turn reports no charge and shows no dollar figure.
 *
 * Red state produced before this was trusted: drop the line from the page,
 * and the first two cases fail (no `turn-spend`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

/** The session state the stubbed hook serves. */
let sessionState: Record<string, unknown> = {};

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
    snapshot: { clientData: { session: sessionState } },
    refresh: async () => undefined,
    sendAction: async () => undefined,
    followRequest: () => undefined,
    abortRequest: async () => undefined,
    detail: undefined,
    isLoading: false,
    isStreaming: false,
    isFinishing: false,
    statusMessage: "",
    latestRequest: { id: "turn-1", status: "completed" },
    followedRequest: { id: "turn-1", status: "completed" },
    items: [{ id: "i1", type: "message", role: "user", requestId: "turn-1", content: [] }],
  }),
}));

vi.mock("@/components/flow-state/request-group", () => ({ RequestGroupRenderer: () => null }));

const { HarnessSessionView } = await import("@/components/harness-session");

afterEach(() => {
  cleanup();
  sessionState = {};
});

const models = { models: [], defaultId: null, reason: null, fallbackId: null };
const mount = () => render(<HarnessSessionView label="Claude Code" flowKind="claude-code-session" sessionId="s1" models={models} />);

/** A turn's spend as `taskSpendView` folds it. */
const spend = (costUsd: number | null) => ({
  harness: "claude-code",
  model: "claude-sonnet-4-5",
  inputTokens: 12_400,
  outputTokens: 2_300,
  costUsd,
  unreported: false,
  live: false,
});

describe("the latest turn's spend", () => {
  it("names the model, tokens, the vendor's charge, and how long the turn took", () => {
    sessionState = { turns: { "turn-1": { at: 1_000, endedAt: 1_000 + 252_000, spend: spend(0.42) } } };
    mount();
    expect(screen.getByTestId("turn-spend").textContent).toBe("claude-sonnet-4-5 · 12.4k in · 2.3k out · $0.42 · 4m 12s");
  });

  it("shows no dollar figure for a turn billed by subscription", () => {
    sessionState = { turns: { "turn-1": { at: 1_000, endedAt: 31_000, spend: spend(null) } } };
    mount();
    const line = screen.getByTestId("turn-spend").textContent ?? "";
    expect(line).toBe("claude-sonnet-4-5 · 12.4k in · 2.3k out · 30s");
    expect(line).not.toContain("$");
  });

  it("shows nothing before the turn's spend is recorded", () => {
    sessionState = { turns: { "turn-1": { at: 1_000, endedAt: null, spend: null } } };
    mount();
    expect(screen.queryByTestId("turn-spend")).toBeNull();
  });
});
