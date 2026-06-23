/**
 * Verifies the live-stream / store status reconciliation used by the DevTool
 * stream view (FIX-811). The cases encode WHY the merge exists, not just the
 * rank arithmetic: a stale closed stream must not mask a fresher store status,
 * while a mid-flight stream transition must still show before the snapshot
 * catches up.
 */
import { describe, expect, it } from "vitest";
import { pickFurthestStatus } from "../src/react/lib/request-status";

describe("pickFurthestStatus", () => {
  it("prefers a mid-flight suspend the snapshot hasn't caught up to", () => {
    // The request paused at a gate; the store row still says in_progress.
    expect(pickFurthestStatus("suspended", "in_progress")).toBe("suspended");
  });

  it("lets a fresher terminal store status win over a stale suspended stream", () => {
    // The regression this guards against: after a same-request resume completes
    // server-side, the closed suspend-run stream is frozen at `suspended`. The
    // store's `completed` must win so a refresh reflects the truth without a
    // full page reload.
    expect(pickFurthestStatus("suspended", "completed")).toBe("completed");
  });

  it("shows a stream terminal status while the snapshot still lags at in_progress", () => {
    expect(pickFurthestStatus("completed", "in_progress")).toBe("completed");
  });

  it("resolves ties to the stream", () => {
    expect(pickFurthestStatus("in_progress", "in_progress")).toBe("in_progress");
    expect(pickFurthestStatus("suspended", "interrupted")).toBe("suspended");
  });

  it("treats unknown statuses as in-flight so they never spuriously win", () => {
    expect(pickFurthestStatus("mystery", "completed")).toBe("completed");
  });
});
