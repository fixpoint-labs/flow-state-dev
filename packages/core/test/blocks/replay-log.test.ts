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

function suspensionItem(
  path: string,
  suspensionId: string,
  itemIndex: number,
): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `susp_${suspensionId}`,
    type: "suspension",
    status: "completed",
    suspensionId,
    suspensionStatus: "pending",
    reason: "human_approval",
    message: "approve?",
    requestId: REQ,
    itemIndex,
    provenance: baseProv(blockInstanceId),
    ts: 0,
  } as RuntimeItem;
}

function suspensionResumeItem(
  path: string,
  suspensionId: string,
  itemIndex: number,
): RuntimeItem {
  const blockInstanceId = `${REQ}:${path}:0`;
  return {
    id: `resume_${suspensionId}`,
    type: "suspension_resume",
    status: "completed",
    suspensionId,
    resolution: "approved",
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
});
