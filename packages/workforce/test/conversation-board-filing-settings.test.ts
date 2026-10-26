/**
 * A delegated task runs where, when and how often its filer chose at filing,
 * and nothing it filed outlives it (FIX-2080), on the real engine.
 *
 * - **Session.** A task filed `session: "ongoing"` runs in the delegate's
 *   session for the conversation, not a session of its own, and two of them
 *   take turns there: one open task per session.
 * - **From a task's session**, neither conversation setting is taken: the
 *   filing is refused, naming the setting, and nothing is filed.
 * - **Result.** A conversation-result task has one attempt.
 * - **The filed cascade.** A task that filed work and then fails, retries or is
 *   cancelled takes that work with it: each open piece it filed is cancelled,
 *   whichever session ended it.
 *
 * Each leg acts through the splitter fixture's turns (`./split-harness`),
 * which write through the very ref the task tools do, and reads the store.
 */
import { describe, expect, it } from "vitest";
import { bootSplitHost, type SplitHost } from "./split-harness";
import { openHolds } from "@flow-state-dev/orchestration/tasks";

/** The one row filed with `goal`. */
async function one(h: SplitHost, goal: string) {
  const rows = await h.rowsNamed("alice", goal);
  expect(rows, goal).toHaveLength(1);
  return rows[0]!;
}

describe("filing settings on a conversation's board (FIX-2080)", () => {
  it("runs an ongoing task in the delegate's session for the conversation, two of them one at a time", async () => {
    const h = bootSplitHost();
    try {
      // s1's own conversation (not a task session), whose delegates take tasks.
      h.controls.plans.s1 = [
        { goal: "[slow:300] Check the logs", assignee: "eng.tasker", session: "ongoing" },
        { goal: "Then check the alerts", assignee: "eng.tasker", session: "ongoing" },
        { goal: "Plan the release", assignee: "eng.tasker" }
      ];
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const logs = await one(h, "[slow:300] Check the logs");
      const alerts = await one(h, "Then check the alerts");
      const plan = await one(h, "Plan the release");
      expect([logs.status, alerts.status, plan.status]).toEqual(["completed", "completed", "completed"]);
      expect(logs.session).toBe("ongoing");
      // Both ongoing tasks ran in one session, which is not a task session of
      // either; the plain task got a session of its own.
      const sessionOf = (message: string) => h.runs.find((run) => run.message === message)?.sessionId;
      expect(sessionOf("[slow:300] Check the logs")).toBeDefined();
      expect(sessionOf("Then check the alerts")).toBe(sessionOf("[slow:300] Check the logs"));
      expect(sessionOf("Plan the release")).not.toBe(sessionOf("[slow:300] Check the logs"));
      // One at a time: the second started only after the first ended.
      expect(alerts.startedAt!).toBeGreaterThanOrEqual(logs.completedAt!);
    } finally {
      await h.dispose();
    }
  });

  it("refuses both conversation settings from a task's session, naming the setting, and files nothing", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue", assignee: "eng.tasker", session: "ongoing" },
        { goal: "Tell everyone", assignee: "eng.tasker", resultTo: "conversation" }
      ];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused.map((r) => r.error)).toEqual(["TaskFilingRefusedError", "TaskFilingRefusedError"]);
      expect(refused[0]!.message).toMatch(/^setting_not_from_task_session: .*session "ongoing"/);
      expect(refused[1]!.message).toMatch(/^setting_not_from_task_session: .*resultTo "conversation"/);
      expect(await h.rowsNamed("alice", "Book the venue")).toHaveLength(0);
      expect(await h.rowsNamed("alice", "Tell everyone")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a whole batch from a task's session when one row asks for a conversation setting, and files none of it", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the offsite", assignee: "s1" }];
      // The first row is fine on its own; the second is not a task session's to ask for.
      h.controls.plans.s1 = [
        { goal: "Pick the dates", assignee: "eng.tasker" },
        { goal: "Book the flights", assignee: "eng.tasker", session: "ongoing" }
      ];
      h.controls.batch.add("s1");
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.message).toMatch(/^setting_not_from_task_session: .*session "ongoing"/);
      expect(await h.rowsNamed("alice", "Pick the dates")).toHaveLength(0);
      expect(await h.rowsNamed("alice", "Book the flights")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a batch that names one id twice, and files none of it", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.s1 = [
        { goal: "Draft the agenda", assignee: "eng.tasker", id: "task_agenda" },
        { goal: "Draft the agenda again", assignee: "eng.tasker", id: "task_agenda" }
      ];
      h.controls.batch.add("s1");
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.message).toMatch(/^duplicate_task_id: .*"task_agenda"/);
      expect(await h.rowsNamed("alice", "Draft the agenda")).toHaveLength(0);
      expect(await h.rowsNamed("alice", "Draft the agenda again")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a follow-up of a task that hasn't run yet: there is no session to follow up in", async () => {
    // A follow-up runs in the session its root ran in. A root that is held,
    // or still waiting to start, has none; the follow-up must not take it first.
    const h = bootSplitHost();
    try {
      h.controls.plans.s1 = [
        { goal: "Draft the brief", assignee: "eng.tasker", id: "task_brief", held: true },
        { goal: "Polish the brief", followUpOf: "task_brief" }
      ];
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.message).toMatch(/^follow_up_of_unrun: task "task_brief" never ran/);
      expect(await h.rowsNamed("alice", "Polish the brief")).toHaveLength(0);
      expect((await one(h, "Draft the brief")).status).toBe("held");
    } finally {
      await h.dispose();
    }
  });

  it("refuses a follow-up whose root is filed in the same batch, and files none of it", async () => {
    // A root filed beside its follow-up has never run either: the follow-up
    // would run first, in the root's session, while the root stays held.
    const h = bootSplitHost();
    try {
      h.controls.plans.s1 = [
        { goal: "Draft the brief", assignee: "eng.tasker", id: "task_brief", held: true },
        { goal: "Polish the brief", assignee: "eng.tasker", followUpOf: "task_brief" }
      ];
      h.controls.batch.add("s1");
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.message).toMatch(/^follow_up_of_unrun: task "task_brief" never ran/);
      expect(await h.rowsNamed("alice", "Polish the brief")).toHaveLength(0);
      expect(await h.rowsNamed("alice", "Draft the brief")).toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a batch naming an id already on the board, and files none of it", async () => {
    // The second batch reuses the first task's id. Rows are added one at a
    // time, so a collision found at its add would leave the rows before it filed.
    const h = bootSplitHost();
    try {
      h.controls.batch.add("s1");
      h.controls.plans.s1 = [{ goal: "Draft the brief", assignee: "eng.tasker", id: "task_brief" }];
      h.controls.onCompleted.s1 = [
        { goal: "Polish the brief", assignee: "eng.tasker" },
        { goal: "Draft the brief again", assignee: "eng.tasker", id: "task_brief" }
      ];
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const refused = h.controls.refusals.filter((r) => r.worker === "s1");
      expect(refused).toHaveLength(1);
      expect(refused[0]!.message).toMatch(/^duplicate_task_id: .*"task_brief"/);
      expect(await h.rowsNamed("alice", "Polish the brief")).toHaveLength(0);
      expect((await one(h, "Draft the brief")).status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("gives a conversation-result task one attempt", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.s1 = [{ goal: "[fail] Summarize the conversation", assignee: "eng.tasker", resultTo: "conversation" }];
      const conversation = await h.open("alice", "s1");
      await h.turn("alice", conversation);
      await h.settled();

      const row = await one(h, "[fail] Summarize the conversation");
      expect(row).toMatchObject({ resultTo: "conversation", maxAttempts: 1, attempts: 1, status: "errored" });
      expect(h.runs.filter((run) => run.message === "[fail] Summarize the conversation")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("the work a task filed goes with it (FIX-2080 D2)", () => {
  it("cancels the open piece a task filed when its attempt fails and retries, and again when it fails for good", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "[slow:3000] Book the venue", assignee: "eng.tasker" }];
      h.controls.failAfterFiling.add("s1");
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const top = await one(h, "Plan the launch");
      expect(top).toMatchObject({ status: "errored", attempts: 2 });
      // Each attempt filed the piece again, and each attempt's ending took it.
      const pieces = await h.rowsNamed("alice", "[slow:3000] Book the venue");
      expect(pieces).toHaveLength(2);
      expect(pieces.map((piece) => piece.status)).toEqual(["cancelled", "cancelled"]);
      // The retry ran the task's turn again, rather than waiting on cancelled work.
      // (Its session also hears each piece's cancel, cascaded from above it,
      // FIX-2078 D2: those turns are woken by a notice.)
      expect(h.controls.turns.filter((turn) => turn.worker === "s1" && !turn.message.startsWith('Task "'))).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a piece filed after its task was cancelled, so it never outlives the task (FIX-2129)", async () => {
    // The task's ending finds nothing filed yet, so its cascade cancels
    // nothing; the piece is filed after. The filing reads the task as stored
    // and is refused before anything is added, so no claimable row exists.
    const h = bootSplitHost();
    try {
      let file!: () => void;
      h.controls.holdBeforeFiling.s1 = new Promise<void>((resolve) => (file = resolve));
      h.controls.plans.planner = [{ goal: "Plan the retreat", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "[slow:3000] Book the cabin", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      expect(await h.until(async () => h.controls.turns.some((turn) => turn.worker === "s1"))).toBe(true);
      const top = await one(h, "Plan the retreat");
      expect(await h.tool("alice", planner, "updateTask", { id: top.id, status: "cancelled" })).toEqual({ ok: true });
      file();
      expect(await h.until(async () => h.controls.refusals.some((r) => r.worker === "s1"))).toBe(true);
      await h.settled();

      expect((await one(h, "Plan the retreat")).status).toBe("cancelled");
      expect(h.controls.refusals.find((r) => r.worker === "s1")).toMatchObject({ error: "TaskFilingRefusedError", message: expect.stringMatching(/^parent_cancelled:/) });
      expect(await h.rowsNamed("alice", "[slow:3000] Book the cabin")).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 20_000);

  // A task's run found waiting on the user when its task is cancelled resumes
  // `{ cancelled: true }` and runs on: whatever it files then is refused under
  // the task it works, in every session a task can run in. That task is the
  // row whose run link names the resumed request, whatever the session's own
  // state names (a follow-up's session names its root; an ongoing one, none).
  const sessions: Array<{
    where: string;
    /** Files the task, and returns its goal: the row to cancel. */
    file: (h: SplitHost, planner: string) => Promise<string>;
  }> = [
    {
      where: "a session of its own",
      file: async (h, planner) => {
        h.controls.plans.planner = [{ goal: "Plan the offsite", assignee: "s1" }];
        h.controls.waitForUserBeforeFiling.add("s1");
        await h.turn("alice", planner);
        return "Plan the offsite";
      }
    },
    {
      where: "the delegate's ongoing session, which names no task",
      file: async (h, planner) => {
        h.controls.plans.planner = [{ goal: "Plan the offsite", assignee: "s1", session: "ongoing" }];
        h.controls.waitForUserBeforeFiling.add("s1");
        await h.turn("alice", planner);
        return "Plan the offsite";
      }
    },
    {
      where: "its root's session (a follow-up), which names the root",
      file: async (h, planner) => {
        h.controls.plans.planner = [{ goal: "Plan the offsite", assignee: "s1" }];
        const piece = h.controls.plans.s1;
        h.controls.plans.s1 = [];
        await h.turn("alice", planner);
        await h.settled();
        const root = await one(h, "Plan the offsite");
        expect(root.status).toBe("completed");
        h.controls.plans.s1 = piece;
        h.controls.waitForUserBeforeFiling.add("s1:Add a second hall");
        expect(await h.tool("alice", planner, "createTask", { goal: "Add a second hall", followUpOf: root.id })).toMatchObject({ ok: true });
        return "Add a second hall";
      }
    }
  ];

  it.each(sessions)("refuses a piece filed by a task cancelled while it waited on the user, in $where (FIX-2129)", async ({ file }) => {
    const h = bootSplitHost({ durable: true });
    try {
      h.controls.plans.s1 = [{ goal: "[slow:3000] Book the hall", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      const goal = await file(h, planner);
      expect(await h.until(async () => openHolds(await one(h, goal)).some((hold) => hold.source.kind === "suspension"))).toBe(true);
      const task = await one(h, goal);
      expect(await h.tool("alice", planner, "updateTask", { id: task.id, status: "cancelled" })).toEqual({ ok: true });
      expect(await h.until(async () => h.controls.refusals.some((r) => r.worker === "s1"))).toBe(true);
      await h.settled();

      expect(h.controls.answered).toEqual([{ worker: "s1", answer: { cancelled: true } }]);
      expect((await one(h, goal)).status).toBe("cancelled");
      expect(h.controls.refusals.find((r) => r.worker === "s1")).toMatchObject({ error: "TaskFilingRefusedError", message: expect.stringMatching(/^parent_cancelled:/) });
      expect(await h.rowsNamed("alice", "[slow:3000] Book the hall")).toEqual([]);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  it("cancels the open piece a running task filed within seconds of the conversation cancelling the task", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "[slow:6000] Book the venue", assignee: "eng.tasker" }];
      // The task's turn runs on long after the cancel, so nothing it does when
      // it ends can be what cancels the piece.
      h.controls.holdAfterFiling.s1 = 5000;
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      // Wait until the piece is filed and the task is still running its turn.
      expect(await h.until(async () => (await h.rowsNamed("alice", "[slow:6000] Book the venue")).length === 1)).toBe(true);
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("in_progress");

      expect(await h.tool("alice", planner, "updateTask", { id: top.id, status: "cancelled" })).toEqual({ ok: true });
      const cancelledAt = Date.now();
      const pieceCancelled = await h.until(
        async () => (await one(h, "[slow:6000] Book the venue")).status === "cancelled",
        2500
      );
      expect(pieceCancelled).toBe(true);
      // Paid while the task's turn was still running, not when it ended.
      expect(Date.now() - cancelledAt).toBeLessThan(4000);
      expect(h.controls.turns.filter((turn) => turn.worker === "s1")).toHaveLength(1);
      await h.settled();

      expect((await one(h, "Plan the launch")).status).toBe("cancelled");
      expect((await one(h, "[slow:6000] Book the venue")).status).toBe("cancelled");
    } finally {
      await h.dispose();
    }
  }, 20_000);
});
