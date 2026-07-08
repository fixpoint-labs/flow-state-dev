/**
 * Unit tests for the ReplayLog (FIX-811).
 *
 * The ReplayLog is the read model the resume runtime consults to decide, per
 * logical block path, whether a block already produced a committed output (so
 * it should be injected rather than re-executed). These tests pin the two
 * load-bearing behaviours: status-based canonical selection keyed by logical
 * path, and pending-suspension identification across N suspend/resume cycles.
 */
import { describe, expect, it } from "vitest";
import type { RuntimeItem } from "../../src/items/internal";
import { buildReplayLog } from "../../src/blocks/internal/replay-log";

const REQ = "req_1";

const baseProv = (blockInstanceId: string) => ({
  blockName: "b",
  blockInstanceId,
  phase: "main" as const,
});

function blockTrace(
  path: string,
  status: "in_progress" | "completed" | "failed",
  itemIndex: number,
  output?: unknown,
): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `trace_${path}_${status}_${itemIndex}`,
    type: "block_trace",
    status,
    blockName: "b",
    blockKind: "handler",
    blockInstanceId,
    requestId: REQ,
    itemIndex,
    provenance: baseProv(blockInstanceId),
    ts: 0,
    output: output === undefined ? undefined : { kind: "inline", value: output },
  } as RuntimeItem;
}

function routerDecisionItem(
  path: string,
  selectedRoute: string,
  itemIndex: number,
): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `decision_${path}_${itemIndex}`,
    type: "router_decision",
    status: "completed",
    requestId: REQ,
    itemIndex,
    provenance: { blockName: "route", blockInstanceId, phase: "main" as const },
    ts: 0,
    routerName: "route",
    selectedRoute,
  } as RuntimeItem;
}

function suspensionItem(
  path: string,
  suspensionId: string,
  itemIndex: number,
): RuntimeItem {
  // Real suspension items are emitted with RUNTIME provenance; the suspending
  // block's identity is carried on the `blockInstanceId` field, not provenance.
  return {
    id: `susp_${suspensionId}`,
    type: "suspension",
    status: "completed",
    suspensionId,
    suspensionStatus: "pending",
    reason: "human_approval",
    message: "approve?",
    blockInstanceId: `${REQ}:${path}:0`,
    requestId: REQ,
    itemIndex,
    provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" as const },
    ts: 0,
  } as RuntimeItem;
}

function suspensionResumeItem(
  path: string,
  suspensionId: string,
  itemIndex: number,
  extra?: { resolution?: "approved" | "rejected"; resumeData?: unknown; resolvedBy?: string },
): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `resume_${suspensionId}`,
    type: "suspension_resume",
    status: "completed",
    suspensionId,
    resolution: extra?.resolution ?? "approved",
    resumeData: extra?.resumeData,
    resolvedBy: extra?.resolvedBy,
    resolvedAt: 0,
    requestId: REQ,
    itemIndex,
    provenance: baseProv(blockInstanceId),
    ts: 0,
  } as RuntimeItem;
}

describe("buildReplayLog", () => {
  describe("getCompletedOutput", () => {
    it("returns the recorded output for a completed logical path", () => {
      const log = buildReplayLog([
        blockTrace("root/step[0]", "completed", 0, { result: 42 }),
      ]);
      expect(log.getCompletedOutput(`${REQ}:root/step[0]`)).toEqual({
        kind: "inline",
        value: { result: 42 },
      });
    });

    it("returns undefined for a path with no completed trace", () => {
      const log = buildReplayLog([
        blockTrace("root/step[0]", "in_progress", 0),
      ]);
      expect(log.getCompletedOutput(`${REQ}:root/step[0]`)).toBeUndefined();
    });

    it("returns undefined for an unknown path", () => {
      const log = buildReplayLog([
        blockTrace("root/step[0]", "completed", 0, 1),
      ]);
      expect(log.getCompletedOutput(`${REQ}:root/step[9]`)).toBeUndefined();
    });

    it("treats a completed block with no output as a hit, not a miss", () => {
      // A void / side-effect-only block records a `completed` trace with no
      // `output`. It must read as a hit (inline undefined) so replay injects it
      // rather than re-running the body — distinct from a genuine cache miss.
      const log = buildReplayLog([blockTrace("root/step[0]", "completed", 0)]);
      expect(log.getCompletedOutput(`${REQ}:root/step[0]`)).toEqual({
        kind: "inline",
        value: undefined,
      });
      expect(log.getCompletedOutput(`${REQ}:root/step[9]`)).toBeUndefined();
    });

    it("selects the completed trace even when an in_progress partial precedes it", () => {
      // run-1 partial (in_progress) then the canonical completed trace.
      const log = buildReplayLog([
        blockTrace("root/step[0]", "in_progress", 0),
        blockTrace("root/step[0]", "completed", 1, "done"),
      ]);
      expect(log.getCompletedOutput(`${REQ}:root/step[0]`)).toEqual({
        kind: "inline",
        value: "done",
      });
    });

    it("prefers the highest-itemIndex completed trace per logical path", () => {
      // A later cycle re-recorded a completed trace for the same path.
      const log = buildReplayLog([
        blockTrace("root/step[0]", "completed", 1, "old"),
        blockTrace("root/step[0]", "completed", 5, "new"),
      ]);
      expect(log.getCompletedOutput(`${REQ}:root/step[0]`)).toEqual({
        kind: "inline",
        value: "new",
      });
    });

    it("resolves a ref output to its canonical inline target at build time", () => {
      const target = blockTrace("root/step[0]", "completed", 0, "payload");
      const refTrace = {
        ...blockTrace("root/step[1]", "completed", 1),
        output: { kind: "ref", sourceItemId: target.id },
      } as RuntimeItem;
      const log = buildReplayLog([target, refTrace]);
      // The ref is materialised to inline so replay never hands downstream a
      // dangling/shadowed ref.
      expect(log.getCompletedOutput(`${REQ}:root/step[1]`)).toEqual({
        kind: "inline",
        value: "payload",
      });
    });
  });

  describe("pendingSuspension", () => {
    it("returns undefined when there is no suspension", () => {
      const log = buildReplayLog([blockTrace("root/step[0]", "completed", 0, 1)]);
      expect(log.pendingSuspension()).toBeUndefined();
    });

    it("identifies an unresolved suspension by its logical path", () => {
      const log = buildReplayLog([
        blockTrace("root/step[0]", "completed", 0, 1),
        suspensionItem("root/step[1]", "susp_a", 1),
      ]);
      expect(log.pendingSuspension()).toEqual({
        blockLogicalId: `${REQ}:root/step[1]`,
        suspensionId: "susp_a",
      });
    });

    it("treats a suspension with a matching suspension_resume as resolved", () => {
      const log = buildReplayLog([
        suspensionItem("root/step[1]", "susp_a", 0),
        suspensionResumeItem("root/step[1]", "susp_a", 1),
      ]);
      expect(log.pendingSuspension()).toBeUndefined();
    });

    it("returns the latest still-pending suspension across cycles", () => {
      // Cycle 1 resolved; cycle 2 still pending.
      const log = buildReplayLog([
        suspensionItem("root/step[1]", "susp_a", 0),
        suspensionResumeItem("root/step[1]", "susp_a", 1),
        suspensionItem("root/step[3]", "susp_b", 2),
      ]);
      expect(log.pendingSuspension()).toEqual({
        blockLogicalId: `${REQ}:root/step[3]`,
        suspensionId: "susp_b",
      });
    });
  });

  describe("resolvedResumes", () => {
    it("returns nothing for a path with no resolved suspension", () => {
      const log = buildReplayLog([suspensionItem("root/step[2]", "susp_a", 0)]);
      expect(log.resolvedResumes(`${REQ}:root/step[2]`)).toEqual([]);
      expect(log.resolvedResumes(`${REQ}:root/step[9]`)).toEqual([]);
    });

    it("returns the recorded resume data for a resolved gate, but not the pending one", () => {
      // Gate 1 (step[2]) resolved with a signal; gate 2 (step[3]) still pending.
      // This is the cold-restart shape: resuming gate 2 must replay gate 1's
      // resolution, while gate 2 itself has no recorded resume yet.
      const log = buildReplayLog([
        suspensionItem("root/step[2]", "susp_a", 0),
        suspensionResumeItem("root/step[2]", "susp_a", 1, { resumeData: { observed: "In Spec Review" } }),
        suspensionItem("root/step[3]", "susp_b", 2),
      ]);
      expect(log.resolvedResumes(`${REQ}:root/step[2]`)).toEqual([
        { data: { observed: "In Spec Review" }, rejected: false, skipped: false, suspensionId: "susp_a", resolvedBy: undefined },
      ]);
      expect(log.resolvedResumes(`${REQ}:root/step[3]`)).toEqual([]);
    });

    it("returns multiple resolutions for one path in original suspend order (loop)", () => {
      const log = buildReplayLog([
        suspensionItem("root/step[1]", "susp_1", 0),
        suspensionResumeItem("root/step[1]", "susp_1", 1, { resumeData: "first" }),
        suspensionItem("root/step[1]", "susp_2", 2),
        suspensionResumeItem("root/step[1]", "susp_2", 3, { resumeData: "second" }),
      ]);
      expect(log.resolvedResumes(`${REQ}:root/step[1]`).map((r) => r.data)).toEqual(["first", "second"]);
    });

    it("marks a rejected resolution and carries resolvedBy for error reconstruction", () => {
      const log = buildReplayLog([
        suspensionItem("root/step[2]", "susp_a", 0),
        suspensionResumeItem("root/step[2]", "susp_a", 1, {
          resolution: "rejected",
          resumeData: { note: "no" },
          resolvedBy: "reviewer",
        }),
      ]);
      expect(log.resolvedResumes(`${REQ}:root/step[2]`)).toEqual([
        { data: { note: "no" }, rejected: true, skipped: false, suspensionId: "susp_a", resolvedBy: "reviewer" },
      ]);
    });

    it("marks a skipped resolution so ctx.suspend() replays the sentinel, not data (FIX-849)", () => {
      const log = buildReplayLog([
        suspensionItem("root/step[2]", "susp_a", 0),
        suspensionResumeItem("root/step[2]", "susp_a", 1, { resolution: "skipped" }),
      ]);
      const [resolved] = log.resolvedResumes(`${REQ}:root/step[2]`);
      expect(resolved.skipped).toBe(true);
      expect(resolved.rejected).toBe(false);
    });
  });

  describe("recordedRouterDecision (FIX-814)", () => {
    it("returns the recorded selection for a router's logical path", () => {
      const log = buildReplayLog([routerDecisionItem("root/step[1]", "branchA", 0)]);
      expect(log.recordedRouterDecision(`${REQ}:root/step[1]`)).toEqual({
        selectedRoute: "branchA",
      });
    });

    it("returns undefined when the router never decided before the interruption", () => {
      const log = buildReplayLog([blockTrace("root/step[0]", "completed", 0, 1)]);
      expect(log.recordedRouterDecision(`${REQ}:root/step[1]`)).toBeUndefined();
    });

    it("keys decisions per router path, not globally", () => {
      const log = buildReplayLog([
        routerDecisionItem("root/step[1]", "branchA", 0),
        routerDecisionItem("root/step[3]", "branchB", 1),
      ]);
      expect(log.recordedRouterDecision(`${REQ}:root/step[1]`)).toEqual({ selectedRoute: "branchA" });
      expect(log.recordedRouterDecision(`${REQ}:root/step[3]`)).toEqual({ selectedRoute: "branchB" });
    });

    it("prefers the highest-itemIndex decision for a path (re-emitted on a later cycle)", () => {
      const log = buildReplayLog([
        routerDecisionItem("root/step[1]", "branchA", 0),
        routerDecisionItem("root/step[1]", "branchA", 7),
      ]);
      expect(log.recordedRouterDecision(`${REQ}:root/step[1]`)).toEqual({ selectedRoute: "branchA" });
    });
  });

  describe("recordedBlockTraceId (FIX-814)", () => {
    it("returns the canonical completed trace id for a logical path", () => {
      const trace = blockTrace("root/branch[a]", "completed", 2, "out");
      const log = buildReplayLog([trace]);
      expect(log.recordedBlockTraceId(`${REQ}:root/branch[a]`)).toBe((trace as { id: string }).id);
    });

    it("returns undefined for a path with no completed trace", () => {
      const log = buildReplayLog([blockTrace("root/branch[a]", "in_progress", 0)]);
      expect(log.recordedBlockTraceId(`${REQ}:root/branch[a]`)).toBeUndefined();
    });

    it("tracks the highest-itemIndex completed trace, matching getCompletedOutput", () => {
      const log = buildReplayLog([
        blockTrace("root/branch[a]", "completed", 1, "old"),
        blockTrace("root/branch[a]", "completed", 5, "new"),
      ]);
      expect(log.recordedBlockTraceId(`${REQ}:root/branch[a]`)).toBe("trace_root/branch[a]_completed_5");
    });
  });
});
