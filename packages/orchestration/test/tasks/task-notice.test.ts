/**
 * The child-finished signal's module (FIX-1794 P2, S6 and S7, lifted into
 * orchestration by FIX-1816 S9): pure functions over a board row and the
 * notice it owes, and what that notice does, a waited-on row's included.
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
  cancelledDependents,
  clearNotice,
  decideNotice,
  deferredNoticePatch,
  deliveredByWait,
  heldWhileRunning,
  NOTICE_DUE_MS,
  noticeDueAt,
  isNoticeOwed,
  noticeKey,
  noticeTimes,
  noticeText,
  owedNotices,
  recordEnding,
  resendNowPatch,
  resentRecord,
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

  it("marks an attempt that failed for good with its error; a retry owes none, being the row's next start (FIX-2078)", () => {
    const errored = recordEnding(row({ status: "errored", error: "no network" }), { kind: "errored", error: "no network" });
    expect(owedNotices(errored, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "errored", error: "no network" }
    ]);
    const pending = row({ status: "pending" });
    expect(recordEnding(pending, { kind: "retried", error: "flaky" })).toBe(pending);
  });

  it("stamps when the notice falls due: two seconds after the ending's write, for the fast path to pay first", () => {
    const written = recordEnding(row({ updatedAt: 10_000 }), { kind: "completed", output: 1 });
    expect(noticeDueAt(written)).toBe(10_000 + NOTICE_DUE_MS);
    expect(noticeDueAt(row())).toBeUndefined();
    // A marker stored before FIX-2078 carries no due time: it is due at once.
    expect(noticeDueAt(row({ metadata: { "noticeOwed:1:completed": { attempt: 1, ending: "completed" } } }))).toBe(0);
  });

  it("drops an owed notice's resend backoff, so the next pass sends it at once (FIX-2113)", () => {
    const written = recordEnding(row({ updatedAt: 10_000 }), { kind: "completed", output: 1 });
    const notice = { attempt: 1, ending: "completed" } as const;
    // Sent again three times: the next send backs off well past its due time.
    const backedOff = { ...written, metadata: { ...written.metadata, ...resentRecord({ ...written, metadata: { ...written.metadata, "noticeResent:1:completed": { at: 20_000, n: 2 } } }, notice, 30_000) } };
    expect(noticeDueAt(backedOff)).toBeGreaterThan(30_000);
    const patch = resendNowPatch(backedOff);
    expect(patch).toEqual({ "noticeResent:1:completed": null });
    const now = { ...backedOff, metadata: { ...backedOff.metadata, ...patch } };
    expect(noticeDueAt(now)).toBe(10_000 + NOTICE_DUE_MS);
    // The owed marker itself stays; a row with no resend record needs nothing.
    expect(isNoticeOwed(now, notice)).toBe(true);
    expect(resendNowPatch(written)).toEqual({});
  });

  it("counts a turned-away notice's age from when it was turned away, not from its due time (FIX-2113)", () => {
    const written = recordEnding(row({ updatedAt: 10_000 }), { kind: "completed", output: 1 });
    const notice = { attempt: 1, ending: "completed" } as const;
    expect(noticeTimes(written, notice)?.since).toBe(10_000 + NOTICE_DUE_MS);
    const turnedAway = { ...written, metadata: { ...written.metadata, ...deferredNoticePatch(written, notice, 90_000) } };
    expect(noticeTimes(turnedAway, notice)).toMatchObject({ due: 10_000 + NOTICE_DUE_MS, since: 90_000 });
    // Still owed, and a row that owes nothing is left as it is.
    expect(isNoticeOwed(turnedAway, notice)).toBe(true);
    expect(deferredNoticePatch(row(), notice, 90_000)).toEqual({});
  });

  it("names the filing request a notice was last turned away for, until a copy is sent again (FIX-2149)", () => {
    // The pass sends such a notice past its backoff once that request parks
    // or ends: its backoff grew only while that request held it.
    const written = recordEnding(row({ updatedAt: 10_000 }), { kind: "completed", output: 1 });
    const notice = { attempt: 1, ending: "completed" } as const;
    const withMeta = (base: Task, patch: Record<string, unknown>): Task => ({ ...base, metadata: { ...base.metadata, ...patch } });
    const held = withMeta(written, deferredNoticePatch(written, notice, 20_000, "req_filing"));
    expect(heldWhileRunning(held, notice)).toBe("req_filing");
    // Its age still counts from the turn-away, as any other's.
    expect(noticeTimes(held, notice)?.since).toBe(20_000);
    // Sent again since: that copy's answer decides, with its backoff.
    const resent = withMeta(held, resentRecord(held, notice, 25_000));
    expect(heldWhileRunning(resent, notice)).toBeUndefined();
    // Turned away for it again after that resend: named again.
    expect(heldWhileRunning(withMeta(resent, deferredNoticePatch(resent, notice, 25_010, "req_filing")), notice)).toBe("req_filing");
    // A busy session's turn-away (defer), and one recorded before FIX-2149 (BP-030), name none.
    expect(heldWhileRunning(withMeta(written, deferredNoticePatch(written, notice, 20_000)), notice)).toBeUndefined();
    expect(heldWhileRunning(withMeta(written, { "noticeDeferred:1:completed": { at: 20_000 } }), notice)).toBeUndefined();
    // A notice no longer owed names none.
    expect(heldWhileRunning(withMeta(held, clearNotice(notice)), notice)).toBeUndefined();
  });

  it("owes a notice for a cancel the filer didn't make itself (D2)", () => {
    const base = row({ status: "cancelled" });
    expect(owedNotices(recordEnding(base, { kind: "cancelled", reason: "not needed" }), "tasks").map((n) => n.ending)).toEqual(["cancelled"]);
    // Its own model's cancel told the filer already.
    expect(recordEnding(base, { kind: "cancelled" }, { ownCancel: true })).toBe(base);
    // A dependent cancelled by a failure that shares its filer: that failure's notice names it.
    const cascaded = row({ status: "cancelled", causedBy: "t0" });
    expect(recordEnding(cascaded, { kind: "cancelled" }, { causeSharesFiler: true })).toBe(cascaded);
    // One whose cause another session filed is that filer's to hear.
    expect(owedNotices(recordEnding(cascaded, { kind: "cancelled" }, { causeSharesFiler: false }), "tasks")).toHaveLength(1);
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

  it("by a wait that found the row ended drops the ending's notice (FIX-2112)", () => {
    const completed = recordEnding(row({ attempts: 2 }), { kind: "completed", output: 1 });
    const read = { ...completed, metadata: { ...completed.metadata, ...deliveredByWait(completed) } } as Task;
    expect(owedNotices(read, "tasks")).toEqual([]);
    // A row still running owes nothing a wait could have read.
    expect(deliveredByWait(row({ status: "in_progress" }))).toEqual({});
    // A notice held for the request whose wait lapsed is that request's read to deliver, not this one's.
    const held = recordEnding(row({ wait: { gateId: "g", deadline: 1, requestId: "r", lapsed: true } } as Partial<Task>), { kind: "completed", output: 1 });
    expect(deliveredByWait(held)).toEqual({});
  });
});

describe("the dedupe key", () => {
  it("is the task, the attempt and the ending", () => {
    const base = { boardId: "tasks", taskId: "t1", attempt: 1, ending: "completed" } as const;
    const withOutput = { ...base, output: "anything" };
    expect(noticeKey(base)).toBe(noticeKey(withOutput));
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
    for (const ending of ["completed", "errored"] as const) {
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
  });
});

describe("a waited-on row's ending resumes the turn waiting on it, and wakes none (FIX-1816 S9)", () => {
  const waitedRow = (patch: Partial<Task> = {}) => row({ wait: { gateId: "wait:tasks:t1", deadline: 9 }, ...patch } as Partial<Task>);

  it("owes no notice for any ending: the turn waiting on it is resumed instead (FIX-2078)", () => {
    const completed = waitedRow({ output: "yes" });
    expect(recordEnding(completed, { kind: "completed", output: "yes" })).toBe(completed);
    const cancelled = waitedRow({ status: "cancelled", error: "not needed" });
    expect(recordEnding(cancelled, { kind: "cancelled", reason: "not needed" })).toBe(cancelled);
  });

  it("marks a notice stored before FIX-2078 waited on, so the receiving entry resumes rather than wakes", () => {
    const stored = waitedRow({ metadata: { "noticeOwed:1:completed": { attempt: 1, ending: "completed" } }, output: "yes" });
    expect(owedNotices(stored, "tasks")).toEqual([
      { boardId: "tasks", taskId: "t1", attempt: 1, ending: "completed", output: "yes", waitedOn: true }
    ]);
  });

  it("resumes, under either policy, instead of waking the judgment turn or landing a line", () => {
    for (const ending of ["completed", "errored", "cancelled"] as const) {
      const notice: TaskNotice = { boardId: "tasks", taskId: "t1", attempt: 1, ending, waitedOn: true };
      expect(decideNotice(notice, "judgment")).toEqual({ act: "resume-wait" });
      expect(decideNotice(notice, "fixed")).toEqual({ act: "resume-wait" });
    }
  });

  it("still runs the board again for a retried attempt: the wait isn't over", () => {
    const notice: TaskNotice = { boardId: "tasks", taskId: "t1", attempt: 1, ending: "retried", waitedOn: true };
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

describe("a failure or a cancel names the dependents it cancelled (FIX-2078 D2)", () => {
  const filer = { sessionId: "conversation" };
  const failed = row({ id: "f", status: "errored", error: "boom", filer } as Partial<Task>);
  const rows = [
    failed,
    row({ id: "d1", status: "cancelled", causedBy: "f", filer } as Partial<Task>),
    row({ id: "d2", status: "cancelled", causedBy: "f", filer: { sessionId: "someone-else" } } as Partial<Task>),
    row({ id: "d3", status: "pending", deps: ["f"], filer } as Partial<Task>),
    row({ id: "d4", status: "cancelled", causedBy: "other", filer } as Partial<Task>)
  ];

  it("names every dependent down a cascade, each of which owes no notice of its own", () => {
    const top = row({ id: "a", status: "errored", error: "boom", filer } as Partial<Task>);
    const chain = [
      top,
      row({ id: "b", status: "cancelled", causedBy: "a", filer } as Partial<Task>),
      row({ id: "c", status: "cancelled", causedBy: "b", filer } as Partial<Task>),
      // Another filer's row down the chain is told on its own.
      row({ id: "x", status: "cancelled", causedBy: "b", filer: { sessionId: "someone-else" } } as Partial<Task>)
    ];
    expect(cancelledDependents(top, chain).sort()).toEqual(["b", "c"]);
  });

  it("names a dependent filed after the upgrade by a cause filed before it, by the board's filer rule (BP-030)", () => {
    // The cause predates `Task.filer`; its board's legacy rule reads the conversation.
    const legacy = row({ id: "old", status: "errored", error: "boom" } as Partial<Task>);
    const later = row({ id: "new", status: "cancelled", causedBy: "old", filer } as Partial<Task>);
    const filerOf = (task: Task) => task.filer?.sessionId ?? "conversation";
    expect(cancelledDependents(legacy, [legacy, later], filerOf)).toEqual(["new"]);
    const written = recordEnding(legacy, { kind: "errored", error: "boom" });
    expect(owedNotices(written, "tasks", [written, later], filerOf)[0]?.cancelled).toEqual(["new"]);
  });

  it("lists only the cancels its ending caused that share its filer", () => {
    expect(cancelledDependents(failed, rows)).toEqual(["d1"]);
    const written = recordEnding(failed, { kind: "errored", error: "boom" });
    expect(owedNotices(written, "tasks", rows)[0]?.cancelled).toEqual(["d1"]);
    // Without the board's rows, a notice names none.
    expect(owedNotices(written, "tasks")[0]).not.toHaveProperty("cancelled");
  });

  it("says so in the notice's words", () => {
    const notice: TaskNotice = { boardId: "tasks", taskId: "f", attempt: 1, ending: "errored", error: "boom", cancelled: ["d1"] };
    expect(noticeText(notice, { goal: "Build it", assignee: "eng" })).toBe(
      'Task "Build it" (f) failed for good with eng: boom; it cancelled the tasks that depended on it: d1'
    );
  });
});
