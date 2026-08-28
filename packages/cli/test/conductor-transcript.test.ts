import { describe, expect, it } from "vitest";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  applyTranscriptPatch,
  createStreamTranscript,
  diffBoard,
} from "../src/conductor/transcript";
import { emptyView, type StatusRow } from "../src/conductor/types";

function added(item: Record<string, unknown>): RequestStreamEventWithId {
  return { type: "item.added", item } as RequestStreamEventWithId;
}

function done(item: Record<string, unknown>): RequestStreamEventWithId {
  return { type: "item.done", item } as RequestStreamEventWithId;
}

function delta(itemId: string, text: string): RequestStreamEventWithId {
  return { type: "content.delta", itemId, contentIndex: 0, delta: text } as RequestStreamEventWithId;
}

function row(issue: string, status: string, extras: Partial<StatusRow> = {}): StatusRow {
  return {
    taskId: `${issue}--implement`,
    issue,
    phase: "implement",
    status,
    attempts: 1,
    feedback: null,
    run: null,
    questions: [],
    ...extras,
  };
}

describe("createStreamTranscript", () => {
  it("keeps a transient status on the live line and only logs it when the next one arrives", () => {
    const t = createStreamTranscript();
    expect(t.apply(added({ id: "s1", type: "status", message: "claiming", transient: true }))).toEqual({
      lines: [],
      live: "status · claiming",
    });
    expect(t.apply(done({ id: "s1", type: "status", message: "claiming", transient: true }))).toEqual({
      lines: [],
      live: "status · claiming",
    });
    expect(t.apply(added({ id: "s2", type: "status", message: "running", transient: true }))).toEqual({
      lines: ["status · claiming"],
      live: "status · running",
    });
    expect(t.flush()).toEqual({ lines: ["status · running"], live: null });
  });

  it("commits a durable status immediately so a confirmation is not lost on the live slot", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(added({ id: "s1", type: "status", message: "seeded ASK-1--implement", transient: false })),
    ).toEqual({
      lines: ["status · seeded ASK-1--implement"],
      live: null,
    });
  });

  it("streams assistant text from content.delta and does not reprint it on item.done", () => {
    const t = createStreamTranscript();
    expect(t.apply(added({ id: "m1", type: "message", role: "assistant", content: [] }))).toEqual({
      lines: [],
      live: null,
    });
    expect(t.apply(delta("m1", "opened "))).toEqual({
      lines: [],
      live: "message · opened ",
    });
    expect(t.apply(delta("m1", "the pull request"))).toEqual({
      lines: [],
      live: "message · opened the pull request",
    });
    expect(
      t.apply(
        done({
          id: "m1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "opened the pull request" }],
        }),
      ),
    ).toEqual({
      lines: ["message · opened the pull request"],
      live: null,
    });
  });

  it("prints a finished assistant message once when the provider sent no deltas", () => {
    const t = createStreamTranscript();
    t.apply(added({ id: "m1", type: "message", role: "assistant", content: [] }));
    expect(
      t.apply(
        done({
          id: "m1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "opened the pull request" }],
        }),
      ),
    ).toEqual({
      lines: ["message · opened the pull request"],
      live: null,
    });
  });

  it("does not treat item.added of a status as a finished line — that would double-print with item.done", () => {
    const t = createStreamTranscript();
    const first = t.apply(added({ id: "s1", type: "status", message: "seeded", transient: true }));
    const second = t.apply(done({ id: "s1", type: "status", message: "seeded", transient: true }));
    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual([]);
    expect(second.live).toBe("status · seeded");
  });

  it("names a coding tool with the file or command, and does not reprint a successful result", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "t1",
          type: "tool_output",
          blockName: "Write",
          status: "in_progress",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({ file_path: "src/conductor/render.ts" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Write src/conductor/render.ts"],
      live: null,
    });
    expect(
      t.apply(
        done({
          id: "t1",
          type: "tool_output",
          blockName: "Write",
          status: "completed",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({ file_path: "src/conductor/render.ts" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({ lines: [], live: null });
  });

  it("prints the lines a Write put in the file", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "t1",
          type: "tool_output",
          blockName: "Write",
          status: "in_progress",
          toolCall: {
            callId: "c1",
            name: "Write",
            arguments: JSON.stringify({
              file_path: "src/foo.ts",
              contents: "export const n = 1;\n",
            }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Write src/foo.ts", "+ export const n = 1;"],
      live: null,
    });
  });

  it("prints the changed span of an Edit, not the whole file", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "t2",
          type: "tool_output",
          blockName: "Edit",
          status: "in_progress",
          toolCall: {
            callId: "c2",
            name: "Edit",
            arguments: JSON.stringify({
              file_path: "src/foo.ts",
              old_string: "const n = 1;\nconst m = 2;\nconst p = 3;\n",
              new_string: "const n = 1;\nconst m = 4;\nconst p = 3;\n",
            }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Edit src/foo.ts", "- const m = 2;", "+ const m = 4;"],
      live: null,
    });
  });

  it("caps a long Write so one file cannot fill the transcript", () => {
    const t = createStreamTranscript();
    const contents = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const patch = t.apply(
      added({
        id: "t3",
        type: "tool_output",
        blockName: "Write",
        status: "in_progress",
        toolCall: {
          callId: "c3",
          name: "Write",
          arguments: JSON.stringify({ file_path: "big.ts", content: contents }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(patch.lines[0]).toBe("tool · Write big.ts");
    expect(patch.lines[1]).toBe("+ line-0");
    expect(patch.lines.at(-1)).toBe("… 10 more");
    expect(patch.lines).toHaveLength(12);
  });

  it("does not reprint the hunk when a Write fails — only the tool line", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t4",
        type: "tool_output",
        blockName: "Write",
        status: "in_progress",
        toolCall: {
          callId: "c4",
          name: "Write",
          arguments: JSON.stringify({ file_path: "src/foo.ts", contents: "x" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t4",
          type: "tool_output",
          blockName: "Write",
          status: "failed",
          toolCall: {
            callId: "c4",
            name: "Write",
            arguments: JSON.stringify({ file_path: "src/foo.ts", contents: "x" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Write src/foo.ts · failed"],
      live: null,
    });
  });

  it("prints a Bash command and a failed tool once it settles", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t2",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c2",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t2",
          type: "tool_output",
          blockName: "Bash",
          status: "failed",
          toolCall: {
            callId: "c2",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Bash pnpm test · failed"],
      live: null,
    });
  });

  it("prints an orphan tool result that never had an added event", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        done({
          id: "t3",
          type: "tool_output",
          blockName: "Read",
          status: "completed",
          toolCall: {
            callId: "c3",
            name: "Read",
            arguments: JSON.stringify({ file_path: "package.json" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Read package.json"],
      live: null,
    });
  });

  it("names a sub-agent when its container opens, and only again if it fails", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "c1",
          type: "container",
          blockName: "Explore",
          label: "Sub-agent: Explore",
          status: "in_progress",
        }),
      ),
    ).toEqual({
      lines: ["sub · Sub-agent: Explore"],
      live: null,
    });
    expect(
      t.apply(
        done({
          id: "c1",
          type: "container",
          blockName: "Explore",
          label: "Sub-agent: Explore",
          status: "completed",
        }),
      ),
    ).toEqual({ lines: [], live: null });
    expect(
      t.apply(
        done({
          id: "c2",
          type: "container",
          blockName: "Explore",
          label: "Sub-agent: Explore",
          status: "failed",
        }),
      ),
    ).toEqual({
      lines: ["sub · Sub-agent: Explore · failed"],
      live: null,
    });
  });
});

describe("diffBoard", () => {
  it("is silent when a poll moved nothing", () => {
    const rows = [row("FIX-1", "in_progress")];
    expect(diffBoard(rows, rows)).toEqual([]);
  });

  it("names a new question — that is the only thing a person can act on", () => {
    const before = [row("FIX-1", "in_progress")];
    const after = [
      row("FIX-1", "awaiting_review", {
        questions: [
          { question: "FIX-1/implement/1/q", text: "Which path?", attempt: 1, askedAt: 1 },
        ],
      }),
    ];
    expect(diffBoard(before, after)).toEqual([
      "FIX-1 · in_progress → awaiting_review",
      "FIX-1 · asked Which path?",
    ]);
  });

  it("surfaces a run outcome when the detached job writes one", () => {
    const before = [row("FIX-1", "in_progress")];
    const after = [
      row("FIX-1", "pending", {
        run: {
          attempt: 1,
          taskId: "FIX-1--implement",
          workspacePath: null,
          branch: null,
          outcome: "failed",
          reason: "no pull request",
          sessionId: null,
          finalMessage: "stopped after the turn budget",
          usage: null,
          costUsd: null,
          childSessionId: null,
          requestId: null,
          updatedAt: 1,
        },
      }),
    ];
    expect(diffBoard(before, after)).toEqual([
      "FIX-1 · in_progress → pending",
      "FIX-1 · run failed · no pull request",
      "FIX-1 · stopped after the turn budget",
    ]);
  });
});

describe("applyTranscriptPatch", () => {
  it("writes committed lines to history and keeps the live line on the view", () => {
    const next = applyTranscriptPatch(emptyView("epic"), {
      lines: ["status · claiming"],
      live: "status · running",
    }, 1);
    expect(next.activity).toEqual([{ at: 1, text: "status · claiming" }]);
    expect(next.live).toBe("status · running");
  });
});
