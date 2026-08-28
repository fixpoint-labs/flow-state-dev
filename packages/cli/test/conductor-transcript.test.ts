import { describe, expect, it } from "vitest";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  applyTranscriptPatch,
  createStreamTranscript,
  diffBoard,
} from "../src/conductor/transcript";
import {
  activityForView,
  emptyView,
  visibleLive,
  type StatusRow,
} from "../src/conductor/types";

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
          output: "FAIL  test/foo.test.ts\nAssertionError: expected 1 to be 2\n",
          toolCall: {
            callId: "c2",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: [
        "tool · Bash pnpm test · failed",
        "  FAIL  test/foo.test.ts",
        "  AssertionError: expected 1 to be 2",
      ],
      live: null,
    });
  });

  it("prints the tail of a successful Bash result so a passing command is visible", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t5",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c5",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t5",
          type: "tool_output",
          blockName: "Bash",
          status: "completed",
          output: "Test Files  1 passed (1)\n      Tests  12 passed (12)\n",
          toolCall: {
            callId: "c5",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["  Test Files  1 passed (1)", "        Tests  12 passed (12)"],
      live: null,
    });
  });

  it("keeps only the last lines of a long Bash result", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t6",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c6",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    const output = Array.from({ length: 20 }, (_, i) => `log-${i}`).join("\n");
    const patch = t.apply(
      done({
        id: "t6",
        type: "tool_output",
        blockName: "Bash",
        status: "completed",
        output,
        toolCall: {
          callId: "c6",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(patch.lines[0]).toBe("  … 14 above");
    expect(patch.lines.at(-1)).toBe("  log-19");
    expect(patch.lines).toHaveLength(7);
  });

  it("prints a plan checklist under the tool line", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "t8",
          type: "tool_output",
          blockName: "TodoWrite",
          status: "in_progress",
          toolCall: {
            callId: "c8",
            name: "TodoWrite",
            arguments: JSON.stringify({
              todos: [
                { content: "Add the failing test", status: "completed" },
                { content: "Implement the fix", status: "in_progress" },
                { content: "Open the pull request", status: "pending" },
              ],
            }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: [
        "tool · TodoWrite",
        "  [x] Add the failing test",
        "  [·] Implement the fix",
        "  [ ] Open the pull request",
      ],
      live: null,
    });
  });

  it("does not reprint the checklist when a plan tool fails", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t9",
        type: "tool_output",
        blockName: "TodoWrite",
        status: "in_progress",
        toolCall: {
          callId: "c9",
          name: "TodoWrite",
          arguments: JSON.stringify({
            todos: [{ content: "Add the failing test", status: "pending" }],
          }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t9",
          type: "tool_output",
          blockName: "TodoWrite",
          status: "failed",
          toolCall: {
            callId: "c9",
            name: "TodoWrite",
            arguments: JSON.stringify({
              todos: [{ content: "Add the failing test", status: "pending" }],
            }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · TodoWrite · failed"],
      live: null,
    });
  });

  it("prints the first lines of a Read so the file is visible", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t10",
        type: "tool_output",
        blockName: "Read",
        status: "in_progress",
        toolCall: {
          callId: "c10",
          name: "Read",
          arguments: JSON.stringify({ file_path: "src/foo.ts" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t10",
          type: "tool_output",
          blockName: "Read",
          status: "completed",
          output: "export function foo() {\n  return 1;\n}\n",
          toolCall: {
            callId: "c10",
            name: "Read",
            arguments: JSON.stringify({ file_path: "src/foo.ts" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["  export function foo() {", "    return 1;", "  }"],
      live: null,
    });
  });

  it("keeps only the start of a long Read", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t11",
        type: "tool_output",
        blockName: "Read",
        status: "in_progress",
        toolCall: {
          callId: "c11",
          name: "Read",
          arguments: JSON.stringify({ file_path: "big.ts" }),
          generatorBlock: "agent",
        },
      }),
    );
    const output = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const patch = t.apply(
      done({
        id: "t11",
        type: "tool_output",
        blockName: "Read",
        status: "completed",
        output,
        toolCall: {
          callId: "c11",
          name: "Read",
          arguments: JSON.stringify({ file_path: "big.ts" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(patch.lines[0]).toBe("  line-0");
    expect(patch.lines.at(-1)).toBe("  … 14 more");
    expect(patch.lines).toHaveLength(7);
  });

  it("prints the tail of a Grep result", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t12",
        type: "tool_output",
        blockName: "Grep",
        status: "in_progress",
        toolCall: {
          callId: "c12",
          name: "Grep",
          arguments: JSON.stringify({ pattern: "renderFrame" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "t12",
          type: "tool_output",
          blockName: "Grep",
          status: "completed",
          output: "src/conductor/render.ts:48:export function renderFrame()\n",
          toolCall: {
            callId: "c12",
            name: "Grep",
            arguments: JSON.stringify({ pattern: "renderFrame" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["  src/conductor/render.ts:48:export function renderFrame()"],
      live: null,
    });
  });

  it("joins stdout and stderr when the Bash result is an object", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        done({
          id: "t7",
          type: "tool_output",
          blockName: "Bash",
          status: "completed",
          output: { stdout: "built\n", stderr: "warn: stale\n" },
          toolCall: {
            callId: "c7",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm build" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Bash pnpm build", "  built", "  warn: stale"],
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

  it("tags a child's lines and keeps its live slot off the operator line", () => {
    const next = applyTranscriptPatch(
      { ...emptyView("epic"), live: "status · reading board" },
      { lines: ["tool · Write src/a.ts"], live: "status · coding A" },
      1,
      "req-live-1",
    );
    expect(next.activity).toEqual([
      { at: 1, text: "tool · Write src/a.ts", requestId: "req-live-1" },
    ]);
    expect(next.live).toBe("status · reading board");
    expect(next.childLive["req-live-1"]).toBe("status · coding A");
  });

  it("clears that child's live slot when the patch has none", () => {
    const started = applyTranscriptPatch(
      emptyView("epic"),
      { lines: [], live: "status · coding A" },
      1,
      "req-live-1",
    );
    const done = applyTranscriptPatch(
      started,
      { lines: ["status · coding A"], live: null },
      2,
      "req-live-1",
    );
    expect(done.childLive["req-live-1"]).toBeUndefined();
    expect(done.activity).toEqual([
      { at: 2, text: "status · coding A", requestId: "req-live-1" },
    ]);
  });
});

describe("activityForView / visibleLive", () => {
  const liveA: StatusRow = row("LIVE-1", "in_progress", {
    run: {
      attempt: 1,
      taskId: "LIVE-1--implement",
      workspacePath: null,
      branch: null,
      outcome: "running",
      reason: null,
      sessionId: null,
      finalMessage: null,
      usage: null,
      costUsd: null,
      childSessionId: null,
      requestId: "req-live-1",
      updatedAt: 1,
    },
  });
  const liveB: StatusRow = {
    ...liveA,
    taskId: "LIVE-2--implement",
    issue: "LIVE-2",
    run: { ...liveA.run!, requestId: "req-live-2" },
  };

  it("keeps board lines on every row and hides the other child's tools", () => {
    const state = {
      ...emptyView("epic"),
      rows: [liveA, liveB],
      selected: 0,
      activity: [
        { at: 1, text: "LIVE-1 · in_progress" },
        { at: 2, text: "tool · Write src/a.ts", requestId: "req-live-1" },
        { at: 3, text: "tool · Write src/b.ts", requestId: "req-live-2" },
      ],
      childLive: {
        "req-live-1": "status · coding A",
        "req-live-2": "status · coding B",
      },
    };
    expect(activityForView(state).map((item) => item.text)).toEqual([
      "LIVE-1 · in_progress",
      "tool · Write src/a.ts",
    ]);
    expect(visibleLive(state)).toBe("status · coding A");

    const other = { ...state, selected: 1 };
    expect(activityForView(other).map((item) => item.text)).toEqual([
      "LIVE-1 · in_progress",
      "tool · Write src/b.ts",
    ]);
    expect(visibleLive(other)).toBe("status · coding B");
  });

  it("falls back to the operator live line when the selected child is idle", () => {
    const state = {
      ...emptyView("epic"),
      rows: [liveA],
      live: "status · reading board",
    };
    expect(visibleLive(state)).toBe("status · reading board");
  });
});
