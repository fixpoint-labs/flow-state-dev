import { describe, expect, it, vi } from "vitest";
import { harnessActivityOf, reportHarnessActivity } from "../harness-activity";

describe("a harness run's activity", () => {
  it("is a whole assistant message or a started tool call, in every harness's event names", () => {
    expect(harnessActivityOf({ kind: "message_complete", text: "Tests pass." })).toEqual({ kind: "message", text: "Tests pass." });
    expect(harnessActivityOf({ kind: "message", text: "Tests pass." })).toEqual({ kind: "message", text: "Tests pass." });
    expect(harnessActivityOf({ kind: "tool_call", name: "Edit", arguments: "{}" })).toEqual({ kind: "tool", name: "Edit", arguments: "{}" });
  });

  it("is never a delta, a result or reasoning: those aren't what the run did", () => {
    for (const kind of ["message_delta", "reasoning", "reasoning_complete", "tool_result", "status"]) {
      expect(harnessActivityOf({ kind })).toBeNull();
    }
  });

  it("never fails the run when the host's hook throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = vi.fn(() => {
      throw new Error("board unreachable");
    });
    expect(() => reportHarnessActivity(hook, { kind: "tool_call", name: "Bash", arguments: "{}" }, {} as never)).not.toThrow();
    expect(hook).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
