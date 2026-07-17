/**
 * DevToolProvider config sync (FIX-894). The provider must:
 *  - propagate an EXTERNAL config change (a new `initialConfig` prop) into state
 *  - NOT revert an in-panel Settings edit (`setConfig`) back to the prop
 * The second is the trap: keying the sync effect off `state.config` would undo
 * the operator's Settings token on the next run.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

vi.mock("../src/react/lib/client", () => ({
  createDevToolClient: () => ({ listFlows: async () => [] }),
  createDevToolSessionClient: () => ({}),
  createDevToolRecoveryClient: () => ({}),
}));

const { DevToolProvider, useDevTool } = await import("../src/react/context/devtool-context");

type Cfg = { userId: string; bearerToken?: string };

function renderWithConfig(getConfig: () => Cfg) {
  return renderHook(() => useDevTool(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <DevToolProvider initialConfig={getConfig()} userIdControl="internal">
        {children}
      </DevToolProvider>
    ),
  });
}

describe("DevToolProvider — config sync", () => {
  it("preserves a Settings edit against the sync effect (stable prop)", () => {
    const stable: Cfg = { userId: "devuser", bearerToken: undefined };
    const { result, rerender } = renderWithConfig(() => stable);

    act(() => result.current.setConfig({ userId: "devuser", bearerToken: "op-token" }));
    // A no-op re-render (same prop identity, as on a shell focus with static config)
    // must not revert the operator's token.
    act(() => rerender());

    expect(result.current.config.bearerToken).toBe("op-token");
  });

  it("propagates an external prop change (new initialConfig) into state", () => {
    let current: Cfg = { userId: "devuser", bearerToken: "t1" };
    const { result, rerender } = renderWithConfig(() => current);

    expect(result.current.config.bearerToken).toBe("t1");

    current = { userId: "devuser", bearerToken: "t2" };
    act(() => rerender());

    expect(result.current.config.bearerToken).toBe("t2");
  });

  it("keeps an ad-hoc Settings token when a focus re-read changes only userId", () => {
    // The reachable focus-drop: a non-injected shell never carries a bearer prop
    // (readBearerToken → undefined), but userId IS persisted, so a Settings
    // userId change surfaces as a prop change on alt-tab. That external sync must
    // not wipe the operator's ad-hoc token, which lives only in provider state.
    let current: Cfg = { userId: "devuser", bearerToken: undefined };
    const { result, rerender } = renderWithConfig(() => current);

    act(() => result.current.setConfig({ userId: "alice", bearerToken: "op-token" }));
    expect(result.current.config.bearerToken).toBe("op-token");

    // Focus re-read: userId now resolves to the persisted "alice", token prop
    // stays undefined (never injected).
    current = { userId: "alice", bearerToken: undefined };
    act(() => rerender());

    expect(result.current.config.userId).toBe("alice");
    expect(result.current.config.bearerToken).toBe("op-token");
  });

  it("keeps a cleared Settings token when userId prop sync drops stale injected bearer", () => {
    // Partial injection (bearer only): shell boot holds bearerToken="injected" on
    // the prop; focus userId sync must pass bearerToken undefined so merge keeps
    // the operator's cleared token instead of re-authorizing the boot prop.
    let current: Cfg = { userId: "devuser", bearerToken: "injected" };
    const { result, rerender } = renderWithConfig(() => current);

    act(() => result.current.setConfig({ userId: "alice", bearerToken: undefined }));
    expect(result.current.config.bearerToken).toBeUndefined();

    current = { userId: "alice", bearerToken: undefined };
    act(() => rerender());

    expect(result.current.config.userId).toBe("alice");
    expect(result.current.config.bearerToken).toBeUndefined();
  });
});
