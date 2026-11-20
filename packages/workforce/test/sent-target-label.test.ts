// FIX-2848.
/**
 * `sentTargetLabel`: who a sent message went to, in words, from the browser
 * entry, so every app names a task or a conversation it was sent to the same
 * way as workforce's own sent line, instead of "another worker".
 */
import { describe, expect, it } from "vitest";
import { sentTargetLabel } from "../src/browser";

describe("who a sent message went to, in words", () => {
  it("is a worker's id, a task, a conversation, or another worker when the line doesn't say", () => {
    expect(sentTargetLabel("eng.coder")).toBe("eng.coder");
    expect(sentTargetLabel({ task: "task_42" })).toBe("task task_42");
    expect(sentTargetLabel({ session: "s_other" })).toBe("conversation s_other");
    expect(sentTargetLabel(undefined)).toBe("another worker");
  });
});
