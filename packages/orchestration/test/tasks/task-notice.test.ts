/**
 * The child-finished signal's module (FIX-1794 P2, S6 and S7, lifted into
 * orchestration by FIX-1816 S9): pure functions over a board row and the
 * notice it owes, and what that notice does, an asked row's included.
 *
 * Checked for what kept the lift a move rather than a rewrite: it imports
 * nothing but orchestration's own row and ending types, so no composing layer
 * (Workforce) can leak into it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { Task } from "../../src/tasks";
import {
  clearNotice,
  decideNotice,
  isNoticeOwed,
  noticeKey,
  noticeText,
  owedNotices,
  recordEnding,
  withoutNoticeMarkers,
  type TaskNotice
} from "../../src/tasks/notice/task-notice";

const MODULE = fileURLToPath(new URL("../../src/tasks/notice/task-notice.ts", import.meta.url));

/** A row as an ending write leaves it, before the recorder runs. */
function row(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    goal: "Audit our dependencies' licenses",
    status: "completed",
    attempts: 1,
    assignee: "researcher",
    createdAt: 1,
    updatedAt: 2,
    ...patch
  } as Task;
}

/**
 * Every module a source pulls in, in any form: `import … from`, a bare
 * `import "x"`, `export … from`, a dynamic `import("x")`, `require("x")` and
 * `import x = require("x")`. TypeScript's own pre-processor reads them, so a
 * form a hand-written pattern would miss can't slip past.
 */
function specifiersOf(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

describe("the module is layer-clean", () => {
  it("imports only orchestration's own task types: no composing layer, no package", () => {
    const specifiers = specifiersOf(readFileSync(MODULE, "utf8"));
    expect(specifiers.length).toBeGreaterThan(0);
    const tasksRoot = resolve(dirname(MODULE), "..");
    for (const specifier of specifiers) {
      expect(specifier, `${specifier} names a package`).toMatch(/^\./);
      expect(resolve(dirname(MODULE), specifier).startsWith(`${tasksRoot}/`), `${specifier} leaves src/tasks`).toBe(true);
    }
    expect(specifiers.sort()).toEqual(["../collection/ending", "../schema/task"]);
  });

  it("reads every form an import can take, so none gets past the check", () => {
    const forms = [
      'import { a } from "../workers/a";',
      'import "../workers/b";',
      'export { c } from "../workers/c";',
      'export * from "../workers/d";',
      'const e = await import("../workers/e");',
      'const f = require("../workers/f");',
      'import g = require("../workers/g");'
    ];
    expect(specifiersOf(forms.join("\n"))).toEqual(["a", "b", "c", "d", "e", "f", "g"].map((name) => `../workers/${name}`));
    // A comment that names a module imports nothing.
    expect(specifiersOf('// import("../workers/h")\n/* import "../workers/i"; */')).toEqual([]);
  });
});

describe("recordEnding: the row to write, with the notice owed", () => {
  it("marks a completed attempt as owed, in the row it returns", () => {
    const written = recordEnding(row({ output: { licenses: 12 } }), { kind: "completed", output: { licenses: 12 } });
    expect(owedNotices(written, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "completed", output: { licenses: 12 } }
    ]);
  });

  it("marks an attempt that failed for good with its error, and one with attempts left as retried", () => {
    const errored = recordEnding(row({ status: "errored", error: "no network" }), { kind: "errored", error: "no network" });
    expect(owedNotices(errored, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "errored", error: "no network" }
    ]);
    const retried = recordEnding(row({ status: "pending" }), { kind: "retried", error: "flaky" });
    expect(owedNotices(retried, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "retried", error: "flaky" }
    ]);
  });

  it("marks a park with its question (BR-25), and keeps it when the task completes later", () => {
    const parked = recordEnding(row({ status: "parked" }), { kind: "parked", question: "Which region?", quiet: false });
    const completed = recordEnding({ ...parked, status: "completed", attempts: 2, output: "eu" }, {
      kind: "completed",
      output: "eu"
    });
    expect(owedNotices(completed, "tasks").map((n) => [n.ending, n.attempt, n.question])).toEqual([
      ["parked", 1, "Which region?"],
      ["completed", 2, undefined]
    ]);
  });

  it("owes nothing for a cancel (BR-29), or for a park that asks nobody anything", () => {
    const base = row({ status: "cancelled" });
    expect(recordEnding(base, { kind: "cancelled", reason: "not needed" })).toBe(base);
    const quiet = row({ status: "parked" });
    // FIX-1802's split park: the board parks a row for its own reasons.
    expect(recordEnding(quiet, { kind: "parked", question: "waiting on my pieces", quiet: true })).toBe(quiet);
  });

  it("leaves the row's other metadata alone", () => {
    const written = recordEnding(row({ metadata: { source: "app" } }), { kind: "completed", output: null });
    expect(written.metadata).toMatchObject({ source: "app" });
  });
});

describe("a notice delivered", () => {
  const owed = recordEnding(row(), { kind: "completed", output: "done" });
  const [notice] = owedNotices(owed, "tasks") as [TaskNotice];

  it("is owed until its marker is cleared, by a metadata patch naming only it", () => {
    expect(isNoticeOwed(owed, notice)).toBe(true);
    const patch = clearNotice(notice);
    const cleared = { ...owed, metadata: { ...owed.metadata, ...patch } } as Task;
    expect(isNoticeOwed(cleared, notice)).toBe(false);
    expect(owedNotices(cleared, "tasks")).toEqual([]);
  });

  it("clears only its own marker, so a later ending's owed notice survives the clear", () => {
    const retried = recordEnding(row({ status: "pending" }), { kind: "retried", error: "flaky" });
    const [first] = owedNotices(retried, "tasks") as [TaskNotice];
    const completed = recordEnding({ ...retried, status: "completed", attempts: 2 }, { kind: "completed", output: 1 });
    const cleared = { ...completed, metadata: { ...completed.metadata, ...clearNotice(first) } } as Task;
    expect(owedNotices(cleared, "tasks").map((n) => n.ending)).toEqual(["completed"]);
  });
});

describe("the dedupe key", () => {
  it("is the task, the attempt and the ending", () => {
    const base = { boardId: "tasks", taskId: "t1", attempt: 1, ending: "completed" } as const;
    expect(noticeKey(base)).toBe(noticeKey({ ...base, output: "anything" }));
    expect(noticeKey(base)).not.toBe(noticeKey({ ...base, attempt: 2 }));
    expect(noticeKey(base)).not.toBe(noticeKey({ ...base, ending: "errored" }));
    expect(noticeKey(base)).not.toBe(noticeKey({ ...base, taskId: "t2" }));
  });
});

describe("what an ending does: one decision", () => {
  const notice = (ending: TaskNotice["ending"]): TaskNotice => ({ boardId: "tasks", taskId: "t1", attempt: 1, ending });

  it("re-runs the board for a retried attempt, with no turn (BR-23)", () => {
    expect(decideNotice(notice("retried"), "judgment")).toEqual({ act: "run-board" });
    expect(decideNotice(notice("retried"), "fixed")).toEqual({ act: "run-board" });
  });

  it("wakes the judgment turn for an ending, or lands a line under a fixed policy", () => {
    for (const ending of ["completed", "errored", "parked"] as const) {
      expect(decideNotice(notice(ending), "judgment")).toEqual({ act: "wake-turn" });
      expect(decideNotice(notice(ending), "fixed")).toEqual({ act: "line" });
    }
  });

  it("says the task, how it ended and what came back", () => {
    const task = { goal: "Audit licenses", assignee: "researcher" };
    expect(noticeText({ ...notice("completed"), output: { licenses: 12 } }, task)).toBe(
      'Task "Audit licenses" (t1) completed by researcher: {"licenses":12}'
    );
    expect(noticeText({ ...notice("errored"), error: "no network" }, task)).toBe(
      'Task "Audit licenses" (t1) failed for good with researcher: no network'
    );
    expect(noticeText({ ...notice("parked"), question: "Which region?" }, task)).toBe(
      'Task "Audit licenses" (t1) is waiting on a question from researcher: Which region?'
    );
  });
});

describe("an asked row's ending resumes the turn waiting on it, and wakes none (FIX-1816 S9)", () => {
  const asked = (patch: Partial<Task> = {}) => row({ ask: { gateId: "ask:tasks:t1", deadline: 9 }, ...patch } as Partial<Task>);

  it("marks its notices asked, so the receiving entry can tell", () => {
    const completed = recordEnding(asked({ output: "yes" }), { kind: "completed", output: "yes" });
    expect(owedNotices(completed, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "completed", output: "yes", asked: true }
    ]);
    // A row nobody waits on is not marked.
    expect(owedNotices(recordEnding(row(), { kind: "completed", output: 1 }), "tasks")[0]).not.toHaveProperty("asked");
  });

  it("owes a notice for a cancel too: its turn waits on every ending, where a filed row's cancel stays silent", () => {
    const cancelled = recordEnding(asked({ status: "cancelled", error: "not needed" }), { kind: "cancelled", reason: "not needed" });
    expect(owedNotices(cancelled, "tasks").map((n) => [n.ending, n.asked])).toEqual([["cancelled", true]]);
    const filed = row({ status: "cancelled" });
    expect(recordEnding(filed, { kind: "cancelled" })).toBe(filed);
  });

  it("resumes, under either policy, instead of waking the judgment turn or landing a line", () => {
    for (const ending of ["completed", "errored", "cancelled"] as const) {
      const notice: TaskNotice = { boardId: "tasks", taskId: "t1", attempt: 1, ending, asked: true };
      expect(decideNotice(notice, "judgment")).toEqual({ act: "resume-ask" });
      expect(decideNotice(notice, "fixed")).toEqual({ act: "resume-ask" });
    }
  });

  it("still runs the board again for a retried attempt: the ask isn't over", () => {
    const notice: TaskNotice = { boardId: "tasks", taskId: "t1", attempt: 1, ending: "retried", asked: true };
    expect(decideNotice(notice, "judgment")).toEqual({ act: "run-board" });
  });
});

describe("caller writes can't reach the markers", () => {
  it("drops a notice marker from metadata a caller hands in, and keeps the rest", () => {
    const forged = { ...recordEnding(row(), { kind: "completed", output: 1 }).metadata, note: "mine" };
    expect(withoutNoticeMarkers(forged)).toEqual({ note: "mine" });
    expect(withoutNoticeMarkers(undefined)).toBeUndefined();
  });
});
