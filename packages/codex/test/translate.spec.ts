/**
 * The pure translation layer: one Codex wire event in, zero or more
 * framework-vocabulary events out. No side effects, no `ctx`, no vendor word
 * past this boundary.
 *
 * The behaviours below are §10's item list. The one worth reading twice is the
 * last group: an unrecognised event or item kind degrades to a status note
 * (BP-030 — the wire is experimental), EXCEPT an unrecognised member of the
 * `turn.*` lifecycle, which is treated as a terminal failure. Collapsing that
 * into "nothing terminal arrived" is the defect LAB-152 fixed on its own
 * adapter: `null` outcome is what a manager reads as "no result", and a run
 * that demonstrably ended must not read that way.
 */
import { describe, it, expect } from "vitest";
import { translateCodexEvent } from "../src/translate";
import type { CodexThreadEvent } from "../src/types";

const tr = (event: CodexThreadEvent) => translateCodexEvent(event);

describe("translateCodexEvent — lifecycle", () => {
  it("thread.started carries the thread id, and is not an emission", () => {
    expect(tr({ type: "thread.started", thread_id: "thr_7" })).toEqual([
      { kind: "thread_started", threadId: "thr_7" },
    ]);
  });

  it("turn.started is an operator status note", () => {
    const out = tr({ type: "turn.started" });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("status");
  });

  it("turn.completed carries Codex's full usage breakdown, camelCased", () => {
    expect(
      tr({
        type: "turn.completed",
        usage: {
          input_tokens: 1200,
          cached_input_tokens: 200,
          cache_write_input_tokens: 50,
          output_tokens: 300,
          reasoning_output_tokens: 100,
        },
      }),
    ).toEqual([
      {
        kind: "turn_completed",
        usage: {
          inputTokens: 1200,
          cachedInputTokens: 200,
          cacheWriteInputTokens: 50,
          outputTokens: 300,
          reasoningOutputTokens: 100,
        },
      },
    ]);
  });

  it("turn.completed with no usage on the wire yields no usage, never zeros", () => {
    expect(tr({ type: "turn.completed" } as CodexThreadEvent)).toEqual([
      { kind: "turn_completed", usage: null },
    ]);
  });

  it("turn.failed carries the model's failure message", () => {
    expect(tr({ type: "turn.failed", error: { message: "boom from the model" } })).toEqual([
      { kind: "turn_failed", message: "boom from the model" },
    ]);
  });
});

describe("translateCodexEvent — items", () => {
  it("agent_message becomes a message", () => {
    expect(
      tr({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Wrote it" } }),
    ).toEqual([{ kind: "message", text: "Wrote it" }]);
  });

  it("reasoning becomes reasoning", () => {
    expect(
      tr({ type: "item.completed", item: { id: "i0", type: "reasoning", text: "thinking" } }),
    ).toEqual([{ kind: "reasoning", text: "thinking" }]);
  });

  it("a command opens on item.started and settles on item.completed under one call id", () => {
    const started = tr({
      type: "item.started",
      item: {
        id: "i1",
        type: "command_execution",
        command: "echo hi",
        aggregated_output: "",
        status: "in_progress",
      },
    });
    expect(started).toEqual([
      { kind: "tool_call", callId: "i1", name: "command_execution", arguments: '{"command":"echo hi"}' },
    ]);

    const completed = tr({
      type: "item.completed",
      item: {
        id: "i1",
        type: "command_execution",
        command: "echo hi",
        aggregated_output: "hi\n",
        exit_code: 0,
        status: "completed",
      },
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      kind: "tool_result",
      callId: "i1",
      output: "hi\n",
      isError: false,
    });
  });

  it("a non-zero exit marks the command's result an error even when the status says completed", () => {
    const [result] = tr({
      type: "item.completed",
      item: {
        id: "i1",
        type: "command_execution",
        command: "false",
        aggregated_output: "",
        exit_code: 1,
        status: "completed",
      },
    });
    expect(result).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("a file_change arrives whole, so it opens and settles in one step", () => {
    const out = tr({
      type: "item.completed",
      item: {
        id: "i2",
        type: "file_change",
        changes: [{ path: "notes.md", kind: "add" }],
        status: "completed",
      },
    });
    expect(out.map((e) => e.kind)).toEqual(["tool_call", "tool_result"]);
    expect(out[1]).toMatchObject({ callId: "i2", isError: false });
    expect(JSON.stringify(out[1])).toContain("notes.md");
  });

  it("a failed patch settles as an error", () => {
    const out = tr({
      type: "item.completed",
      item: { id: "i2", type: "file_change", changes: [], status: "failed" },
    });
    expect(out[1]).toMatchObject({ kind: "tool_result", isError: true });
  });

  it("an mcp_tool_call names its server and tool, and a reported error settles as one", () => {
    const [call] = tr({
      type: "item.started",
      item: {
        id: "i3",
        type: "mcp_tool_call",
        server: "files",
        tool: "read",
        arguments: { path: "a.txt" },
        status: "in_progress",
      },
    });
    expect(call).toMatchObject({ kind: "tool_call", callId: "i3", name: "mcp:files/read" });

    const [result] = tr({
      type: "item.completed",
      item: {
        id: "i3",
        type: "mcp_tool_call",
        server: "files",
        tool: "read",
        arguments: {},
        error: { message: "nope" },
        status: "failed",
      },
    });
    expect(result).toMatchObject({ kind: "tool_result", isError: true, output: { message: "nope" } });
  });

  it("a web search and a to-do list each surface as their own settled item", () => {
    expect(
      tr({ type: "item.completed", item: { id: "i4", type: "web_search", query: "zod" } }).map(
        (e) => e.kind,
      ),
    ).toEqual(["tool_call", "tool_result"]);
    expect(
      tr({
        type: "item.completed",
        item: { id: "i5", type: "todo_list", items: [{ text: "step", completed: false }] },
      }).map((e) => e.kind),
    ).toEqual(["tool_call", "tool_result"]);
  });

  it("the non-fatal error item becomes an error event; nothing about it ends the run", () => {
    expect(
      tr({ type: "item.completed", item: { id: "i6", type: "error", message: "transient" } }),
    ).toEqual([{ kind: "error", message: "transient" }]);
  });

  it("item.updated is not re-emitted — the started/completed pair is the whole record", () => {
    expect(
      tr({
        type: "item.updated",
        item: {
          id: "i1",
          type: "command_execution",
          command: "echo hi",
          aggregated_output: "partial",
          status: "in_progress",
        },
      }),
    ).toEqual([]);
  });
});

describe("translateCodexEvent — drift (BP-030)", () => {
  it("an unknown item kind degrades to a status note naming it; the run continues", () => {
    const out = tr({
      type: "item.completed",
      item: { id: "i9", type: "hologram" },
    } as CodexThreadEvent);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "status" });
    expect(JSON.stringify(out[0])).toContain("hologram");
  });

  it("an unknown top-level event degrades to a status note", () => {
    const out = tr({ type: "sidecar.attached" } as CodexThreadEvent);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "status" });
  });

  it("an unknown turn.* event is a TERMINAL FAILURE, not a note and not silence", () => {
    // The distinction the neutral contract rests on: `outcome: null` means no
    // terminal result arrived. A future `turn.cancelled` that degraded to a
    // note would report `null` for a run that demonstrably ended.
    const out = tr({ type: "turn.abandoned" } as CodexThreadEvent);
    expect(out.map((e) => e.kind)).toEqual(["status", "turn_failed"]);
    expect(JSON.stringify(out)).toContain("turn.abandoned");
  });

  it("a command_execution missing the fields the handle reads does not throw", () => {
    // The version gate holds the boundary; within a pinned wire, a field moving
    // inside a known event must still degrade rather than crash translation.
    expect(() =>
      tr({ type: "item.completed", item: { id: "i1", type: "command_execution" } } as CodexThreadEvent),
    ).not.toThrow();
  });
});
