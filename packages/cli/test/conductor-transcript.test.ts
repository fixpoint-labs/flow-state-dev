import { describe, expect, it } from "vitest";
import type { RequestStreamEventWithId } from "@flow-state-dev/engine";
import {
  applyTranscriptPatch,
  createStreamTranscript,
  diffBoard,
  redactSecrets,
  viewFromEvents,
} from "../src/conductor/transcript";
import {
  ACTIVITY_CAP,
  activityForView,
  emptyView,
  fileFromToolLine,
  findMatches,
  pushActivity,
  selectedFiles,
  selectedHunk,
  selectedNow,
  selectedPlan,
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

function updated(
  itemId: string,
  patch: Record<string, unknown>,
  key: "itemId" | "id" = "itemId",
): RequestStreamEventWithId {
  return { type: "item.updated", [key]: itemId, patch } as RequestStreamEventWithId;
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

  it("echoes a user message as you · and does not reprint it on item.done", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "u1",
          type: "message",
          role: "user",
          content: [{ type: "output_text", text: "what's on the board?" }],
        }),
      ),
    ).toEqual({
      lines: ["you · what's on the board?"],
      live: null,
    });
    expect(
      t.apply(
        done({
          id: "u1",
          type: "message",
          role: "user",
          content: [{ type: "output_text", text: "what's on the board?" }],
        }),
      ),
    ).toEqual({
      lines: [],
      live: null,
    });
  });

  it("echoes a user message that only arrives on item.done", () => {
    const t = createStreamTranscript();
    expect(t.apply(added({ id: "u2", type: "message", role: "user", content: [] }))).toEqual({
      lines: [],
      live: null,
    });
    expect(
      t.apply(
        done({
          id: "u2",
          type: "message",
          role: "user",
          content: [{ type: "output_text", text: "retry the failed rows" }],
        }),
      ),
    ).toEqual({
      lines: ["you · retry the failed rows"],
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

  it("streams reasoning from content.delta and does not reprint it on item.done", () => {
    const t = createStreamTranscript();
    expect(t.apply(added({ id: "r1", type: "reasoning", summary: [] }))).toEqual({
      lines: [],
      live: "think ·",
    });
    expect(t.apply(delta("r1", "I should look at "))).toEqual({
      lines: [],
      live: "think · I should look at",
    });
    expect(t.apply(delta("r1", "the tests first"))).toEqual({
      lines: [],
      live: "think · I should look at the tests first",
    });
    expect(
      t.apply(
        done({
          id: "r1",
          type: "reasoning",
          summary: [{ type: "reasoning_text", text: "I should look at the tests first" }],
        }),
      ),
    ).toEqual({
      lines: ["think · I should look at the tests first"],
      live: null,
    });
  });

  it("prints a finished reasoning item once when the provider sent no deltas", () => {
    const t = createStreamTranscript();
    t.apply(added({ id: "r1", type: "reasoning", summary: [] }));
    expect(
      t.apply(
        done({
          id: "r1",
          type: "reasoning",
          summary: [{ type: "reasoning_text", text: "I should look at the tests first" }],
        }),
      ),
    ).toEqual({
      lines: ["think · I should look at the tests first"],
      live: null,
    });
  });

  it("keeps a think line compact so an essay does not fill the transcript", () => {
    const t = createStreamTranscript();
    const essay = `${"word ".repeat(80)}end`;
    t.apply(added({ id: "r1", type: "reasoning", summary: [] }));
    const live = t.apply(delta("r1", essay)).live;
    expect(live?.startsWith("think · word ")).toBe(true);
    expect(live!.length).toBeLessThanOrEqual("think · ".length + 160);
    expect(live?.endsWith("…")).toBe(true);
    const doneLine = t.apply(
      done({
        id: "r1",
        type: "reasoning",
        summary: [{ type: "reasoning_text", text: essay }],
      }),
    );
    expect(doneLine.lines).toEqual([live]);
    expect(doneLine.live).toBeNull();
  });

  it("drops an empty reasoning item so a think · with no text is not a beat", () => {
    const t = createStreamTranscript();
    t.apply(added({ id: "r1", type: "reasoning", summary: [] }));
    expect(t.apply(done({ id: "r1", type: "reasoning", summary: [] }))).toEqual({
      lines: [],
      live: null,
    });
  });

  it("nests a think line under an open sub-agent", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "c1",
        type: "container",
        blockName: "Explore",
        label: "Sub-agent: Explore",
        status: "in_progress",
      }),
    );
    expect(
      t.apply(
        done({
          id: "r1",
          type: "reasoning",
          summary: [{ type: "reasoning_text", text: "look at the tests" }],
        }),
      ),
    ).toEqual({
      lines: ["  think · look at the tests"],
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
      live: "tool · Write src/conductor/render.ts",
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

  it("keeps a long file path's filename so the file list can still name the file", () => {
    const t = createStreamTranscript();
    const file_path =
      "/tmp/conductor-checkouts/live-prove-30/deep/nested/src/conductor/render.ts";
    const patch = t.apply(
      added({
        id: "t-long",
        type: "tool_output",
        blockName: "Write",
        status: "completed",
        toolCall: {
          callId: "c-long",
          name: "Write",
          arguments: JSON.stringify({ file_path }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(patch.lines[0]).toBe(`tool · Write ${file_path}`);
    expect(patch.lines[0]).toContain("render.ts");
  });

  it("keeps an open tool on the live line until it settles", () => {
    const t = createStreamTranscript();
    const open = t.apply(
      added({
        id: "t-live",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c-live",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(open.live).toBe("tool · Bash pnpm test");
    expect(open.lines).toEqual(["tool · Bash pnpm test"]);
    expect(
      t.apply(
        done({
          id: "t-live",
          type: "tool_output",
          blockName: "Bash",
          status: "completed",
          output: "ok\n",
          toolCall: {
            callId: "c-live",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({ lines: ["  ok"], live: null });
  });

  it("prints a Bash tail on item.updated and does not reprint it on item.done", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t-upd",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c-upd",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm test" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        updated("t-upd", {
          status: "completed",
          output: "Test Files  1 passed (1)\n",
        }),
      ),
    ).toEqual({
      lines: ["  Test Files  1 passed (1)"],
      live: null,
    });
    expect(
      t.apply(
        done({
          id: "t-upd",
          type: "tool_output",
          blockName: "Bash",
          status: "completed",
          output: "Test Files  1 passed (1)\n",
          toolCall: {
            callId: "c-upd",
            name: "Bash",
            arguments: JSON.stringify({ command: "pnpm test" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({ lines: [], live: null });
  });

  it("accepts the framework item.updated shape that names the item id", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t-id",
        type: "tool_output",
        blockName: "Bash",
        status: "in_progress",
        toolCall: {
          callId: "c-id",
          name: "Bash",
          arguments: JSON.stringify({ command: "pnpm build" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        updated("t-id", { status: "completed", output: "built\n" }, "id"),
      ),
    ).toEqual({ lines: ["  built"], live: null });
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
      live: "tool · Write src/foo.ts",
      hunk: ["+ export const n = 1;"],
      hunkFile: "src/foo.ts",
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
      live: "tool · Edit src/foo.ts",
      hunk: ["- const m = 2;", "+ const m = 4;"],
      hunkFile: "src/foo.ts",
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
    expect(patch.hunk).toHaveLength(20);
    expect(patch.hunk?.[0]).toBe("+ line-0");
    expect(patch.hunk?.at(-1)).toBe("+ line-19");
    expect(patch.hunkFile).toBe("big.ts");
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
      live: "tool · TodoWrite",
      plan: [
        { mark: "x", text: "Add the failing test" },
        { mark: "·", text: "Implement the fix" },
        { mark: " ", text: "Open the pull request" },
      ],
    });
  });

  it("pins TaskCreate then TaskUpdate as the run's plan", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        added({
          id: "tc1",
          type: "tool_output",
          blockName: "TaskCreate",
          status: "in_progress",
          toolCall: {
            callId: "c-create",
            name: "TaskCreate",
            arguments: JSON.stringify({
              subject: "Add hello.js",
              description: "export hello",
              activeForm: "Adding",
            }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · TaskCreate Add hello.js"],
      live: "tool · TaskCreate Add hello.js",
      plan: [{ mark: " ", text: "Add hello.js" }],
    });
    t.apply(
      done({
        id: "tc1",
        type: "tool_output",
        blockName: "TaskCreate",
        status: "completed",
        output: { task: { id: "5", subject: "Add hello.js" } },
        toolCall: {
          callId: "c-create",
          name: "TaskCreate",
          arguments: JSON.stringify({ subject: "Add hello.js" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        added({
          id: "tu1",
          type: "tool_output",
          blockName: "TaskUpdate",
          status: "in_progress",
          toolCall: {
            callId: "c-update",
            name: "TaskUpdate",
            arguments: JSON.stringify({ taskId: "5", status: "completed" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toMatchObject({
      lines: ["tool · TaskUpdate"],
      live: "tool · TaskUpdate",
    });
    expect(
      t.apply(
        done({
          id: "tu1",
          type: "tool_output",
          blockName: "TaskUpdate",
          status: "completed",
          toolCall: {
            callId: "c-update",
            name: "TaskUpdate",
            arguments: JSON.stringify({ taskId: "5", status: "completed" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: [],
      live: null,
      plan: [{ mark: "x", text: "Add hello.js" }],
    });
  });

  it("drops a TaskCreate that failed", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "tc-fail",
        type: "tool_output",
        blockName: "TaskCreate",
        status: "in_progress",
        toolCall: {
          callId: "c-fail",
          name: "TaskCreate",
          arguments: JSON.stringify({ subject: "Should not stay" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(
      t.apply(
        done({
          id: "tc-fail",
          type: "tool_output",
          blockName: "TaskCreate",
          status: "failed",
          toolCall: {
            callId: "c-fail",
            name: "TaskCreate",
            arguments: JSON.stringify({ subject: "Should not stay" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · TaskCreate Should not stay · failed"],
      live: null,
      plan: [],
    });
  });

  it("does not pin a Read of checklist markdown as the run's plan", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "t-read-plan",
        type: "tool_output",
        blockName: "Read",
        status: "in_progress",
        toolCall: {
          callId: "c-read-plan",
          name: "Read",
          arguments: JSON.stringify({ file_path: "notes.md" }),
          generatorBlock: "agent",
        },
      }),
    );
    const peek = t.apply(
      done({
        id: "t-read-plan",
        type: "tool_output",
        blockName: "Read",
        status: "completed",
        output: "[x] Ship the board\n[ ] Write the docs\n",
        toolCall: {
          callId: "c-read-plan",
          name: "Read",
          arguments: JSON.stringify({ file_path: "notes.md" }),
          generatorBlock: "agent",
        },
      }),
    );
    expect(peek.plan).toBeUndefined();
    const next = applyTranscriptPatch(emptyView("epic"), peek, 1, "req-live-1");
    expect(next.childPlan["req-live-1"]).toBeUndefined();
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

  it("redacts host tokens in a Bash tail so the board cannot paint them", () => {
    const t = createStreamTranscript();
    expect(
      t.apply(
        done({
          id: "t-secret",
          type: "tool_output",
          blockName: "Bash",
          status: "completed",
          output: "origin  https://x-access-token:ghs_EXAMPLETOKENVALUE@github.com/org/repo.git\n",
          toolCall: {
            callId: "c-secret",
            name: "Bash",
            arguments: JSON.stringify({ command: "git remote -v" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: [
        "tool · Bash git remote -v",
        "  origin  https://x-access-token:***@github.com/org/repo.git",
      ],
      live: null,
    });
    expect(redactSecrets("token ghs_EXAMPLETOKENVALUE and github_pat_EXAMPLEPATVALUE")).toBe(
      "token ghs_*** and github_pat_***",
    );
  });

  it("redacts a flushed live line so a leftover status cannot leak a token", () => {
    const t = createStreamTranscript();
    t.apply(
      added({
        id: "s-secret",
        type: "status",
        message: "origin https://x-access-token:ghs_EXAMPLETOKENVALUE@github.com/org/repo.git",
        transient: true,
      }),
    );
    expect(t.flush()).toEqual({
      lines: ["status · origin https://x-access-token:***@github.com/org/repo.git"],
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

  it("indents tools that run while a sub-agent is open", () => {
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
        added({
          id: "t1",
          type: "tool_output",
          blockName: "Grep",
          status: "completed",
          toolCall: {
            callId: "g1",
            name: "Grep",
            arguments: JSON.stringify({ pattern: "TODO" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["  tool · Grep TODO"],
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
        added({
          id: "t2",
          type: "tool_output",
          blockName: "Write",
          status: "completed",
          toolCall: {
            callId: "w1",
            name: "Write",
            arguments: JSON.stringify({ file_path: "src/a.ts" }),
            generatorBlock: "agent",
          },
        }),
      ),
    ).toEqual({
      lines: ["tool · Write src/a.ts"],
      live: null,
    });
    expect(fileFromToolLine("  tool · Write src/nested.ts")).toBe("src/nested.ts");
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

  it("keeps a you · line once when the stream repeats it", () => {
    const echoed = applyTranscriptPatch(
      emptyView("epic"),
      { lines: ["you · what's on the board?"], live: null },
      1,
    );
    const again = applyTranscriptPatch(
      echoed,
      { lines: ["you · what's on the board?"], live: null },
      2,
    );
    expect(again.activity).toEqual([{ at: 1, text: "you · what's on the board?" }]);
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

  it("pins a child's checklist and replaces it on the next plan, not a hunk", () => {
    const first = applyTranscriptPatch(
      emptyView("epic"),
      {
        lines: [
          "tool · TodoWrite",
          "  [x] Add the failing test",
          "  [·] Implement the fix",
          "  [ ] Open the pull request",
        ],
        live: null,
        plan: [
          { mark: "x", text: "Add the failing test" },
          { mark: "·", text: "Implement the fix" },
          { mark: " ", text: "Open the pull request" },
        ],
      },
      1,
      "req-live-1",
    );
    expect(first.childPlan["req-live-1"]).toEqual([
      { mark: "x", text: "Add the failing test" },
      { mark: "·", text: "Implement the fix" },
      { mark: " ", text: "Open the pull request" },
    ]);

    const hunk = applyTranscriptPatch(
      first,
      { lines: ["tool · Write src/a.ts", "+ export const a = 1;"], live: null },
      2,
      "req-live-1",
    );
    expect(hunk.childPlan["req-live-1"]).toEqual(first.childPlan["req-live-1"]);

    const bash = applyTranscriptPatch(
      hunk,
      { lines: ["  Test Files  1 passed (1)"], live: null },
      3,
      "req-live-1",
    );
    expect(bash.childPlan["req-live-1"]).toEqual(first.childPlan["req-live-1"]);

    const next = applyTranscriptPatch(
      bash,
      {
        lines: [
          "tool · TodoWrite",
          "  [x] Add the failing test",
          "  [x] Implement the fix",
          "  [·] Open the pull request",
        ],
        live: null,
        plan: [
          { mark: "x", text: "Add the failing test" },
          { mark: "x", text: "Implement the fix" },
          { mark: "·", text: "Open the pull request" },
        ],
      },
      4,
      "req-live-1",
    );
    expect(next.childPlan["req-live-1"]).toEqual([
      { mark: "x", text: "Add the failing test" },
      { mark: "x", text: "Implement the fix" },
      { mark: "·", text: "Open the pull request" },
    ]);
  });

  it("pins a child's last hunk and keeps it when the next patch has none", () => {
    const first = applyTranscriptPatch(
      emptyView("epic"),
      {
        lines: ["tool · Write src/a.ts", "+ export const a = 1;"],
        live: null,
        hunk: ["+ export const a = 1;"],
      },
      1,
      "req-live-1",
    );
    expect(first.childHunks["req-live-1"]).toEqual([
      { file: "src/a.ts", lines: ["+ export const a = 1;"] },
    ]);

    const bash = applyTranscriptPatch(
      first,
      { lines: ["  Test Files  1 passed (1)"], live: null },
      2,
      "req-live-1",
    );
    expect(bash.childHunks["req-live-1"]).toEqual([
      { file: "src/a.ts", lines: ["+ export const a = 1;"] },
    ]);

    const next = applyTranscriptPatch(
      bash,
      {
        lines: ["tool · Write src/b.ts", "+ export const b = 2;"],
        live: null,
        hunk: ["+ export const b = 2;"],
      },
      3,
      "req-live-1",
    );
    expect(next.childHunks["req-live-1"]).toEqual([
      { file: "src/a.ts", lines: ["+ export const a = 1;"] },
      { file: "src/b.ts", lines: ["+ export const b = 2;"] },
    ]);

    const again = applyTranscriptPatch(
      next,
      {
        lines: ["tool · Write src/a.ts", "+ export const a = 3;"],
        live: null,
        hunk: ["+ export const a = 3;"],
        hunkFile: "src/a.ts",
      },
      4,
      "req-live-1",
    );
    expect(again.childHunks["req-live-1"]).toEqual([
      { file: "src/b.ts", lines: ["+ export const b = 2;"] },
      { file: "src/a.ts", lines: ["+ export const a = 3;"] },
    ]);
    expect(again.hunkAt).toBe(0);
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

  it("returns the selected row's pinned plan and hides the other child's", () => {
    const state = {
      ...emptyView("epic"),
      rows: [liveA, liveB],
      selected: 0,
      childPlan: {
        "req-live-1": [{ mark: "·" as const, text: "Implement the fix" }],
        "req-live-2": [{ mark: "x" as const, text: "Other child's work" }],
      },
    };
    expect(selectedPlan(state)).toEqual([{ mark: "·", text: "Implement the fix" }]);
    expect(selectedPlan({ ...state, selected: 1 })).toEqual([
      { mark: "x", text: "Other child's work" },
    ]);
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

describe("pushActivity", () => {
  it("keeps hundreds of lines from one request", () => {
    let state = emptyView("epic");
    for (let i = 0; i < 250; i += 1) {
      state = pushActivity(state, `tool · Write src/f${i}.ts`, i, "req-a");
    }
    expect(state.activity).toHaveLength(250);
    expect(state.activity[0]?.text).toBe("tool · Write src/f0.ts");
    expect(state.activity.at(-1)?.text).toBe("tool · Write src/f249.ts");
  });

  it("drops only the oldest overflow of that request and leaves another row's tools", () => {
    let state = emptyView("epic");
    for (let i = 0; i < ACTIVITY_CAP + 10; i += 1) {
      state = pushActivity(state, `a-${i}`, i, "req-a");
    }
    for (let i = 0; i < 50; i += 1) {
      state = pushActivity(state, `b-${i}`, 10_000 + i, "req-b");
    }
    const a = state.activity.filter((item) => item.requestId === "req-a");
    const b = state.activity.filter((item) => item.requestId === "req-b");
    expect(a).toHaveLength(ACTIVITY_CAP);
    expect(a[0]?.text).toBe("a-10");
    expect(a.at(-1)?.text).toBe(`a-${ACTIVITY_CAP + 9}`);
    expect(b).toHaveLength(50);
    expect(b[0]?.text).toBe("b-0");
  });

  it("does not cap the selected request so /find can still match an early tool", () => {
    const selected: StatusRow = {
      taskId: "LIVE-1--implement",
      issue: "LIVE-1",
      phase: "implement",
      status: "in_progress",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "LIVE-1--implement",
        workspacePath: "/tmp/ws",
        branch: "conductor/LIVE-1--implement",
        outcome: "running",
        reason: null,
        sessionId: "sess",
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: "child",
        requestId: "req-a",
        updatedAt: 1,
      },
      questions: [],
    };
    let state = { ...emptyView("epic"), rows: [selected] };
    state = pushActivity(state, "tool · Write src/early.ts", 0, "req-a");
    for (let i = 0; i < ACTIVITY_CAP + 5; i += 1) {
      state = pushActivity(state, `later-${i}`, i + 1, "req-a");
    }
    const mine = state.activity.filter((item) => item.requestId === "req-a");
    expect(mine).toHaveLength(ACTIVITY_CAP + 6);
    expect(mine[0]?.text).toBe("tool · Write src/early.ts");
    expect(findMatches({ ...state, find: "early.ts" })).toHaveLength(1);
  });
});

describe("viewFromEvents", () => {
  it("folds a Write and a plan into the same fields the reserved band reads", () => {
    const settled: StatusRow = {
      taskId: "FAIL-1--implement",
      issue: "FAIL-1",
      phase: "implement",
      status: "pending",
      attempts: 1,
      feedback: null,
      run: {
        attempt: 1,
        taskId: "FAIL-1--implement",
        workspacePath: null,
        branch: null,
        outcome: "failed",
        reason: "stopped",
        sessionId: null,
        finalMessage: null,
        usage: null,
        costUsd: null,
        childSessionId: null,
        requestId: "req-fail-1",
        updatedAt: 1,
      },
      questions: [],
    };
    const view = viewFromEvents(
      [
        {
          ...added({
            id: "t1",
            type: "tool_output",
            blockName: "Write",
            status: "completed",
            toolCall: {
              callId: "c1",
              name: "Write",
              arguments: JSON.stringify({
                file_path: "src/hello.js",
                contents: "export const hello = 1;\n",
              }),
              generatorBlock: "agent",
            },
          }),
          requestId: "req-fail-1",
          ts: 1,
        },
        {
          ...added({
            id: "t2",
            type: "tool_output",
            blockName: "TodoWrite",
            status: "completed",
            toolCall: {
              callId: "c2",
              name: "TodoWrite",
              arguments: JSON.stringify({
                todos: [
                  { content: "Add hello.js", status: "completed" },
                  { content: "Open the pull request", status: "pending" },
                ],
              }),
              generatorBlock: "agent",
            },
          }),
          requestId: "req-fail-1",
          ts: 2,
        },
      ],
      settled,
    );
    expect(selectedNow(view)).toBe("TodoWrite");
    expect(selectedFiles(view)).toEqual(["src/hello.js"]);
    expect(selectedHunk(view)).toEqual(["+ export const hello = 1;"]);
    expect(selectedPlan(view)).toEqual([
      { mark: "x", text: "Add hello.js" },
      { mark: " ", text: "Open the pull request" },
    ]);
  });
});
