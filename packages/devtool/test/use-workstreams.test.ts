/**
 * The Workstreams listing hook (FIX-1071).
 *
 * Two classes of defect live here, and both are invisible rather than loud —
 * the panel renders a plausible list either way, which is what makes them worth
 * pinning:
 *
 * - **A partial list that reads as complete.** The route pages, ordered by
 *   creation time, so a single unparameterized read shows the OLDEST page and
 *   silently omits the newest background work. The panel prints a count beside
 *   it, so the omission states something false.
 * - **A superseded read landing last.** Reads for the same session overlap (the
 *   mount read, the panel's Refresh, the focus revalidation), and the slower
 *   older one arriving last would overwrite newer rows — regressing a row that
 *   has since completed. A session-id guard cannot see this, because both reads
 *   name the same session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { WorkstreamSummary } from "@flow-state-dev/client";

const sessionClientMock = {
  listWorkstreams: vi.fn(),
};
const devToolState = { sessionClient: sessionClientMock };

vi.mock("../src/react/context/devtool-context", () => ({
  useDevTool: () => devToolState,
}));

import { useWorkstreams, MAX_WORKSTREAM_ROWS } from "../src/react/hooks/use-workstreams";

function row(id: string, overrides: Partial<WorkstreamSummary> = {}): WorkstreamSummary {
  return {
    id,
    parentSessionId: "sess_parent",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    ...overrides,
  } as WorkstreamSummary;
}

/** A page of `count` distinct rows, numbered from `from`. */
function page(from: number, count: number): WorkstreamSummary[] {
  return Array.from({ length: count }, (_, i) => row(`dsx_${from + i}`));
}

beforeEach(() => {
  sessionClientMock.listWorkstreams.mockReset().mockResolvedValue([]);
});

describe("useWorkstreams — reading the whole list", () => {
  it("pages until the server runs out instead of showing only the first page", async () => {
    // The route's default page is 25 and it orders by creation time, so
    // stopping after one read hides every workstream created after the 25th.
    sessionClientMock.listWorkstreams
      .mockResolvedValueOnce(page(0, 25))
      .mockResolvedValueOnce(page(25, 25))
      .mockResolvedValueOnce(page(50, 4))
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useWorkstreams("sess_parent"));

    await waitFor(() => expect(result.current.workstreams).toHaveLength(54));
    expect(result.current.truncated).toBe(false);
    // Each read asks for the rows after the ones already held.
    expect(sessionClientMock.listWorkstreams.mock.calls.map((c) => c[1])).toEqual([
      { offset: 0 },
      { offset: 25 },
      { offset: 50 },
      { offset: 54 },
    ]);
  });

  it("never sends a limit, because a host may cap it below whatever we'd pick", async () => {
    // The route REJECTS an out-of-range limit with a 400 rather than clamping,
    // and `maxWorkstreamListLimit` is an operator's setting. Omitting it takes
    // whatever default the deployment runs.
    sessionClientMock.listWorkstreams.mockResolvedValueOnce([]);
    renderHook(() => useWorkstreams("sess_parent"));

    await waitFor(() => expect(sessionClientMock.listWorkstreams).toHaveBeenCalled());
    expect(sessionClientMock.listWorkstreams.mock.calls[0]?.[1]).not.toHaveProperty("limit");
  });

  it("stops at the row bound and says the list is truncated", async () => {
    // The bound exists because every row costs the server a request-store
    // lookup. Hitting it silently would be the same lie as the first-page bug.
    sessionClientMock.listWorkstreams.mockImplementation(
      async (_id: string, opts: { offset: number }) => page(opts.offset, 25)
    );

    const { result } = renderHook(() => useWorkstreams("sess_parent"));

    await waitFor(() => expect(result.current.truncated).toBe(true));
    expect(result.current.workstreams).toHaveLength(MAX_WORKSTREAM_ROWS);
  });
});

describe("useWorkstreams — superseded reads", () => {
  it("drops the previous session's rows before the new session's read lands", async () => {
    sessionClientMock.listWorkstreams
      .mockResolvedValueOnce([row("dsx_parent")])
      .mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useWorkstreams(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );
    await waitFor(() => expect(result.current.workstreams).toHaveLength(1));

    // A read that never resolves stands in for the window between the switch
    // and the new session's response.
    sessionClientMock.listWorkstreams.mockReturnValueOnce(new Promise(() => {}));
    rerender({ sessionId: "sess_child" });

    expect(result.current.workstreams).toEqual([]);
  });

  it("ignores a read that resolves after the session moved on", async () => {
    let resolveParent!: (rows: WorkstreamSummary[]) => void;
    sessionClientMock.listWorkstreams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveParent = resolve as (rows: WorkstreamSummary[]) => void;
      })
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useWorkstreams(sessionId),
      { initialProps: { sessionId: "sess_parent" } }
    );

    sessionClientMock.listWorkstreams.mockResolvedValueOnce([]);
    rerender({ sessionId: "sess_child" });

    // The parent's read comes back late. Applying it would relabel the parent
    // conversation's background work as the child's — rows the user can click.
    await act(async () => {
      resolveParent([row("dsx_parent")]);
    });

    expect(result.current.workstreams).toEqual([]);
  });

  it("does not let an older read for the SAME session overwrite newer rows", async () => {
    // The gap a session-id guard cannot close: both reads name `sess_parent`,
    // so only ordering within the session tells them apart. The older one
    // carries a row still `active` that the newer one already saw complete.
    let resolveMount!: (rows: WorkstreamSummary[]) => void;
    sessionClientMock.listWorkstreams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMount = resolve as (rows: WorkstreamSummary[]) => void;
      })
    );

    const { result } = renderHook(() => useWorkstreams("sess_parent"));

    // A manual Refresh overlapping the mount read, resolving first.
    sessionClientMock.listWorkstreams
      .mockResolvedValueOnce([row("dsx_1", { status: "completed" })])
      .mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.workstreams[0]?.status).toBe("completed");

    // The mount read finally lands, holding the stale pre-completion view.
    await act(async () => {
      resolveMount([row("dsx_1", { status: "active" })]);
    });

    expect(result.current.workstreams[0]?.status).toBe("completed");
  });

  it("retires reads from a superseded client, not just a superseded session", async () => {
    // The session client is rebuilt when `baseUrl` or the bearer token changes,
    // so a response from the old client is answering for a different server.
    let resolveOld!: (rows: WorkstreamSummary[]) => void;
    sessionClientMock.listWorkstreams.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve as (rows: WorkstreamSummary[]) => void;
      })
    );

    const { result, rerender } = renderHook(() => useWorkstreams("sess_parent"));

    devToolState.sessionClient = { listWorkstreams: vi.fn().mockResolvedValue([]) } as never;
    rerender();

    await act(async () => {
      resolveOld([row("dsx_stale")]);
    });

    expect(result.current.workstreams).toEqual([]);

    devToolState.sessionClient = sessionClientMock;
  });
});
