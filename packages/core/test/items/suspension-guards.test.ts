/**
 * Tests for the isSuspensionItem / isSuspensionResumeItem type guards (FIX-276).
 */
import { describe, expect, it } from "vitest";
import type { OutputItem } from "../../src/items";
import { isSuspensionItem, isSuspensionResumeItem } from "../../src/items";

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
      reason: "human_approval",
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
      reason: "human_approval",
      message: "Approve this?"
    };

    expect(isSuspensionResumeItem(item)).toBe(false);
  });

  it("returns false for a status item", () => {
    const item: OutputItem = {
      ...base,
      type: "status",
      status: "streaming",
      message: "Thinking..."
    };

    expect(isSuspensionResumeItem(item)).toBe(false);
  });
});
