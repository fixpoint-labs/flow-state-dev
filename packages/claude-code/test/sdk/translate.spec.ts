import { describe, it, expect } from "vitest";
import { createTranslateState, translateSdkMessage } from "../../src/sdk/translate";
import type { SdkMessageLike } from "../../src/sdk/types";

/**
 * Translate a single message against a fresh state and return the events.
 * Defaults to the partials-OFF path so whole-message assistant blocks still
 * surface their text/thinking content (the partials-ON skip is covered by its
 * own dedicated tests with an explicit `createTranslateState({ partialMessages: true })`).
 */
function translateOne(msg: SdkMessageLike) {
  const state = createTranslateState({ partialMessages: false });
  return translateSdkMessage(msg, state);
}

describe("translateSdkMessage", () => {
  it("maps an assistant text block to a message_complete event", () => {
    const events = translateOne({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello world" }] },
    });
    expect(events).toEqual([{ kind: "message_complete", text: "hello world" }]);
  });

  it("maps an assistant thinking block to a reasoning_complete event", () => {
    const events = translateOne({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "let me think" }] },
    });
    expect(events).toEqual([{ kind: "reasoning_complete", text: "let me think" }]);
  });

  it("maps a tool_use block to a tool_call with callId, name, and JSON arguments", () => {
    const events = translateOne({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
      },
    });
    expect(events).toEqual([
      { kind: "tool_call", callId: "toolu_1", name: "Bash", arguments: '{"command":"ls"}' },
    ]);
  });

  it("emits one event per content block when a message carries several", () => {
    const events = translateOne({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "plan" },
          { type: "text", text: "answer" },
          { type: "tool_use", id: "toolu_2", name: "Read", input: { path: "a" } },
        ],
      },
    });
    expect(events.map((e) => e.kind)).toEqual([
      "reasoning_complete",
      "message_complete",
      "tool_call",
    ]);
  });

  it("maps a user tool_result to a tool_result event correlated by tool_use id", () => {
    const state = createTranslateState();
    translateSdkMessage(
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_3", name: "Bash", input: {} }] },
      },
      state,
    );
    const events = translateSdkMessage(
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_3", content: "done" }],
        },
      },
      state,
    );
    expect(events).toEqual([
      { kind: "tool_result", callId: "toolu_3", output: "done", isError: false },
    ]);
    expect(state.openTools.has("toolu_3")).toBe(false);
  });

  it("flags an errored tool_result", () => {
    const events = translateOne({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "boom", is_error: true }],
      },
    });
    expect(events).toEqual([
      { kind: "tool_result", callId: "toolu_x", output: "boom", isError: true },
    ]);
  });

  it("maps a partial stream_event text delta to a message_delta", () => {
    const events = translateOne({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "tok" } },
    });
    expect(events).toEqual([{ kind: "message_delta", text: "tok" }]);
  });

  it("maps a thinking_delta stream_event to a reasoning_delta reading delta.thinking", () => {
    const events = translateOne({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "pondering" },
      },
    });
    expect(events).toEqual([{ kind: "reasoning_delta", text: "pondering" }]);
  });

  it("when partials are ON, an assistant message skips text/thinking blocks (already streamed)", () => {
    const state = createTranslateState({ partialMessages: true });
    const events = translateSdkMessage(
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "answer" },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      state,
    );
    // Only the tool_use survives; text/thinking already streamed as deltas.
    expect(events).toEqual([
      { kind: "tool_call", callId: "toolu_1", name: "Bash", arguments: '{"command":"ls"}' },
    ]);
  });

  it("when partials are OFF, an assistant message still emits text/thinking complete events", () => {
    const state = createTranslateState({ partialMessages: false });
    const events = translateSdkMessage(
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "answer" },
          ],
        },
      },
      state,
    );
    expect(events.map((e) => e.kind)).toEqual(["reasoning_complete", "message_complete"]);
  });

  it("ignores input_json_delta stream events (tool args come from the whole block)", () => {
    const events = translateOne({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"x":' },
      },
    });
    expect(events).toEqual([]);
  });

  it("opens a sub-agent on an Agent tool_use and closes it on its tool_result", () => {
    const state = createTranslateState();
    const open = translateSdkMessage(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { task: "x" } }],
        },
      },
      state,
    );
    expect(open).toEqual([{ kind: "subagent_open", callId: "toolu_agent", name: "Agent" }]);
    expect(state.openSubagents.has("toolu_agent")).toBe(true);

    const close = translateSdkMessage(
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_agent", content: "child done" }],
        },
      },
      state,
    );
    expect(close).toEqual([
      { kind: "subagent_close", callId: "toolu_agent", output: "child done", isError: false },
    ]);
    expect(state.openSubagents.has("toolu_agent")).toBe(false);
  });

  it("maps a successful result to sessionId/usage/costUsd with no error event", () => {
    const events = translateOne({
      type: "result",
      subtype: "success",
      result: "all done",
      session_id: "sess_42",
      usage: { input_tokens: 100, output_tokens: 20 },
      total_cost_usd: 0.05,
    });
    expect(events).toEqual([
      {
        kind: "result",
        subtype: "success",
        finalMessage: "all done",
        sessionId: "sess_42",
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.05,
      },
    ]);
  });

  it("maps an error_max_turns result (errors[]) to an error event plus a result event", () => {
    // Error-subtype results carry `errors: string[]`, never `result`.
    const events = translateOne({
      type: "result",
      subtype: "error_max_turns",
      errors: ["hit the turn limit", "and another detail"],
      session_id: "sess_7",
    });
    expect(events).toEqual([
      { kind: "error", message: "hit the turn limit; and another detail", code: "error_max_turns" },
      {
        kind: "result",
        subtype: "error_max_turns",
        finalMessage: "hit the turn limit; and another detail",
        sessionId: "sess_7",
        usage: null,
        costUsd: null,
      },
    ]);
  });

  it("falls back to a generic message when an error result has neither result nor errors", () => {
    const events = translateOne({
      type: "result",
      subtype: "error_during_execution",
      session_id: "sess_g",
    });
    const error = events.find((e) => e.kind === "error");
    expect(error).toEqual({
      kind: "error",
      message: "Claude Code agent run failed (error_during_execution).",
      code: "error_during_execution",
    });
  });

  it("normalizes error_max_structured_output_retries as a non-success subtype", () => {
    const events = translateOne({
      type: "result",
      subtype: "error_max_structured_output_retries",
      errors: ["gave up retrying"],
      session_id: "sess_r",
    });
    expect(events.map((e) => e.kind)).toEqual(["error", "result"]);
    const result = events.find((e) => e.kind === "result");
    expect(result).toMatchObject({ subtype: "error_max_structured_output_retries" });
  });

  it("drops usage and cost to null when the result omits them", () => {
    const events = translateOne({ type: "result", subtype: "success", session_id: "s" });
    const result = events.find((e) => e.kind === "result");
    expect(result).toMatchObject({ usage: null, costUsd: null, finalMessage: null });
  });

  it("emits a transient status for a system init message", () => {
    const events = translateOne({ type: "system", subtype: "init", session_id: "s" });
    expect(events).toEqual([{ kind: "status", message: "Claude Code agent session started." }]);
  });

  it("threads parent_tool_use_id from a partial stream_event onto the delta event", () => {
    // Sub-agent inner text streams as a partial delta carrying the spawning
    // Task's tool-use id — the emitter needs it to nest under the container.
    const state = createTranslateState({ partialMessages: true });
    const events = translateSdkMessage(
      {
        type: "stream_event",
        parent_tool_use_id: "toolu_task",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
      },
      state,
    );
    expect(events).toEqual([{ kind: "message_delta", text: "hi", parentCallId: "toolu_task" }]);
  });

  it("treats an unrecognized result subtype as an errored outcome, not success", () => {
    // A future SDK failure mode this version doesn't know about must still emit
    // an error event (and not be silently treated as a completed run).
    const events = translateOne({
      type: "result",
      subtype: "error_some_future_mode",
      errors: ["nope"],
      session_id: "s",
    } as SdkMessageLike);
    expect(events.map((e) => e.kind)).toEqual(["error", "result"]);
    expect(events.find((e) => e.kind === "error")).toMatchObject({ code: "error_some_future_mode" });
    // Unknown subtype normalizes to null on the result event (no typed value),
    // but the run is still surfaced as an error above.
    expect(events.find((e) => e.kind === "result")).toMatchObject({ subtype: null });
  });
});
