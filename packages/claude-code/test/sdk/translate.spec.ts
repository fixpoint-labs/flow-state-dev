import { describe, it, expect } from "vitest";
import {
  createTranslateState,
  drainUnsettledObservations,
  translateSdkMessage,
} from "../../src/sdk/translate";
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

  it("settles under the CALL-TIME path, so one operation stays one row", () => {
    // The row's key is fixed when the call is seen. Settling under a different
    // path cannot update that row — it writes a second one, leaving a permanent
    // `pending` beside an `applied` for a single write. A phantom unresolved
    // mutation is indistinguishable from the record having lost a write.
    const events = translateScript([
      writeCall,
      { ...writeResult, tool_use_result: { type: "create", filePath: "/work/resolved/notes.txt" } },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events.map((e) => (e as { path: string }).path)).toEqual([
      "/work/notes.txt",
      "/work/notes.txt",
    ]);
  });

  it("carries the harness's differing path alongside, rather than dropping it", () => {
    // Not a second key — the recorder canonicalizes both and only calls it a
    // divergence if they still differ. Silently keying under one of two paths
    // the harness and the model disagree on is the failure this avoids.
    const events = translateScript([
      writeCall,
      { ...writeResult, tool_use_result: { type: "create", filePath: "/work/resolved/notes.txt" } },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toMatchObject({ resolvedPath: "/work/resolved/notes.txt" });
    // …and stays absent when the two agree, so the recorder has nothing to weigh.
    const agreed = translateScript([writeCall, writeResult]).filter(
      (e) => e.kind === "file_op_observed",
    );
    expect(agreed[1]).not.toHaveProperty("resolvedPath");
  });

  it("records an overwriting Write as an EDIT, not a create", () => {
    // The tool name is a guess at the kind: `Write` to an existing path
    // overwrites it, which is an edit however the tool is spelled. The harness
    // knows which it was and says so; recording `created` there would be the
    // record asserting something about the run that did not happen.
    const events = translateScript([
      writeCall,
      { ...writeResult, tool_use_result: { type: "update", filePath: "/work/notes.txt" } },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[0]).toMatchObject({ op: "created", outcome: "pending" });
    expect(events[1]).toMatchObject({ op: "edited", outcome: "applied" });
  });

  it("keeps the call-time kind when the harness reports none", () => {
    // `Edit`'s structured output carries no `type` at all, so the tool name
    // stays the fallback rather than the exception.
    const events = translateScript([
      writeCall,
      { ...writeResult, tool_use_result: { filePath: "/work/notes.txt" } },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toMatchObject({ op: "created", outcome: "applied" });
  });

  it("keeps the ATTEMPTED kind on a failure, even if the output names one", () => {
    // The isolating world: a failed result that still carries a `type`. On a
    // failure nothing was created or updated, so a completion kind read off the
    // output would contradict the `failed` outcome sitting beside it. What the
    // row means there is what was ATTEMPTED. Without the structured field this
    // case is indistinguishable from the fallback, which is why it is spelled
    // out rather than left to the plain error result below.
    const events = translateScript([
      writeCall,
      {
        type: "user",
        tool_use_result: { type: "update", filePath: "/work/notes.txt" },
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_w",
              content: "EACCES",
              is_error: true,
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toMatchObject({ op: "created", outcome: "failed" });
  });

  it("keeps the call-time kind on a failure that reports nothing at all", () => {
    const events = translateScript([
      writeCall,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_w",
              content: "EACCES",
              is_error: true,
            },
          ],
        },
      },
    ]).filter((e) => e.kind === "file_op_observed");
    expect(events[1]).toMatchObject({ op: "created", outcome: "failed" });
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

  it("drains an unsettled plan create to a gap when the stream ends", () => {
    const state = createTranslateState({ partialMessages: false });
    translateSdkMessage(createCall, state);
    const drained = drainUnsettledObservations(state);

    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ kind: "work_gap_observed" });
    // Names the item, so the gap says WHICH plan attempt was lost.
    expect((drained[0] as { reason: string }).reason).toContain("Create notes.txt");
    // …and draining twice does not double-report it.
    expect(drainUnsettledObservations(state)).toEqual([]);
  });

  it("drains nothing for work that already recorded an attempt", () => {
    // Open file ops and open plan UPDATES both emitted a `pending` observation
    // at call time, so an unsettled attempt keeping its attempted state is
    // already the designed record. Re-reporting them as gaps would turn every
    // interrupted run into a pile of false alarms.
    const state = createTranslateState({ partialMessages: false });
    translateSdkMessage(writeCall, state);
    translateSdkMessage(
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
      state,
    );
    expect(drainUnsettledObservations(state)).toEqual([]);
  });

  it("drains nothing after a create that settled normally", () => {
    const state = createTranslateState({ partialMessages: false });
    translateSdkMessage(createCall, state);
    translateSdkMessage(
      {
        type: "user",
        tool_use_result: { task: { id: "5", subject: "Create notes.txt" } },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_c", content: "Task #5 created" },
          ],
        },
      },
      state,
    );
    expect(drainUnsettledObservations(state)).toEqual([]);
  });

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
      {
        kind: "plan_item_observed",
        itemId: "5",
        status: "in_progress",
        // BOTH ends of the move, because the fixture carries both.
        //
        // This assertion previously stopped at `status` and dropped
        // `previousStatus`, while the fixture beside it said
        // `{ from: "pending", to: "in_progress" }` — so the test pinned the
        // implementation's behaviour instead of the harness's contract, and
        // the recorder went on producing `previousStatus: null` for a first
        // move the harness had described in full.
        //
        // The fixture is copied from real measured output, which makes every
        // field in it a claim about the contract. Asserting less than it
        // carries is a decision to discard data, and has to be a deliberate
        // one — not what falls out of writing the expectation from the code.
        previousStatus: "pending",
        outcome: "applied",
      },
    ]);
  });

  it("records the subject the harness CREATED, not the one the run asked for", () => {
    // An approval seam can hand the SDK an `updatedInput`, so the tool executes
    // something other than the call we saw. The create result declares
    // `subject` as a required field, so taking the request would leave the row
    // stale the moment it was written.
    const events = translateScript([
      createCall,
      {
        type: "user",
        tool_use_result: { task: { id: "5", subject: "Create notes.txt (revised on approval)" } },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_c", content: "Task #5 created" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[0]).toMatchObject({ title: "Create notes.txt (revised on approval)" });
  });

  it("falls back to the requested subject when the result omits one", () => {
    const events = translateScript([
      createCall,
      {
        type: "user",
        tool_use_result: { task: { id: "5" } },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_c", content: "Task #5 created" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[0]).toMatchObject({ title: "Create notes.txt" });
  });

  it("treats an in-band `success: false` as a refusal, not an applied update", () => {
    // A refusal arrives two ways. Reading only `is_error` records a transition
    // the harness declined as though it had happened.
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
        tool_use_result: { success: false, taskId: "5", updatedFields: [], error: "blocked" },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "could not update" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toEqual({ kind: "plan_item_observed", itemId: "5", outcome: "failed" });
  });

  it("records the status the harness MOVED TO, not the one that was requested", () => {
    // The isolating world: the two differ. Every other fixture here has the
    // requested and reported status equal, which makes the preference
    // invisible — a test that cannot tell the two apart is not testing the
    // rule. (`in_review` is also a value our vocabulary does not know, which is
    // why the field is a free string: an unknown status records as itself.)
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
        tool_use_result: {
          success: true,
          taskId: "5",
          updatedFields: ["status"],
          statusChange: { from: "in_progress", to: "in_review" },
        },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toMatchObject({
      status: "in_review",
      previousStatus: "in_progress",
      outcome: "applied",
    });
  });

  it("does not record a re-wording the harness left unapplied", () => {
    // The title half of the applied-fields rule, isolated: the request carried
    // a subject and `updatedFields` says only the status landed.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", status: "completed", subject: "Never applied" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: {
          success: true,
          taskId: "5",
          updatedFields: ["status"],
          statusChange: { from: "in_progress", to: "completed" },
        },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toMatchObject({ status: "completed", outcome: "applied" });
    expect(events[1]).not.toHaveProperty("title");
  });

  it("does not record a field the harness says it did not apply", () => {
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", status: "completed", subject: "Rewritten" },
            },
          ],
        },
      },
      {
        type: "user",
        // Only the subject landed; the status was not among the applied fields.
        tool_use_result: { success: true, taskId: "5", updatedFields: ["subject"] },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toMatchObject({ title: "Rewritten", outcome: "applied" });
    expect(events[1]).not.toHaveProperty("status");
  });

  it("settles NOTHING when the harness reports updating a different item", () => {
    // The disagreement that isolates it: the result confirms a status and a
    // subject, and names a DIFFERENT item. Settling anyway writes item 9's
    // confirmed data onto item 5's row — corrupting a row the harness never
    // touched while omitting the one it did.
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
        tool_use_result: {
          success: true,
          taskId: "9",
          updatedFields: ["status"],
          statusChange: { from: "in_progress", to: "completed" },
        },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #9" }],
        },
      },
    ]);
    // The attempt stays pending; no `applied` event carries item 9's data.
    const plan = events.filter((e) => e.kind === "plan_item_observed");
    expect(plan).toEqual([{ kind: "plan_item_observed", itemId: "5", outcome: "pending" }]);
    expect(events.filter((e) => e.kind === "work_gap_observed")).toHaveLength(1);
  });

  it("reports a batch whose structured confirmation could not be attributed", () => {
    // Two results, one message-level structured result. Every settlement in the
    // message falls back to call-time values — right when the harness says
    // nothing, but here it DID say something and we discarded it, so an
    // approval-revised input or an in-band refusal is invisible. The row must
    // not be indistinguishable from a confirmed one.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "TaskUpdate",
              input: { taskId: "5", status: "completed" },
            },
            { type: "tool_use", id: "toolu_2", name: "Write", input: { file_path: "/work/a.txt" } },
          ],
        },
      },
      {
        type: "user",
        // Contradicts the call-time status, and cannot be attributed to either.
        tool_use_result: { success: false, taskId: "5", updatedFields: [] },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          ],
        },
      },
    ]);
    const gaps = events.filter((e) => e.kind === "work_gap_observed");
    expect(gaps).toHaveLength(1);
    expect((gaps[0] as { reason: string }).reason).toContain("could not be attributed");
  });

  it("says nothing about a batch that settled no recorded work", () => {
    // A batch of results for tools nobody records discarded nothing that
    // mattered, so it must not manufacture a gap.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "pwd" } },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { stdout: "" },
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          ],
        },
      },
    ]);
    expect(events.filter((e) => e.kind === "work_gap_observed")).toEqual([]);
  });

  it("says nothing about a batch that carried no structured result to discard", () => {
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
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "ok" },
          ],
        },
      },
    ]);
    expect(events.filter((e) => e.kind === "work_gap_observed")).toEqual([]);
  });

  it("reports an update the harness applied to a DIFFERENT item as a gap", () => {
    // The id is a key, so it keeps its call-time value — but a result naming
    // another item means this row describes work done to something else.
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
        tool_use_result: { success: true, taskId: "9", updatedFields: ["status"] },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #9" }],
        },
      },
    ]);
    const gaps = events.filter((e) => e.kind === "work_gap_observed");
    expect(gaps).toHaveLength(1);
    expect((gaps[0] as { reason: string }).reason).toContain("9");
  });

  it("carries a re-wording an update applied, so the plan does not go stale", () => {
    // `TaskUpdate` can change an item's wording as well as its status. Keeping
    // only the create-time title leaves `observed-plan` claiming to be the run's
    // current plan while holding a title the run has since replaced.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", subject: "Create the file, then verify it" },
            },
          ],
        },
      },
      {
        type: "user",
        tool_use_result: { success: true, taskId: "5", updatedFields: ["subject"] },
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_u", content: "Updated task #5" }],
        },
      },
    ]).filter((e) => e.kind === "plan_item_observed");
    expect(events[1]).toMatchObject({
      itemId: "5",
      title: "Create the file, then verify it",
      outcome: "applied",
    });
  });

  it("does NOT carry a re-wording the harness refused", () => {
    // Same rule as the status: a re-wording the harness rejected is as wrong to
    // record as a transition it rejected.
    const events = translateScript([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_u",
              name: "TaskUpdate",
              input: { taskId: "5", subject: "Never applied" },
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
    expect(events[1]).not.toHaveProperty("title");
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
