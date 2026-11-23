import { describe, expect, it, vi } from "vitest";
import { harnessActivityOf, reportHarnessActivity, reportHarnessEvent } from "../src/helpers/harness-activity";

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

  it("never fails the run when the host's async hook rejects: it logs, and the run goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const hook = vi.fn(async () => {
        throw new Error("board unreachable");
      });
      expect(() => reportHarnessActivity(hook, { kind: "tool_call", name: "Bash", arguments: "{}" }, {} as never)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("board unreachable"));
    } finally {
      process.off("unhandledRejection", unhandled);
      warn.mockRestore();
    }
  });

  // FIX-2794.
  it("notes every event, and never fails the run when the host's event hook throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = vi.fn(() => {
      throw new Error("timer gone");
    });
    expect(() => reportHarnessEvent(hook, {} as never)).not.toThrow();
    expect(hook).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("timer gone"));
    expect(() => reportHarnessEvent(undefined, {} as never)).not.toThrow();
    warn.mockRestore();
  });

  // An async event hook that rejects must not reach the host as an unhandled rejection, which can end a Node process.
  it("never fails the run when the host's async event hook rejects: it logs, and the run goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const hook = vi.fn(async () => {
        throw new Error("lock write failed");
      });
      expect(() => reportHarnessEvent(hook, {} as never)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("lock write failed"));
    } finally {
      process.off("unhandledRejection", unhandled);
      warn.mockRestore();
    }
  });
});
