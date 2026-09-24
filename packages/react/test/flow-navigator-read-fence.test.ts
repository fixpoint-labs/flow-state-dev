// @vitest-environment happy-dom
/**
 * V4 / BR-11 — the two hazards a leaf read has, and only one of which an
 * `openLeafId !== leafId` guard can see.
 *
 * Both tests resolve their promises OUT OF ORDER on purpose. Resolve them in
 * order and neither half can fail: the late response is the whole hazard.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SessionSummary } from "@flow-state-dev/client";
import { useLeafSessions } from "../src/components/flow-navigator/reads";
import type { FlowNavigatorLeaf } from "../src/components/flow-navigator/grouping";

const row = (id: string): SessionSummary =>
  ({
    id,
    flowKind: "agent",
    userId: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as SessionSummary;

const leaf = (address: string): FlowNavigatorLeaf => ({
  kind: "agent",
  address,
  cardinality: "collection",
});

/** A session source whose every response is held open until the test releases it. */
function deferredSource() {
  const pending: { address: string; release: (rows: SessionSummary[]) => void }[] = [];

  return {
    pending,
    listSessions: vi.fn(
      (options?: { flowId?: string; flowKind?: string }) =>
        new Promise<SessionSummary[]>((resolve) => {
          pending.push({
            address: options?.flowId ?? options?.flowKind ?? "?",
            release: resolve,
          });
        })
    ),
  };
}

describe("useLeafSessions · a response outliving its leaf", () => {
  it("discards leaf A's response when it lands after the hook moved to leaf B", async () => {
    const source = deferredSource();
    const { result, rerender } = renderHook(
      ({ address }: { address: string }) =>
        useLeafSessions(source as never, leaf(address), "u", false, true),
      { initialProps: { address: "seat-a" } }
    );

    await waitFor(() => expect(source.pending).toHaveLength(1));
    rerender({ address: "seat-b" });
    await waitFor(() => expect(source.pending).toHaveLength(2));

    // B lands first, then A — the ordering that makes this fail without a fence.
    await act(async () => {
      source.pending[1]!.release([row("b-1")]);
      await Promise.resolve();
      source.pending[0]!.release([row("a-1")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["b-1"]));
    // Drop the fence and `a-1` is what is on screen, under leaf B.
    expect(result.current.sessions.map((s) => s.id)).toEqual(["b-1"]);
  });
});

describe("useLeafSessions · two reads of ONE leaf racing", () => {
  it("never lets an older response overwrite a newer one for the same leaf", async () => {
    const source = deferredSource();
    const { result } = renderHook(() =>
      useLeafSessions(source as never, leaf("seat-a"), "u", false, true)
    );

    await waitFor(() => expect(source.pending).toHaveLength(1));

    // A host affordance refreshes while the mount read is still in flight.
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(source.pending).toHaveLength(2));

    // Both reads name ONE leaf, so every identity check agrees with both. Only
    // the sequence number can tell the newer from the older.
    await act(async () => {
      source.pending[1]!.release([row("fresh")]);
      await Promise.resolve();
      source.pending[0]!.release([row("stale")]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(["fresh"]);
  });
});

/**
 * A leaf's row stays mounted while it is closed, so closing is not an unmount:
 * it is an identity change the hook has to be told about. Each case below
 * holds a response open across a close, because a source that answers at once
 * has always landed before the close and cannot show what the close retires.
 */
describe("useLeafSessions · a leaf that closes and opens again", () => {
  const mountLeaf = (source: ReturnType<typeof deferredSource>, isOpen: boolean) =>
    renderHook(
      ({ open }: { open: boolean }) =>
        useLeafSessions(source as never, leaf("seat-a"), "u", false, open),
      { initialProps: { open: isOpen } }
    );

  it("asks nothing and holds nothing while closed", async () => {
    const source = deferredSource();
    const { result, rerender } = mountLeaf(source, false);
    expect(source.listSessions).not.toHaveBeenCalled();
    expect(result.current.sessions).toEqual([]);

    rerender({ open: true });
    await waitFor(() => expect(source.pending).toHaveLength(1));
    await act(async () => {
      source.pending[0]!.release([row("a-1")]);
    });
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["a-1"]));

    rerender({ open: false });
    expect(result.current.sessions).toEqual([]);
  });

  it("writes nothing from a read that lands after the leaf closed", async () => {
    const source = deferredSource();
    const { result, rerender } = mountLeaf(source, true);
    await waitFor(() => expect(source.pending).toHaveLength(1));

    rerender({ open: false });
    await act(async () => {
      source.pending[0]!.release([row("late")]);
      await Promise.resolve();
    });

    expect(result.current.sessions).toEqual([]);
    expect(source.listSessions).toHaveBeenCalledTimes(1);
  });

  it("shows nothing of the last visit's rows while a reopened leaf reads again", async () => {
    const source = deferredSource();
    const { result, rerender } = mountLeaf(source, true);
    await waitFor(() => expect(source.pending).toHaveLength(1));
    await act(async () => {
      source.pending[0]!.release([row("first-visit")]);
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(source.pending).toHaveLength(2));

    // The new read is still in flight: the list is loading, not the old one.
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("ignores a refresh captured on an earlier visit", async () => {
    const source = deferredSource();
    const { result, rerender } = mountLeaf(source, true);
    await waitFor(() => expect(source.pending).toHaveLength(1));
    await act(async () => {
      source.pending[0]!.release([row("first-visit")]);
    });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    // A host affordance that held on to this visit's refresh, the way an
    // unmounted toolbar's effect or timer can.
    const staleRefresh = result.current.refresh;

    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(source.pending).toHaveLength(2));
    await act(async () => {
      source.pending[1]!.release([row("second-visit")]);
    });
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(["second-visit"]));

    await act(async () => {
      staleRefresh();
      await Promise.resolve();
    });
    // The earlier visit is over, so its refresh reads nothing.
    expect(source.listSessions).toHaveBeenCalledTimes(2);
  });
});
