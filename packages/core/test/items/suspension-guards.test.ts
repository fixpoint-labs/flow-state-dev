/**
 * Tests for the isSuspensionItem / isSuspensionResumeItem type guards (FIX-276).
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "../../src/items";
import { isSuspensionItem, isSuspensionResumeItem, isSuspensionWait } from "../../src/items";

// Minimal fields required by OutputItemBase shared across all item fixtures.
const base = {
  id: "item-1",
  requestId: "req-1",
  itemIndex: 0,
  status: "completed" as const,
  provenance: {
    blockName: "test",
    blockInstanceId: "b1",
    phase: "main" as const
  },
  ts: 0
};

describe("isSuspensionItem", () => {
  it("narrows a suspension item to true", () => {
    const item: OutputItem = {
      ...base,
      type: "suspension",
      suspensionId: "susp-1",
      suspensionStatus: "pending",
      reason: "user_approval",
      message: "Approve this?"
    };

    expect(isSuspensionItem(item)).toBe(true);
  });

  it("returns false for a suspension_resume item", () => {
    const item: OutputItem = {
      ...base,
      type: "suspension_resume",
      suspensionId: "susp-1",
      resolution: "approved",
      resolvedAt: 1000
    };

    expect(isSuspensionItem(item)).toBe(false);
  });

  it("returns false for a message item", () => {
    const item: OutputItem = {
      ...base,
      type: "message",
      role: "assistant",
      content: []
    };

    expect(isSuspensionItem(item)).toBe(false);
  });
});

describe("isSuspensionResumeItem", () => {
  it("narrows a suspension_resume item to true", () => {
    const item: OutputItem = {
      ...base,
      type: "suspension_resume",
      suspensionId: "susp-1",
      resolution: "approved",
      resolvedAt: 1000
    };

    expect(isSuspensionResumeItem(item)).toBe(true);
  });

  it("returns false for a suspension item", () => {
    const item: OutputItem = {
      ...base,
      type: "suspension",
      suspensionId: "susp-1",
      suspensionStatus: "pending",
      reason: "user_approval",
      message: "Approve this?"
    };

    expect(isSuspensionResumeItem(item)).toBe(false);
  });

  it("returns false for a status item", () => {
    const item: OutputItem = {
      ...base,
      type: "status",
      status: "in_progress",
      message: "Thinking..."
    };

    expect(isSuspensionResumeItem(item)).toBe(false);
  });
});

describe("isSuspensionWait", () => {
  const tool = (status: string, error?: { message: string; code?: string }) => ({ ...base, type: "tool_output", status, ...(error ? { error } : {}) });

  it("is a failed tool call coded SUSPENSION: a wait on an answer", () => {
    expect(isSuspensionWait(tool("failed", { message: "Approve?", code: "SUSPENSION" }))).toBe(true);
  });

  it("is not an ordinary failure, a finished call, or another item coded SUSPENSION", () => {
    expect(isSuspensionWait(tool("failed", { message: "boom" }))).toBe(false);
    expect(isSuspensionWait(tool("failed", { message: "boom", code: "E_TIMEOUT" }))).toBe(false);
    expect(isSuspensionWait(tool("completed"))).toBe(false);
    const blockTrace = { ...base, type: "block_trace", status: "failed", error: { message: "Approve?", code: "SUSPENSION" } };
    expect(isSuspensionWait(blockTrace)).toBe(false);
  });
});
