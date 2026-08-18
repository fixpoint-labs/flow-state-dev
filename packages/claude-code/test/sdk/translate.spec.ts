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

/**
 * The work-recording half of translation.
 *
 * Every scripted shape below is one a REAL run produced, measured against
 * `claude` 2.1.234 — the binary the pinned SDK spawns. That matters more than
 * usual here: the failure this design is most exposed to is a recorder that
 * records nothing while every test passes, because the fixture fires a tool the
 * harness never sends.
 */
describe("translateSdkMessage — observed work", () => {
  /** Run a whole script against ONE state, so calls and results correlate. */
  function translateScript(msgs: SdkMessageLike[]) {
    const state = createTranslateState({ partialMessages: false });
    return msgs.flatMap((m) => translateSdkMessage(m, state));
  }

  const writeCall: SdkMessageLike = {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_w",
          name: "Write",
          input: { file_path: "/work/notes.txt", content: "HELLO" },
        },
      ],
    },
  };

  /**
   * The measured result shape: the block's `content` is the PROSE the model
   * sees, and the structured Output rides on the message as `tool_use_result`.
   */
  const writeResult: SdkMessageLike = {
    type: "user",
    tool_use_result: { type: "create", filePath: "/work/notes.txt", structuredPatch: [] },
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_w",
          content: "File created successfully at: /work/notes.txt",
        },
      ],
    },
  };

  it("records a Write as attempted at the call and applied at its result", () => {
    const events = translateScript([writeCall, writeResult]).filter(
      (e) => e.kind === "file_op_observed",
    );
    expect(events).toEqual([
      { kind: "file_op_observed", path: "/work/notes.txt", op: "created", outcome: "pending" },
      { kind: "file_op_observed", path: "/work/notes.txt", op: "created", outcome: "applied" },
    ]);
  });

  it("prefers the path the harness resolved over the one the model asked for", () => {
    const events = translateScript([
      writeCall,
      { ...writeResult, tool_use_result: { type: "create", filePath: "/work/resolved/notes.txt" } },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toMatchObject({ path: "/work/resolved/notes.txt", outcome: "applied" });
  });

  it("maps Edit to an edit, keeping the input path when no structured output arrives", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_e",
              name: "Edit",
              input: { file_path: "/work/notes.txt", old_string: "a", new_string: "b" },
            },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_e", content: "updated" }] },
      },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events).toEqual([
      { kind: "file_op_observed", path: "/work/notes.txt", op: "edited", outcome: "pending" },
      { kind: "file_op_observed", path: "/work/notes.txt", op: "edited", outcome: "applied" },
    ]);
  });

  it("records a failed mutation as failed rather than dropping it", () => {
    const events = translateScript([
      writeCall,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_w",
              content: "EACCES: permission denied",
              is_error: true,
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toEqual({
      kind: "file_op_observed",
      path: "/work/notes.txt",
      op: "created",
      outcome: "failed",
    });
  });

  it("leaves the existing tool_call / tool_result stream untouched", () => {
    // The observation events are additive: an existing consumer of the item
    // stream must see exactly what it saw before, in the same order.
    const kinds = translateScript([writeCall, writeResult]).map((e) => e.kind);
    expect(kinds).toEqual(["tool_call", "file_op_observed", "tool_result", "file_op_observed"]);
  });

  const createCall: SdkMessageLike = {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_c",
          name: "TaskCreate",
          input: { subject: "Create notes.txt", description: "…", activeForm: "Creating" },
        },
      ],
    },
  };

  it("records nothing for a plan create until its result names an id", () => {
    // The ids are NOT positional — the same two-item list was allocated #1/#2 on
    // one run and #3/#4 on the next — so an id inferred from call order would be
    // wrong in a way nothing downstream could detect.
    expect(translateScript([createCall]).filter((e) => e.kind === "plan_item_observed")).toEqual([]);
  });

  it("reads a created item's id from the typed field", () => {
    const events = translateScript([
      createCall,
      {
        type: "user",
        tool_use_result: { task: { id: "5", subject: "Create notes.txt" } },
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_c",
              content: "Task #5 created successfully: Create notes.txt",
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events).toEqual([
      { kind: "plan_item_observed", itemId: "5", title: "Create notes.txt", outcome: "applied" },
    ]);
  });

  it("recovers a created item's id from the result prose when the typed field is absent", () => {
    const events = translateScript([
      createCall,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_c",
              content: "Task #5 created successfully: Create notes.txt",
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events).toEqual([
      { kind: "plan_item_observed", itemId: "5", title: "Create notes.txt", outcome: "applied" },
    ]);
  });

  it("records nothing for a create whose id is unrecoverable, and raises nothing", () => {
    const events = translateScript([
      createCall,
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_c", content: "ok" }] },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events).toEqual([]);
  });

  it("reports an unaddressable create as a GAP, not as an absence", () => {
    // The harness DID create the item. Recording nothing and saying nothing
    // would make it indistinguishable afterwards from an item never created —
    // and every later update naming it will also record nothing.
    const events = translateScript([
      createCall,
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_c", content: "ok" }] },
      },
    ]).filter((e) => e.kind === "work_gap_observed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: expect.stringContaining("id could not be read") });
  });

  it("reports a recognised file tool that carried no path as a GAP", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_w", name: "Write", input: { content: "x" } }],
        },
      },
    ]);
    expect(events.filter((e) => e.kind === "file_op_observed")).toEqual([]);
    expect(events.filter((e) => e.kind === "work_gap_observed")).toEqual([
      {
        kind: "work_gap_observed",
        reason: "a file mutation arrived with no path to record it under",
      },
    ]);
  });

  it("does NOT report a tool it never claimed to record as a gap", () => {
    // The line the gap record depends on: absence for an unrecognised tool is
    // the designed answer, and calling it a gap would bury the real ones.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_b", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]);
    expect(events.filter((e) => e.kind === "work_gap_observed")).toEqual([]);
  });

  it("records a confirmed update as attempted then applied, carrying the status", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", status: "in_progress" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: {
          success: true,
          taskId: "5",
          statusChange: { from: "pending", to: "in_progress" },
        },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5 status" },
          ],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events).toEqual([
      { kind: "plan_item_observed", itemId: "5", outcome: "pending" },
      { kind: "plan_item_observed", itemId: "5", status: "in_progress", outcome: "applied" },
    ]);
  });

  it("records a REJECTED update as failed and never carries the status it asked for", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", status: "completed" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_u",
              content: "No task with id 5",
              is_error: true,
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toEqual({ kind: "plan_item_observed", itemId: "5", outcome: "failed" });
    expect(events[1]).not.toHaveProperty("status");
  });

  it("records nothing for a tool it does not recognize", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_x",
              name: "NotebookEdit",
              input: { file_path: "/n.ipynb" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { filePath: "/n.ipynb" },
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }] },
      },
    ]);
    expect(events.filter((e) => e.kind === "file_op_observed")).toEqual([]);
    expect(events.filter((e) => e.kind === "plan_item_observed")).toEqual([]);
    // …and the tool still surfaces on the item stream as it always did.
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_result"]);
  });

  it("does not attribute a message-level structured output when the message carries two results", () => {
    // `tool_use_result` sits on the MESSAGE while results sit on its blocks, so
    // with two results there is no way to tell which it describes. Guessing
    // would stamp one tool's resolved path onto the other's record.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "/work/a.txt" } },
            { type: "tool_use", id: "toolu_2", name: "Write", input: { file_path: "/work/b.txt" } },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { type: "create", filePath: "/work/WRONG.txt" },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          ],
        },
      },
    ]).filter((e) => e.kind === "file_op_observed" && e.outcome === "applied");
    expect(events.map((e) => (e as { path: string }).path)).toEqual(["/work/a.txt", "/work/b.txt"]);
  });

  it("records a file mutation a sub-agent performed", () => {
    // A sub-agent's tool calls arrive as ordinary tool_use blocks carrying the
    // container's id, so they take the same path — the record covers what the
    // run did, including through its children.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_task", name: "Task", input: { task: "sub" } }],
        },
      },
      {
        type: "assistant",
        parent_tool_use_id: "toolu_task",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_w2",
              name: "Write",
              input: { file_path: "/work/sub.txt" },
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events).toEqual([
      { kind: "file_op_observed", path: "/work/sub.txt", op: "created", outcome: "pending" },
    ]);
  });
});
