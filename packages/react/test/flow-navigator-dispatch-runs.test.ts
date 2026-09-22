// @vitest-environment happy-dom
/**
 * The navigator's dispatch-run rows (FIX-1440).
 *
 * Two things are under test and they fail differently. `arrangeSessionRows`
 * decides WHERE a run is drawn, and its cases are the ones a tree would get
 * wrong — a run of a run indenting twice, a run whose parent is not in the
 * listing indenting under nothing. The rendered cases cover the other half: the
 * include is off unless a host asks for it, and asking changes the request the
 * navigator sends rather than only what it draws.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import { FlowNavigator } from "../src/components/flow-navigator/FlowNavigator";
import { arrangeSessionRows } from "../src/components/flow-navigator/dispatch-runs";

afterEach(cleanup);

const row = (id: string, parentSessionId?: string): SessionSummary =>
  ({
    id,
    flowKind: "reports",
    userId: "u",
    createdAt: 1,
    updatedAt: 1,
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
  }) as unknown as SessionSummary;

describe("arrangeSessionRows", () => {
  it("draws a run one level under the session that started it", () => {
    const arranged = arrangeSessionRows([row("sess_talk"), row("dsx_1", "sess_talk")]);

    expect(arranged.map((entry) => [entry.session.id, entry.depth])).toEqual([
      ["sess_talk", 0],
      ["dsx_1", 1],
    ]);
  });

  it("indents a run started by a run ONCE, beside its own parent", () => {
    // The rule that keeps this a view. A second level here is the Children tab
    // returning under a new name: a hierarchy to walk rather than one to read.
    const arranged = arrangeSessionRows([
      row("sess_talk"),
      row("dsx_1", "sess_talk"),
      row("dsx_2", "dsx_1"),
    ]);

    expect(arranged.map((entry) => [entry.session.id, entry.depth])).toEqual([
      ["sess_talk", 0],
      ["dsx_1", 1],
      ["dsx_2", 1],
    ]);
  });

  it("keeps a run whose parent is not in the listing at the left margin, with its provenance", () => {
    const arranged = arrangeSessionRows([row("dsx_orphan", "sess_elsewhere")]);

    // Drawn where the server put it — indentation is presentation over what is
    // on screen, never a reason to fetch the parent.
    expect(arranged[0].depth).toBe(0);
    expect(arranged[0].parentSessionId).toBe("sess_elsewhere");
  });

  it("returns a listing with no runs in it untouched", () => {
    const arranged = arrangeSessionRows([row("a"), row("b")]);

    expect(arranged.map((entry) => [entry.session.id, entry.depth])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("does not hang on a record whose parent chain loops", () => {
    // The engine cannot write one — a run's id is derived from its parent — but
    // this renders whatever the store hands back, and a list that hangs is
    // worse than a row drawn in the wrong place.
    const arranged = arrangeSessionRows([row("a", "b"), row("b", "a")]);

    expect(arranged).toHaveLength(2);
  });
});

function server(rows: SessionSummary[]) {
  const listSessions = vi.fn(async () => rows);
  return {
    listSessions,
    client: { listFlows: vi.fn(async (): Promise<FlowListEntry[]> => [
      { id: "reports", kind: "reports", cardinality: "singleton", requireUser: false, actions: [] },
    ]) },
  };
}

describe("FlowNavigator — asking for dispatch runs", () => {
  it("does not ask for them unless the host says so", async () => {
    const { listSessions, client } = server([row("sess_talk")]);

    render(
      createElement(FlowNavigator, {
        sections: [{ label: "Flows" }],
        client,
        sessionClient: { listSessions },
        userId: "u",
        onSelectSession: () => {},
      })
    );

    await screen.findByText("reports");
    screen.getByText("reports").click();

    await waitFor(() => expect(listSessions).toHaveBeenCalled());
    // The default is the request this component has always sent. A host that
    // wants machine sessions asks for them.
    expect(listSessions.mock.calls[0]?.[0]).not.toHaveProperty("include");
  });

  it("passes the caller-facing include, and marks the row it brings back", async () => {
    const { listSessions, client } = server([row("sess_talk"), row("dsx_1", "sess_talk")]);

    render(
      createElement(FlowNavigator, {
        sections: [{ label: "Flows" }],
        client,
        sessionClient: { listSessions },
        userId: "u",
        includeDispatchRuns: true,
        onSelectSession: () => {},
      })
    );

    await screen.findByText("reports");
    screen.getByText("reports").click();

    await waitFor(() => expect(listSessions).toHaveBeenCalled());
    expect(listSessions.mock.calls[0]?.[0]).toMatchObject({ include: "dispatch-runs" });

    // The row says whose work it is, so a host slot can label it without
    // re-deriving the parentage the navigator already read.
    await waitFor(() =>
      expect(
        document.querySelector('[data-session-id="dsx_1"]')?.getAttribute("data-dispatch-run-of")
      ).toBe("sess_talk")
    );
  });
});
