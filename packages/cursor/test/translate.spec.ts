/**
 * Translation: one Cursor wire message in, framework vocabulary out.
 *
 * Pure and stateless, so these are the cheapest specs in the package and the
 * ones that go red first when a Cursor bump moves the wire. What they pin is
 * mostly *judgement*: which messages carry something a reader of the stream
 * needs, which are noise, and which degrade rather than break.
 */
import { describe, it, expect } from "vitest";
import { addUsage, normalizeUsage, translateCursorMessage } from "../src/translate";
import type { CursorSdkMessage } from "../src/types";

describe("translateCursorMessage — what reaches the stream", () => {
  it("turns assistant text into a message", () => {
    expect(
      translateCursorMessage({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Wrote notes.md" }] },
      }),
    ).toEqual([{ kind: "message", text: "Wrote notes.md" }]);
  });

  it("turns thinking into reasoning", () => {
    expect(translateCursorMessage({ type: "thinking", text: "weighing options" })).toEqual([
      { kind: "reasoning", text: "weighing options" },
    ]);
  });

  it("opens a tool call while it runs and settles it when it completes", () => {
    const open = translateCursorMessage({
      type: "tool_call",
      call_id: "c1",
      name: "shell",
      status: "running",
      args: { command: "echo hi" },
    });
    const settled = translateCursorMessage({
      type: "tool_call",
      call_id: "c1",
      name: "shell",
      status: "completed",
      args: { command: "echo hi" },
      result: { stdout: "hi\n" },
    });

    expect(open).toEqual([
      { kind: "tool_call", callId: "c1", name: "shell", arguments: '{"command":"echo hi"}' },
    ]);
    expect(settled).toEqual([
      {
        kind: "tool_result",
        callId: "c1",
        name: "shell",
        arguments: '{"command":"echo hi"}',
        output: { stdout: "hi\n" },
        isError: false,
      },
    ]);
  });

  it("marks a failed tool call an error result", () => {
    const [event] = translateCursorMessage({
      type: "tool_call",
      call_id: "c1",
      name: "edit",
      status: "error",
      result: { message: "file not found" },
    });
    expect(event).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("carries the model the run actually used off the init message", () => {
    // The cost estimate is priced against this. A host that left the selection
    // to an account default has no other source for it.
    expect(
      translateCursorMessage({
        type: "system",
        subtype: "init",
        model: { id: "composer-2.5" },
      }),
    ).toContainEqual({ kind: "model", model: "composer-2.5" });
  });

  it("sums a run's usage messages rather than taking the last", () => {
    // One `send` can span several turns, and each reports its own usage. Taking
    // the last would under-report every multi-turn run — silently, and always in
    // the direction that makes a run look cheaper than it was.
    const first = normalizeUsage({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      totalTokens: 120,
    });
    const second = normalizeUsage({
      inputTokens: 200,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheWriteTokens: 2,
      totalTokens: 230,
      reasoningTokens: 7,
    });

    expect(addUsage(addUsage(null, first), second)).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 15,
      cacheWriteTokens: 3,
      totalTokens: 350,
      reasoningTokens: 7,
    });
  });
});

describe("translateCursorMessage — what does NOT reach the stream", () => {
  it("drops the echoed user message", () => {
    // It is the prompt this block just sent. Re-emitting it shows the caller
    // their own words as if the agent had said them.
    expect(
      translateCursorMessage({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "do the thing" }] },
      }),
    ).toEqual([]);
  });

  it("drops a tool_use block inside an assistant message", () => {
    // The same invocation arrives as its own `tool_call` message with a status.
    // Opening it here too would put a second item in the stream that never
    // settles.
    expect(
      translateCursorMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "running it" },
            { type: "tool_use", id: "t1", name: "shell", input: {} },
          ],
        },
      }),
    ).toEqual([{ kind: "message", text: "running it" }]);
  });

  it("does not decide the outcome from a terminal status message", () => {
    // The outcome comes from `run.wait()` and from one place only, so a stream
    // that ends early can never disagree with the SDK about how the run ended.
    const events = translateCursorMessage({ type: "status", status: "FINISHED" });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("status");
  });
});

describe("translateCursorMessage — drift (BP-030)", () => {
  it("an unrecognised message kind becomes a status note, not a failure", () => {
    const [event] = translateCursorMessage({ type: "hologram" } as CursorSdkMessage);
    expect(event).toEqual({
      kind: "status",
      message: "Cursor emitted an unrecognised message: hologram.",
    });
  });

  it("an unrecognised content block becomes a status note beside the text that did arrive", () => {
    const events = translateCursorMessage({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "here" }, { type: "hologram" }],
      },
    } as CursorSdkMessage);
    expect(events).toContainEqual({ kind: "message", text: "here" });
    expect(events.some((e) => e.kind === "status")).toBe(true);
  });

  it("survives a message whose fields are missing or the wrong type", () => {
    // The version gate holds the boundary, but a vendor moving a field WITHIN a
    // message it still calls `tool_call` would crash translation on a wire the
    // gate had already approved.
    expect(() =>
      translateCursorMessage({ type: "tool_call", call_id: 7, name: null } as never),
    ).not.toThrow();
    expect(() =>
      translateCursorMessage({ type: "assistant", message: null } as never),
    ).not.toThrow();
    expect(() => translateCursorMessage({ type: "usage" } as never)).not.toThrow();
  });

  it("never lets a non-numeric token count reach the cost math", () => {
    expect(normalizeUsage({ inputTokens: "lots", outputTokens: NaN })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
    });
  });
});
