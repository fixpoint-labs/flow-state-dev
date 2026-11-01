// @vitest-environment happy-dom
/**
 * A harness session's header says what its harness loads from the repository,
 * and which named keys its run is handed (FIX-2421). The line comes from the
 * server (`harness-mode-page.tsx`), worked out from the options the mode's
 * runs are built with; the page only shows it.
 *
 * Red state produced before this was trusted: drop the line from the header,
 * and both cases fail (no `repo-conventions`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  createClient: () => ({ flow: () => ({ send: async () => ({ id: "x" }) }), sessions: { requests: async () => [] } }),
}));

vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  useHarnessLines: (await importOriginal<typeof import("@flow-state-dev/react")>()).useHarnessLines,
  FlowProvider: ({ children }: { children: ReactNode }) => children,
  useResourceManifest: () => ({ manifest: undefined, error: undefined }),
  useResourceCollectionList: () => ({ items: [], error: undefined }),
  useSession: () => ({
    flowKind: "claude-code-session",
    sessionId: "s1",
    userId: "u",
    snapshot: { clientData: { session: {} } },
    refresh: async () => undefined,
    sendAction: async () => undefined,
    followRequest: () => undefined,
    abortRequest: async () => undefined,
    detail: undefined,
    isLoading: false,
    isStreaming: false,
    isFinishing: false,
    statusMessage: "",
    latestRequest: null,
    items: [],
  }),
}));

vi.mock("@/components/flow-state/request-group", () => ({ RequestGroupRenderer: () => null }));

const { HarnessSessionView } = await import("@/components/harness-session");

afterEach(() => cleanup());

const models = { models: [], defaultId: null, reason: null, fallbackId: null };

describe("the session header's repository line", () => {
  it("says the conventions loaded with hooks off, and names the keys passed", () => {
    render(
      <HarnessSessionView
        label="Claude Code"
        flowKind="claude-code-session"
        sessionId="s1"
        models={models}
        repoLine={{ conventions: "loaded, hooks off", keys: ["LINEAR_API_KEY", "GH_TOKEN"] }}
      />,
    );
    expect(screen.getByTestId("repo-conventions").textContent).toBe("loaded, hooks off");
    expect(screen.getByTestId("repo-keys").textContent).toBe("LINEAR_API_KEY, GH_TOKEN");
  });

  it("says not loaded, and names no keys when none are passed", () => {
    render(
      <HarnessSessionView label="Claude Code" flowKind="claude-code-session" sessionId="s1" models={models} repoLine={{ conventions: "not loaded", keys: [] }} />,
    );
    expect(screen.getByTestId("repo-conventions").textContent).toBe("not loaded");
    expect(screen.queryByTestId("repo-keys")).toBeNull();
  });
});
