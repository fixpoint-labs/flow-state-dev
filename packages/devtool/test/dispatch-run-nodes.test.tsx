/**
 * A dispatch run reads inside the session that started it, on demand (FIX-1440).
 *
 * The assertion that matters is an ABSENCE: nothing about a run is fetched or
 * rendered until a reader opens it. A dispatcher draining fifty rows leaves
 * fifty nodes here, and loading them eagerly would pour fifty sessions' items
 * into one block tree — the same unreadability the flat session list prevents,
 * moved one surface over. So the read count is asserted, not just the DOM: a
 * version that fetched everything up front and rendered it collapsed would look
 * identical on screen and cost the same fifty requests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ChildSessionSummary } from "@flow-state-dev/client";

const listSessionRequests = vi.fn();

vi.mock("../src/react/context/devtool-context", () => ({
  DevToolProvider: ({ children }: { children: React.ReactNode }) => children,
  useDevTool: () => ({ sessionClient: { listSessionRequests } }),
}));

import { DispatchRunNodes } from "../src/react/components/workspace/dispatch-run-nodes";
import { SelectionProvider } from "../src/react/context/selection-context";
import { DebugProvider } from "../src/react/context/debug-context";
import { TraceLookupProvider } from "../src/react/context/trace-context";

/**
 * The providers the block tree reads, as the panel mounts them. A run's tree is
 * rendered with the same component the session's own blocks use, so it needs
 * the same context.
 */
function mount(ui: React.ReactElement) {
  return render(
    <DebugProvider>
      <TraceLookupProvider requestGroups={[]}>
        <SelectionProvider>{ui}</SelectionProvider>
      </TraceLookupProvider>
    </DebugProvider>
  );
}

const runs: ChildSessionSummary[] = [
  {
    id: "dsx_1",
    parentSessionId: "sess_talk",
    createdAt: 1,
    updatedAt: 2,
    topic: "task|6:issues|6:task-a",
    coordinate: "task:implement",
  },
];

/** One finished request in the run, carrying an item a reader would recognise. */
const runActivity = [
  {
    id: "req_1",
    flowKind: "reports",
    actionName: "implement",
    userId: "u_1",
    status: "completed",
    startedAtMs: 10,
    completedAtMs: 20,
    createdAt: 10,
    updatedAt: 20,
    items: [
      {
        id: "item_1",
        type: "message",
        status: "completed",
        requestId: "req_1",
        itemIndex: 0,
        ts: 11,
        role: "assistant",
        content: "the run said this",
      },
    ],
  },
];

beforeEach(() => {
  listSessionRequests.mockReset();
  listSessionRequests.mockResolvedValue(runActivity);
});

describe("a dispatched run inside its parent's block tree", () => {
  it("renders one collapsed node naming a separate session, and reads nothing", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} onOpen={vi.fn()} />);
    });

    expect(document.querySelector('[data-dispatch-run-node="dsx_1"]')).toBeTruthy();
    expect(screen.getByText(/separate session/)).toBeTruthy();
    // The absence is the assertion.
    expect(listSessionRequests).not.toHaveBeenCalled();
    // The run's first request renders as `#1` once its activity is in hand.
    expect(screen.queryByText("#1")).toBeNull();
  });

  it("loads the run's activity in place when the reader opens it", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} onOpen={vi.fn()} />);
    });

    await act(async () => {
      screen.getByRole("button", { expanded: false }).click();
    });

    await waitFor(() => expect(screen.queryByText("#1")).toBeTruthy());
    expect(listSessionRequests).toHaveBeenCalledWith("dsx_1", { includeItems: true });
    // Opening it reads what the run did. It does not move the workspace: the
    // node is rendered inside the session the reader is already on, and nothing
    // here calls back to select another.
    expect(document.querySelector('[data-dispatch-run-node="dsx_1"]')).toBeTruthy();
  });

  it("reads once, however often the node is opened and closed", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} onOpen={vi.fn()} />);
    });

    const toggle = screen.getByRole("button", { expanded: false });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        toggle.click();
      });
    }

    await waitFor(() => expect(listSessionRequests).toHaveBeenCalledTimes(1));
  });

  it("opens the run as its own session only when asked to", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} onOpen={onOpen} />);
    });

    await act(async () => {
      screen.getByLabelText("Open dispatch run dsx_1").click();
    });

    expect(onOpen).toHaveBeenCalledWith(runs[0]);
  });
});

/**
 * What the surface says when it does NOT have the whole picture (FIX-1440).
 *
 * The Children tab this replaced could say "the read failed" and "there are
 * older runs than these". Without those, a failed read and a session that
 * dispatched nothing render identically, and a truncated list reads as
 * complete — the surface states something false, which is the failure this
 * epic exists to remove.
 *
 * Each case asserts the WARNING, not merely that rows draw: a version that
 * rendered the rows and swallowed the warning passes a row-only assertion,
 * which is exactly the regression being fenced.
 */
describe("the node section tells the reader what it does not know", () => {
  it("reports a failed read instead of rendering as a session that dispatched nothing", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={[]} error="the runs could not be read" onOpen={vi.fn()} />);
    });

    expect(screen.getByRole("alert").textContent).toContain("the runs could not be read");
  });

  it("says it is still reading rather than showing an empty section", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={[]} isLoading onOpen={vi.fn()} />);
    });

    expect(screen.getByTestId("dispatch-runs-loading")).toBeTruthy();
  });

  it("warns that older runs are omitted when the page is not the whole set", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} truncation="more" onOpen={vi.fn()} />);
    });

    expect(screen.getByTestId("dispatch-runs-truncated")).toBeTruthy();
  });

  it("does not warn about omissions when the listing is known complete", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} truncation="complete" onOpen={vi.fn()} />);
    });

    expect(screen.queryByTestId("dispatch-runs-truncated")).toBeNull();
  });

  it("keeps rows visible but flags them when a refresh fails under them", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} error="refresh failed" onOpen={vi.fn()} />);
    });

    // Both halves: the rows the reader already had, and the fact that what
    // they are looking at may no longer be current.
    expect(screen.getByRole("alert").textContent).toContain("refresh failed");
    expect(screen.getByText(/separate session/)).toBeTruthy();
  });

  it("shows the run's own status, the only way a run with no requests reads as started at all", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={[{ ...runs[0], status: "active" }]} onOpen={vi.fn()} />);
    });

    expect(screen.getByTestId("dispatch-run-status-dsx_1").textContent).toContain("active");
  });

  it("says a run has not started when it carries no status at all", async () => {
    await act(async () => {
      mount(<DispatchRunNodes runs={runs} onOpen={vi.fn()} />);
    });

    expect(screen.getByTestId("dispatch-run-status-dsx_1").textContent).toContain("not started");
  });
});
