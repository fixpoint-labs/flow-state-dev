/**
 * Opening a run from its address: `?session=<id>`, the link a host such as App
 * Lab's task inspector hands out.
 *
 * What matters is that the link lands on the run with no paste step, and that
 * it lands under the instance the session actually belongs to. An id is only an
 * address: the session is read, its owner found by the ownership predicate, and
 * a session no listed instance owns opens nothing and says so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { FlowListEntry } from "@flow-state-dev/client";
import { ClientHttpError } from "@flow-state-dev/client";

const listFlows = vi.fn();
const getSession = vi.fn();

vi.mock("../src/react/lib/client", () => ({
  createDevToolClient: () => ({ listFlows }),
  createDevToolSessionClient: () => ({ getSession }),
  createDevToolRecoveryClient: () => ({ checkInterrupted: vi.fn().mockResolvedValue([]) }),
  createDevToolResourceClient: () => ({}),
}));

import { DevToolProvider, useDevTool } from "../src/react/context/devtool-context";
import { readSessionAddress, writeSessionHint } from "../src/react/config";

const seatA: FlowListEntry = { id: "eng.em", kind: "em", cardinality: "collection", requireUser: false, actions: [] };
const seatB: FlowListEntry = { id: "eng.coder", kind: "coder", cardinality: "collection", requireUser: false, actions: [] };

let ctx: ReturnType<typeof useDevTool>;
function Probe() {
  ctx = useDevTool();
  return null;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mount(openSessionId?: string, userId = "u1") {
  await act(async () => {
    render(
      <DevToolProvider initialConfig={{ userId }} baseUrl={undefined} {...(openSessionId === undefined ? {} : { openSessionId })}>
        <Probe />
      </DevToolProvider>,
    );
  });
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe("opening a session from its address", () => {
  beforeEach(() => {
    localStorage.clear();
    // A fresh array per read, as the wire gives one.
    listFlows.mockReset().mockImplementation(async () => [seatA, seatB]);
    getSession.mockReset();
  });

  it("opens the named session under the instance that owns it, not the first listed", async () => {
    getSession.mockResolvedValue({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "u1" });

    await mount("dsx_run");

    expect(getSession).toHaveBeenCalledWith("dsx_run");
    expect(ctx.activeFlowId).toBe("eng.coder");
    expect(ctx.activeSessionId).toBe("dsx_run");
    expect(ctx.sessionAddressError).toBeNull();
  });

  it("opens nothing and says why when no listed instance owns the session", async () => {
    getSession.mockResolvedValue({ id: "dsx_run", flowId: "elsewhere", flowKind: "coder", userId: "u1" });

    await mount("dsx_run");

    expect(ctx.activeFlowId).toBeNull();
    expect(ctx.activeSessionId).toBeNull();
    expect(ctx.sessionAddressError).toMatch(/dsx_run/);
  });

  it("opens nothing when the session is another user's", async () => {
    getSession.mockResolvedValue({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "someone-else" });

    await mount("dsx_run");

    expect(ctx.activeSessionId).toBeNull();
    expect(ctx.sessionAddressError).toMatch(/dsx_/);
  });

  it("opens nothing and reports the refusal when the server refuses the read", async () => {
    getSession.mockRejectedValue(new ClientHttpError("session not found", { status: 404, body: null }));

    await mount("dsx_gone");

    expect(ctx.activeSessionId).toBeNull();
    expect(ctx.sessionAddressError).toMatch(/dsx_/);
  });

  it("wins over a saved session for the owning instance, even when that instance opens first", async () => {
    // The operator was last on dsx_old under the coder seat. The link names
    // dsx_run under the same seat. The saved session must not take the
    // workspace while the link's read is still in flight.
    writeSessionHint({ baseUrl: undefined, userId: "u1", flowId: "eng.coder" }, "dsx_old");
    const linkRead = deferred<unknown>();
    getSession.mockImplementation((id: string) =>
      id === "dsx_run"
        ? linkRead.promise
        : Promise.resolve({ id, flowId: "eng.coder", flowKind: "coder", userId: "u1" }),
    );

    await mount("dsx_run");
    // Opening the owning row is what would restore its saved session.
    act(() => ctx.selectInstance("eng.coder"));
    await settle();
    expect(ctx.activeSessionId).toBeNull();

    linkRead.resolve({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "u1" });
    await settle();

    expect(ctx.activeFlowId).toBe("eng.coder");
    expect(ctx.activeSessionId).toBe("dsx_run");
  });

  it("restores the saved session once the link has settled without opening anything", async () => {
    writeSessionHint({ baseUrl: undefined, userId: "u1", flowId: "eng.coder" }, "dsx_old");
    getSession.mockImplementation((id: string) =>
      id === "dsx_gone"
        ? Promise.reject(new ClientHttpError("session not found", { status: 404, body: null }))
        : Promise.resolve({ id, flowId: "eng.coder", flowKind: "coder", userId: "u1" }),
    );

    await mount("dsx_gone");
    act(() => ctx.selectInstance("eng.coder"));
    await settle();

    expect(ctx.activeSessionId).toBe("dsx_old");
  });

  it("leaves the link to the operator when they pick a session while it is being read", async () => {
    const linkRead = deferred<unknown>();
    getSession.mockImplementation(() => linkRead.promise);

    await mount("dsx_run");
    act(() => ctx.selectWorkspace("eng.em", "dsx_mine"));
    linkRead.resolve({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "u1" });
    await settle();

    expect(ctx.activeSessionId).toBe("dsx_mine");
  });

  it("does not give up on a read that failed for a reason that may pass, and retries when the catalog reloads", async () => {
    getSession
      .mockRejectedValueOnce(new ClientHttpError("unavailable", { status: 503, body: null }))
      .mockResolvedValue({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "u1" });

    await mount("dsx_run");
    expect(ctx.activeSessionId).toBeNull();
    expect(ctx.sessionAddressError).toMatch(/dsx_run/);

    await act(async () => {
      await ctx.refreshFlows();
    });
    await settle();

    expect(ctx.activeSessionId).toBe("dsx_run");
    expect(ctx.sessionAddressError).toBeNull();
  });

  it("stops retrying once the operator picks a session after a read that may pass", async () => {
    getSession
      .mockRejectedValueOnce(new ClientHttpError("unavailable", { status: 503, body: null }))
      .mockResolvedValue({ id: "dsx_run", flowId: "eng.coder", flowKind: "coder", userId: "u1" });

    await mount("dsx_run");
    act(() => ctx.selectWorkspace("eng.em", "dsx_mine"));
    await act(async () => {
      await ctx.refreshFlows();
    });
    await settle();

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(ctx.activeSessionId).toBe("dsx_mine");
  });

  it("treats a refusal as final: a catalog reload does not read the session again", async () => {
    getSession.mockRejectedValue(new ClientHttpError("session not found", { status: 404, body: null }));

    await mount("dsx_gone");
    await act(async () => {
      await ctx.refreshFlows();
    });
    await settle();

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("clears the reason the link failed once the operator picks a session", async () => {
    getSession.mockRejectedValue(new ClientHttpError("session not found", { status: 404, body: null }));

    await mount("dsx_gone");
    expect(ctx.sessionAddressError).toMatch(/dsx_gone/);

    act(() => ctx.selectWorkspace("eng.em", "dsx_mine"));

    expect(ctx.sessionAddressError).toBeNull();
  });

  it("reads nothing and opens nothing without an address", async () => {
    await mount(undefined);

    expect(getSession).not.toHaveBeenCalled();
    expect(ctx.activeSessionId).toBeNull();
    expect(ctx.sessionAddressError).toBeNull();
  });
});

describe("readSessionAddress", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads ?session=<id> off the page address", () => {
    window.history.replaceState(null, "", "/?session=dsx_abc");
    expect(readSessionAddress()).toBe("dsx_abc");
  });

  it("is undefined when the page names no session", () => {
    window.history.replaceState(null, "", "/?other=1");
    expect(readSessionAddress()).toBeUndefined();
    window.history.replaceState(null, "", "/?session=");
    expect(readSessionAddress()).toBeUndefined();
  });
});
