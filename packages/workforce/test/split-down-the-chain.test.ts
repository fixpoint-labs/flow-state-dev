/**
 * The split and its limits (FIX-1802 P2: V3, V4 and V5's second half; FIX-2077).
 *
 * A task session files pieces on its own board. Its task stays running on the
 * board above, waiting on them with no lease, and the request each piece's
 * ending wakes in the task session runs for the task: the claim gate's one
 * check at that request's end settles it once no piece holds it, with the
 * answer of the last turn woken (FIX-2077 D3). A chain is at most five boards
 * deep, and one top task has at most 100 tasks under it (or the app's own
 * limit).
 *
 * Each leg acts through the flows' public actions and the turns of the
 * splitter fixture (`./split-harness`), whose turns write through the same ref
 * the task tools do, and reads what it asserts back from the store.
 */
import { describe, expect, it } from "vitest";
import { NOTICE_DUE_MS } from "@flow-state-dev/orchestration/tasks";
import { chainEntryKey, DEFAULT_TASK_CHAIN_LIMIT } from "../src/conversation-board/chain";
import { bootSplitHost, type SplitHost } from "./split-harness";

/** The one row filed with `goal`. */
async function one(h: SplitHost, goal: string) {
  const rows = await h.rowsNamed("alice", goal);
  expect(rows, goal).toHaveLength(1);
  return rows[0]!;
}

/** The notices a session acted on, once each: task and ending. */
async function heard(h: SplitHost, sessionId: string) {
  return [...new Set((await h.noticesIn(sessionId)).map((notice) => `${notice?.taskId}:${notice?.ending}`))].sort();
}

/** The lines a session's notices landed as, about `goal`. */
async function linesAbout(h: SplitHost, sessionId: string, goal: string) {
  return (await h.messages(sessionId)).filter((message) => message.text.includes(`Task "${goal}"`)).map((message) => message.text);
}

/** Whether the row filed with `goal` is running and waiting on the work it filed. */
async function waitingOnItsPieces(h: SplitHost, goal: string) {
  const row = (await h.rowsNamed("alice", goal))[0];
  return row?.status === "in_progress" && row.keptOpenBy === "filed";
}

/** The turns a task session ran on its pieces' notices. */
function wokenTurns(h: SplitHost, sessionId: string) {
  return h.controls.turns.filter((turn) => turn.sessionId === sessionId && turn.message.startsWith('Task "'));
}

describe("a task session splits its task (BR-14, BR-16, V5, FIX-2077)", () => {
  it("files pieces on its own board, stays running with no lease and no notice while they are open, and completes with the last woken turn's answer", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue [slow:300]", assignee: "eng.tasker" },
        { goal: "Print the flyers [slow:300]", assignee: "eng.writer" }
      ];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      // While its pieces run: running, waiting on them, with no lease to lapse.
      expect(await h.until(() => waitingOnItsPieces(h, "Plan the launch"))).toBe(true);
      expect((await one(h, "Plan the launch")).leaseUntil).toBeUndefined();
      await h.settled();

      const top = await one(h, "Plan the launch");
      expect(top).toMatchObject({ status: "completed", assignee: "s1", attempts: 1 });
      expect(top.keptOpenBy).toBeUndefined();
      const pieces = [await one(h, "Book the venue [slow:300]"), await one(h, "Print the flyers [slow:300]")];
      expect(pieces.map((row) => row.status)).toEqual(["completed", "completed"]);
      // The pieces are on the task session's own board, not the top's.
      expect(pieces[0]!.partition).toBe(pieces[1]!.partition);
      expect(pieces[0]!.partition).not.toBe(top.partition);
      // Its output is its worker's answer, from the turn the last piece's ending woke (D3).
      const t1 = await h.taskSessionOf("alice", top.id);
      const woken = wokenTurns(h, t1);
      expect(woken).toHaveLength(2);
      expect(top.output).toBe(`s1 heard: ${woken[1]!.message}`);
      // planner heard one notice for its task: the completion.
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      // s1's task session heard each piece once; its turn ran once on the task, once on each notice.
      expect(await heard(h, t1)).toEqual(pieces.map((row) => `${row.id}:completed`).sort());
      expect(h.controls.turns.filter((turn) => turn.sessionId === t1 && !turn.message.startsWith('Task "'))).toHaveLength(1);
      expect(await h.chains("alice")).toEqual({});
    } finally {
      await h.dispose();
    }
  });

  it("runs a follow-up's own turn in the session that split the task it follows, apart from that task's pieces", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      const t1 = await h.taskSessionOf("alice", top.id);

      // The follow-up files nothing of its own: it is answered by its turn.
      h.controls.plans.s1 = [];
      const followUp = await h.tool("alice", planner, "createTask", { goal: "Add a second venue", followUpOf: top.id });
      expect(followUp.ok).toBe(true);
      await h.settled();
      const row = await one(h, "Add a second venue");
      expect(row.status).toBe("completed");
      expect(row.output).toBe("s1 heard: Add a second venue");
      expect(h.controls.turns.filter((turn) => turn.sessionId === t1 && turn.message === "Add a second venue")).toHaveLength(1);
      expect(await h.rowsNamed("alice", "Book the venue")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("a piece that fails for good fails nothing alone: the turn its ending wakes decides, and its answer completes the task (D3)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue", assignee: "eng.tasker" },
        { goal: "Print the flyers [fail]", assignee: "eng.writer" }
      ];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      expect((await one(h, "Print the flyers [fail]")).status).toBe("errored");
      const top = await one(h, "Plan the launch");
      expect(top).toMatchObject({ status: "completed", attempts: 1 });
      const t1 = await h.taskSessionOf("alice", top.id);
      // The failure reached the worker's turn, which read it and answered.
      const failure = wokenTurns(h, t1).find((turn) => turn.message.includes("failed for good"));
      expect(failure).toBeDefined();
      expect(typeof top.output).toBe("string");
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      expect(await linesAbout(h, planner, "Plan the launch")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("stays open while the turn a failure woke files the work again, and completes once that piece does", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Print the flyers [fail]", assignee: "eng.tasker" }];
      h.controls.onErrored.s1 = { goal: "Print the flyers again", assignee: "eng.writer" };
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const failed = await one(h, "Print the flyers [fail]");
      const again = await one(h, "Print the flyers again");
      expect(failed.status).toBe("errored");
      expect(again.status).toBe("completed");
      // No retry marker: the turn decided, and its pieces are plain pieces of the task.
      expect(again.metadata?.retryOf).toBeUndefined();
      expect(again.filedByTask).toBe((await one(h, "Plan the launch")).id);
      const top = await one(h, "Plan the launch");
      // The task waited for the piece filed again before it settled.
      expect(top.updatedAt).toBeGreaterThanOrEqual(again.updatedAt);
      expect(top.status).toBe("completed");
      expect(top.output).toMatch(/^s1 heard: Task "Print the flyers again"/);
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
    } finally {
      await h.dispose();
    }
  });

  it("fails the attempt when the turn a piece's ending wakes throws, and fails for good when its retry's turn throws too", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      h.controls.failNoticeTurn.add("s1");
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("errored");
      expect(top.attempts).toBe(2);
      expect(top.error).toContain("s1's turn failed on the notice");
      expect(await heard(h, planner)).toEqual([`${top.id}:errored`]);
    } finally {
      await h.dispose();
    }
  });

  it("settles at its due time when the last piece's notice never reached the task session, with no touch (BR-17, FIX-2078)", async () => {
    const h = bootSplitHost({ durable: true });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue [slow:150]", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      // The task waits; then every notice is lost, as a process that died
      // before sending it would lose it.
      expect(await h.until(() => waitingOnItsPieces(h, "Plan the launch"))).toBe(true);
      const lost = await h.loseDispatches("onTaskSettled");
      await h.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      lost.restore();
      expect((await one(h, "Book the venue [slow:150]")).status).toBe("completed");
      expect(await waitingOnItsPieces(h, "Plan the launch")).toBe(true);
      expect(await h.until(async () => (await one(h, "Plan the launch")).status === "completed", 8_000)).toBe(true);
      await h.settled();
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      const t1 = await h.taskSessionOf("alice", top.id);
      expect(wokenTurns(h, t1)).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("settles each board once, two boards down", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Run the event", assignee: "s2" }];
      h.controls.plans.s2 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      const middle = await one(h, "Run the event");
      const top = await one(h, "Plan the launch");
      expect([middle.status, top.status]).toEqual(["completed", "completed"]);
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      expect(await heard(h, await h.taskSessionOf("alice", top.id))).toEqual([`${middle.id}:completed`]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a split task's result is its worker's answer (FIX-2077 D3)", () => {
  it("completes with the answer of the turn the last piece's ending woke, and nothing else", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      // What the worker concluded from the piece is what the filer asked for.
      const t1 = await h.taskSessionOf("alice", top.id);
      const woken = wokenTurns(h, t1);
      expect(woken).toHaveLength(1);
      expect(top.output).toBe(`s1 heard: ${woken[0]!.message}`);
      // The filer hears the answer.
      const line = (await linesAbout(h, planner, "Plan the launch"))[0]!;
      expect(line).toContain("completed by s1: s1 heard: Task");
    } finally {
      await h.dispose();
    }
  });

  it("holds while a woken turn files another piece, then completes with the answer of the last turn woken", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      h.controls.onCompleted.s1 = { goal: "Order the snacks", assignee: "eng.writer" };
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const snacks = await one(h, "Order the snacks");
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      expect(top.updatedAt).toBeGreaterThanOrEqual(snacks.updatedAt);
      // Not the turn that filed the snacks: the one their ending woke.
      expect(top.output).toMatch(/^s1 heard: Task "Order the snacks"/);
    } finally {
      await h.dispose();
    }
  });

  for (const answer of ["", null]) {
    it(`keeps a woken turn's answer that is ${JSON.stringify(answer)}: it answered, so the task completes with it`, async () => {
      const h = bootSplitHost();
      try {
        h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
        h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
        h.controls.noticeAnswer.s1 = answer;
        const planner = await h.open("alice", "planner");
        await h.turn("alice", planner);
        await h.settled();
        const top = await one(h, "Plan the launch");
        expect(top.status).toBe("completed");
        expect(top.output).toBe(answer);
      } finally {
        await h.dispose();
      }
    });
  }

  it("waits for every piece's notice before it settles, so the answer is the turn the last one woke, though both pieces ended first", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue [slow:150]", assignee: "eng.tasker" },
        { goal: "Print the flyers [slow:150]", assignee: "eng.writer" }
      ];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      expect(await h.until(() => waitingOnItsPieces(h, "Plan the launch"))).toBe(true);
      // Both pieces end before either notice runs.
      const lost = await h.loseDispatches("onTaskSettled");
      await h.settled();
      lost.restore();
      expect((await one(h, "Book the venue [slow:150]")).status).toBe("completed");
      expect((await one(h, "Print the flyers [slow:150]")).status).toBe("completed");
      // The pieces' notices are still owed, so the task still waits on them.
      expect(await waitingOnItsPieces(h, "Plan the launch")).toBe(true);
      const t1 = await h.taskSessionOf("alice", (await one(h, "Plan the launch")).id);

      // A touch once they are past due sends both notices (FIX-2078: a touch resends only what is past due).
      await new Promise((resolve) => setTimeout(resolve, NOTICE_DUE_MS + 200));
      await h.tool("alice", t1, "listTasks", {});
      await h.settled();
      const woken = wokenTurns(h, t1);
      expect(woken).toHaveLength(2);
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      expect(top.output).toBe(`s1 heard: ${woken[1]!.message}`);
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a task session's pieces go only to its delegates (FIX-2081)", () => {
  it("files through the task tools to a delegate; a worker on the roster that isn't one, a worker off it, or one that takes no task is refused", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue [slow:400]", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      expect(await h.until(() => waitingOnItsPieces(h, "Plan the launch"))).toBe(true);
      const t1 = await h.taskSessionOf("alice", (await one(h, "Plan the launch")).id);

      // d1 is on alice's roster and takes tasks, and isn't one of s1's delegates.
      const notDelegate = await h.tool("alice", t1, "createTask", { goal: "Ask d1", assignee: "d1" });
      expect(notDelegate).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "d1"/) });
      const viaCreate = await h.tool("alice", t1, "createTask", { goal: "Ask d1 later", assignee: "d1" });
      expect(viaCreate).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "d1"/) });
      const offRoster = await h.tool("alice", t1, "createTask", { goal: "Ask nobody", assignee: "nobody" });
      expect(offRoster).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "nobody"/) });
      // A delegate takes it.
      expect(await h.tool("alice", t1, "createTask", { goal: "Ask the tasker", assignee: "eng.tasker" })).toMatchObject({ ok: true });
      // Its own worker is no delegate: a step for itself is filed only by its own turn (FIX-2076),
      // never by an action, and never as a task session of itself.
      h.controls.plans.s1 = [];
      expect(await h.tool("alice", t1, "createTask", { goal: "Ask myself", assignee: "s1" })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^unknown_assignee: "s1"/)
      });
      await h.settled();

      expect(await h.rowsNamed("alice", "Ask d1")).toEqual([]);
      expect(await h.rowsNamed("alice", "Ask d1 later")).toEqual([]);
      expect(await h.rowsNamed("alice", "Ask nobody")).toEqual([]);
      expect(await h.rowsNamed("alice", "Ask myself")).toEqual([]);
      expect((await one(h, "Ask the tasker")).status).toBe("completed");
      expect((await one(h, "Plan the launch")).status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });
});

describe("a split task changed from above while its pieces are open (BR-19)", () => {
  it("declines a reassign, and a cancel cancels its open pieces down the chain, through the filed cascade (FIX-2080)", async () => {
    // Durable: the pieces' cancels are heard by the task session through its
    // wake, which the conversation that cancelled can't address (FIX-2078).
    // The two leaf pieces are held open until the cancel has been issued, so
    // the cascade, not the clock, decides how they end.
    let release!: () => void;
    const cancelIssued = new Promise<void>((resolve) => (release = resolve));
    const holds = new Map([["until-cancel", cancelIssued]]);
    const h = bootSplitHost({ durable: true, holds });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue [hold:until-cancel]", assignee: "eng.tasker" },
        { goal: "Run the event", assignee: "s2" }
      ];
      h.controls.plans.s2 = [{ goal: "Hire the band [hold:until-cancel]", assignee: "eng.writer" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      expect(
        await h.until(async () => (await waitingOnItsPieces(h, "Plan the launch")) && (await waitingOnItsPieces(h, "Run the event")))
      ).toBe(true);
      const top = await one(h, "Plan the launch");

      const reassign = await h.tool("alice", planner, "updateTask", { id: top.id, assignee: "s1" });
      expect(reassign.ok).toBe(false);
      expect(JSON.stringify(reassign)).toContain("field_locked_after_start");

      expect((await h.tool("alice", planner, "updateTask", { id: top.id, status: "cancelled" })).ok).toBe(true);
      // The held pieces now finish their turns; a cancelled row keeps its ending.
      release();
      await h.settled();
      const rows = Object.fromEntries((await h.rows("alice")).map((row) => [row.goal, row.status]));
      expect(rows).toEqual({
        "Plan the launch": "cancelled",
        "Book the venue [hold:until-cancel]": "cancelled",
        "Run the event": "cancelled",
        "Hire the band [hold:until-cancel]": "cancelled"
      });
      // Nothing completed the cancelled task. A cancel through the task action is
      // heard by its filer, once (FIX-2078 D2); only a model's own tool call isn't.
      expect(await heard(h, planner)).toEqual([`${top.id}:cancelled`]);
      expect(await h.chains("alice")).toEqual({});
    } finally {
      release();
      await h.dispose();
    }
  });
});

describe("how deep a chain goes (BR-20, BR-6)", () => {
  it("refuses a task for a sixth board, as a full board is, whatever the input says; the chain still settles", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.top = [{ goal: "Go deep", assignee: "d1" }];
      for (const worker of ["d1", "d2", "d3", "d4"]) h.controls.plans[worker] = [{ goal: `Go deep from ${worker}` }];
      h.controls.plans.d5 = [{ goal: "Too deep", assignee: "eng.tasker" }];
      const top = await h.open("alice", "top");
      await h.turn("alice", top);
      await h.settled();

      expect(h.controls.refusals).toEqual([{ worker: "d5", error: "TaskCapExceededError" }]);
      expect(await h.rowsNamed("alice", "Too deep")).toEqual([]);
      const d5 = await h.taskSessionOf("alice", (await one(h, "Go deep from d4")).id);
      expect((await h.session(d5)).state).toMatchObject({ taskChain: { depth: 5 } });
      // The app's filing is refused the same way, a forged depth on its input ignored.
      for (const metadata of [undefined, { taskChain: { depth: 0 }, depth: 0 }]) {
        const refused = await h.tool("alice", d5, "createTask", { held: true, goal: "Too deep", assignee: "eng.tasker", ...(metadata ? { metadata } : {}) });
        expect(refused).toEqual({ ok: false, error: "total_task_cap_exceeded" });
      }
      expect(await h.rowsNamed("alice", "Too deep")).toEqual([]);
      // Every board above settled from the one below.
      expect((await one(h, "Go deep")).status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("refuses a session create that seeds a chain or a depth, naming the field", async () => {
    const h = bootSplitHost();
    try {
      for (const [field, value] of [
        ["taskChain", { depth: 1, top: { partition: "p", taskId: "t" } }],
        ["taskFlow", "splitter"]
      ] as const) {
        const created = await h.create("alice", "splitter", { state: { workerId: "s1", [field]: value } });
        expect(created.status, field).toBe(400);
        expect(JSON.stringify(created.body), field).toContain(field);
      }
    } finally {
      await h.dispose();
    }
  });
});

describe("how many tasks one top task has under it (BR-21, BR-21a, BR-22, BR-22a)", () => {
  /** A top split three boards deep that stays open: `hold` waits unassigned on s1's board. */
  async function openChain(h: SplitHost) {
    h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
    h.controls.plans.s1 = [
      { goal: "Book the venue", assignee: "eng.tasker" },
      { goal: "Run the event", assignee: "s2" },
      { goal: "hold" }
    ];
    h.controls.plans.s2 = [{ goal: "Hire the band", assignee: "eng.tasker" }];
    const planner = await h.open("alice", "planner");
    await h.turn("alice", planner);
    await h.settled();
    const top = await one(h, "Plan the launch");
    const t1 = await h.taskSessionOf("alice", top.id);
    const t2 = await h.taskSessionOf("alice", (await one(h, "Run the event")).id);
    return { planner, top, t1, t2 };
  }

  const entriesOf = async (h: SplitHost) => {
    const records = Object.values(await h.chains("alice"));
    expect(records).toHaveLength(1);
    return records[0]!.entries;
  };

  it("refuses the 101st, across three boards, finished pieces counted; of two filings at the 100th, exactly one lands", async () => {
    const h = bootSplitHost();
    try {
      const { t1, t2 } = await openChain(h);
      // Four under the top: two finished, one parked on its own, one waiting.
      expect((await one(h, "Book the venue")).status).toBe("completed");
      expect((await one(h, "Hire the band")).status).toBe("completed");
      expect(Object.keys(await entriesOf(h))).toHaveLength(4);
      // The count reads this record, so the fillers are written here.
      const [key, record] = Object.entries(await h.chains("alice"))[0]!;
      const board = (await one(h, "hold")).partition;
      const filler = Object.fromEntries(
        Array.from({ length: DEFAULT_TASK_CHAIN_LIMIT - 5 }, (_, i) => [chainEntryKey(board, `filler-${i}`), { state: "added" as const, at: Date.now() }])
      );
      await h.writeChain("alice", key, { ...record, entries: { ...record.entries, ...filler } });
      expect(Object.keys(await entriesOf(h))).toHaveLength(DEFAULT_TASK_CHAIN_LIMIT - 1);

      const both = await Promise.all([
        h.tool("alice", t1, "createTask", { held: true, goal: "racing one" }),
        h.tool("alice", t2, "createTask", { held: true, goal: "racing two" })
      ]);
      expect(both.map((answer) => answer.ok).sort()).toEqual([false, true]);
      expect(both.find((answer) => !answer.ok)).toEqual({ ok: false, error: "total_task_cap_exceeded" });
      expect((await h.rowsNamed("alice", "racing one")).length + (await h.rowsNamed("alice", "racing two")).length).toBe(1);
      expect(Object.values(await entriesOf(h)).filter((entry) => entry.state === "added")).toHaveLength(100);

      expect(await h.tool("alice", t2, "createTask", { held: true, goal: "one too many" })).toEqual({ ok: false, error: "total_task_cap_exceeded" });
      expect(await h.rowsNamed("alice", "one too many")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("stops every chain at the app's own limit", async () => {
    const h = bootSplitHost({ hire: { taskChainLimit: 3 } });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "one" }, { goal: "two" }, { goal: "three" }, { goal: "four" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      expect(h.controls.refusals).toEqual([{ worker: "s1", error: "TaskCapExceededError" }]);
      expect(await h.rowsNamed("alice", "four")).toEqual([]);
      expect(Object.keys(await entriesOf(h))).toHaveLength(3);
    } finally {
      await h.dispose();
    }
  });

  it("holds a reservation whose add never landed for its lease, then drops it at the limit", async () => {
    const h = bootSplitHost({ hire: { taskChainLimit: 3 } });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "one" }, { goal: "two" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      const t1 = await h.taskSessionOf("alice", (await one(h, "Plan the launch")).id);
      const [key, record] = Object.entries(await h.chains("alice"))[0]!;
      // A filing that died after its reservation and before its add.
      const ghost = JSON.stringify(["somewhere", "ghost"]);
      await h.writeChain("alice", key, { ...record, entries: { ...record.entries, [ghost]: { state: "reserved", at: Date.now() } } });
      expect(await h.tool("alice", t1, "createTask", { held: true, goal: "three" })).toEqual({ ok: false, error: "total_task_cap_exceeded" });

      // Its lease runs out.
      const { CHAIN_RESERVATION_LEASE_MS } = await import("../src/conversation-board/chain");
      const aged = (await h.chains("alice"))[key]!;
      await h.writeChain("alice", key, {
        ...aged,
        entries: { ...aged.entries, [ghost]: { state: "reserved", at: Date.now() - CHAIN_RESERVATION_LEASE_MS - 1 } }
      });
      expect((await h.tool("alice", t1, "createTask", { held: true, goal: "three" })).ok).toBe(true);
      const entries = (await h.chains("alice"))[key]!.entries;
      expect(Object.keys(entries)).not.toContain(ghost);
      expect(Object.keys(entries)).toHaveLength(3);
    } finally {
      await h.dispose();
    }
  });

  it("counts two sessions' chains apart, though their top tasks share an id", async () => {
    const h = bootSplitHost({ hire: { taskChainLimit: 3 } });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1", id: "same-top" }];
      h.controls.plans["planner.two"] = [{ goal: "Plan the party", assignee: "s1", id: "same-top" }];
      h.controls.plans.s1 = [{ goal: "one" }, { goal: "two" }, { goal: "three" }];
      await h.turn("alice", await h.open("alice", "planner"));
      await h.turn("alice", await h.open("alice", "planner.two"));
      await h.settled();
      expect(h.controls.refusals).toEqual([]);
      expect(await h.rowsNamed("alice", "three")).toHaveLength(2);
      expect(Object.values(await h.chains("alice")).map((record) => Object.keys(record.entries).length)).toEqual([3, 3]);
    } finally {
      await h.dispose();
    }
  });
});
