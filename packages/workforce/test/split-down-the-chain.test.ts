/**
 * The split and its limits (FIX-1802 P2: V3, V4 and V5's second half).
 *
 * A task session files pieces on its own board; its task waits on the board
 * above, parked, and settles from them through the binding it wrote at the
 * park, fenced by its claim ticket. A chain is at most five boards deep, and
 * one top task has at most 100 tasks under it (or the app's own limit).
 *
 * Each leg acts through the flows' public actions and the turns of the
 * splitter fixture (`./split-harness`), whose turns write through the same ref
 * the task tools do, and reads what it asserts back from the store.
 */
import { describe, expect, it } from "vitest";
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

describe("a task session splits its task (BR-14, BR-16, V5)", () => {
  it("files pieces on its own board, waits parked with no notice for the park, and completes from its pieces", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue", assignee: "eng.tasker" },
        { goal: "Print the flyers", assignee: "eng.writer" }
      ];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const top = await one(h, "Plan the launch");
      expect(top).toMatchObject({ status: "completed", assignee: "s1" });
      const pieces = [await one(h, "Book the venue"), await one(h, "Print the flyers")];
      expect(pieces.map((row) => row.status)).toEqual(["completed", "completed"]);
      // The pieces are on the task session's own board, not the top's.
      expect(pieces[0]!.partition).toBe(pieces[1]!.partition);
      expect(pieces[0]!.partition).not.toBe(top.partition);
      // Its output is its pieces'.
      expect((top.output as { pieces: Array<{ goal: string }> }).pieces.map((piece) => piece.goal).sort()).toEqual([
        "Book the venue",
        "Print the flyers"
      ]);
      // planner heard one notice for its task: the completion. None for the park.
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      // s1's task session heard each piece once; its turn ran once on the task, once on each notice.
      const t1 = await h.taskSessionOf("alice", top.id);
      expect(await heard(h, t1)).toEqual(pieces.map((row) => `${row.id}:completed`).sort());
      const t1Turns = h.controls.turns.filter((turn) => turn.sessionId === t1);
      expect(t1Turns.filter((turn) => !turn.message.startsWith('Task "'))).toHaveLength(1);
      expect(t1Turns.filter((turn) => turn.message.startsWith('Task "'))).toHaveLength(2);
      // The binding is gone once it settled, and so is the chain's record.
      expect((await h.session(t1)).state).toMatchObject({ splitParent: null });
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
      const followUp = await h.tool("alice", planner, "addTask", { goal: "Add a second venue", followUpOf: top.id });
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

  it("fails, naming the piece that failed for good, and the session above hears it once (BR-16)", async () => {
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

      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("errored");
      expect(top.error).toContain("Print the flyers [fail]");
      expect(top.error).not.toContain("Book the venue");
      // One line in planner's conversation: the failure. Its first failure
      // reran the board with no turn and no line.
      const lines = await linesAbout(h, planner, "Plan the launch");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("failed for good");
      // The second attempt re-entered the task session and parked again on
      // its pieces: s1's turn ran on the task once, and filed nothing twice.
      const t1 = await h.taskSessionOf("alice", top.id);
      expect(h.controls.turns.filter((turn) => turn.sessionId === t1 && !turn.message.startsWith('Task "'))).toHaveLength(1);
      expect(await h.rowsNamed("alice", "Book the venue")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("stays open while the turn a failure woke files the work again, and settles once that piece ends (BR-15, BR-18)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Print the flyers [fail]", assignee: "eng.tasker" }];
      h.controls.onErrored.s1 = { goal: "Print the flyers again", assignee: "eng.writer" };
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();

      const top = await one(h, "Plan the launch");
      const again = await one(h, "Print the flyers again");
      expect(again.status).toBe("completed");
      // The task waited for the piece filed again before it settled.
      expect(top.updatedAt).toBeGreaterThanOrEqual(again.updatedAt);
      expect(top.status).toBe("errored");
      expect(top.error).toContain("Print the flyers [fail]");
      expect(await heard(h, planner)).toContain(`${top.id}:errored`);
      expect(await linesAbout(h, planner, "Plan the launch")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("settles on the next touch above when the turn the last piece woke fails, once (BR-17)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      h.controls.failNoticeTurn.add("s1");
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      expect((await one(h, "Book the venue")).status).toBe("completed");
      expect((await one(h, "Plan the launch")).status).toBe("parked");

      // The user's next look at the board settles it.
      h.controls.failNoticeTurn.clear();
      expect((await h.tool("alice", planner, "listTasks", {})).ok).not.toBe(false);
      await h.settled();
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      expect(await linesAbout(h, planner, "Plan the launch")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("settles on the next touch above when the last piece's notice never reached the task session (BR-17)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue [slow:150]", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      // The task parks; then every notice is lost, as a process that died
      // before sending it would lose it.
      expect(await h.until(async () => (await h.rowsNamed("alice", "Plan the launch"))[0]?.status === "parked")).toBe(true);
      const lost = await h.loseDispatches("onTaskSettled");
      await h.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      lost.restore();
      expect((await one(h, "Book the venue [slow:150]")).status).toBe("completed");
      expect((await one(h, "Plan the launch")).status).toBe("parked");

      expect((await h.tool("alice", planner, "listTasks", {})).ok).not.toBe(false);
      await h.settled();
      const top = await one(h, "Plan the launch");
      expect(top.status).toBe("completed");
      expect(await heard(h, planner)).toEqual([`${top.id}:completed`]);
      const t1 = await h.taskSessionOf("alice", top.id);
      expect(h.controls.turns.filter((turn) => turn.sessionId === t1 && turn.message.startsWith('Task "'))).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("settles nothing twice when the settle is replayed after it landed and before its binding cleared (BR-17)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      const settled = await one(h, "Plan the launch");
      expect(settled.status).toBe("completed");
      const t1 = await h.taskSessionOf("alice", settled.id);
      const partition = decodeURIComponent(settled.partition);

      // As a kill after the settle and before the clear leaves it: the binding, with its ticket.
      await h.writeSessionState(t1, {
        splitParent: {
          partition,
          taskId: settled.id,
          ticket: {
            collectionId: "tasks",
            taskId: settled.id,
            attempt: settled.attempts,
            createdAt: settled.createdAt,
            ...(settled.incarnationId !== undefined ? { incarnationId: settled.incarnationId } : {}),
            partition
          },
          filer: { session: planner, flow: "splitter" }
        }
      });
      // Any touch of its board replays the settle.
      expect((await h.tool("alice", t1, "listTasks", {})).ok).not.toBe(false);
      await h.settled();
      const after = await one(h, "Plan the launch");
      expect(after.status).toBe("completed");
      expect(after.revision).toBe(settled.revision);
      expect(await heard(h, planner)).toEqual([`${settled.id}:completed`]);
      expect(await linesAbout(h, planner, "Plan the launch")).toHaveLength(1);
      expect((await h.session(t1)).state).toMatchObject({ splitParent: null });
    } finally {
      await h.dispose();
    }
  });

  it("settles each board once, two boards down, from one listTasks at the top (BR-17)", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [{ goal: "Run the event", assignee: "s2" }];
      h.controls.plans.s2 = [{ goal: "Book the venue", assignee: "eng.tasker" }];
      h.controls.failNoticeTurn.add("s2");
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      await h.settled();
      expect((await one(h, "Book the venue")).status).toBe("completed");
      expect((await one(h, "Run the event")).status).toBe("parked");
      expect((await one(h, "Plan the launch")).status).toBe("parked");

      h.controls.failNoticeTurn.clear();
      await h.tool("alice", planner, "listTasks", {});
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

describe("a split task changed from above while its pieces are open (BR-19)", () => {
  it("declines a reassign, and a cancel cancels its open pieces down the chain; its later settle is declined", async () => {
    const h = bootSplitHost();
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue [slow:400]", assignee: "eng.tasker" },
        { goal: "Run the event", assignee: "s2" }
      ];
      h.controls.plans.s2 = [{ goal: "Hire the band [slow:400]", assignee: "eng.writer" }];
      const planner = await h.open("alice", "planner");
      await h.turn("alice", planner);
      expect(
        await h.until(async () => {
          const statuses = [(await h.rowsNamed("alice", "Plan the launch"))[0]?.status, (await h.rowsNamed("alice", "Run the event"))[0]?.status];
          return statuses.every((status) => status === "parked");
        })
      ).toBe(true);
      const top = await one(h, "Plan the launch");

      const reassign = await h.tool("alice", planner, "assignTask", { taskId: top.id, assignee: "s1" });
      expect(reassign.ok).toBe(false);
      expect(JSON.stringify(reassign)).toContain("immutable-assignee");

      expect((await h.tool("alice", planner, "cancelTask", { taskId: top.id })).ok).toBe(true);
      await h.settled();
      const rows = Object.fromEntries((await h.rows("alice")).map((row) => [row.goal, row.status]));
      expect(rows).toEqual({
        "Plan the launch": "cancelled",
        "Book the venue [slow:400]": "cancelled",
        "Run the event": "cancelled",
        "Hire the band [slow:400]": "cancelled"
      });
      // Nothing settled the cancelled task, and nobody above heard an ending for it.
      expect(await heard(h, planner)).toEqual([]);
      const t1 = await h.taskSessionOf("alice", top.id);
      expect((await h.session(t1)).state).toMatchObject({ splitParent: null });
      expect(await h.chains("alice")).toEqual({});
    } finally {
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
        const refused = await h.tool("alice", d5, "addTask", { goal: "Too deep", assignee: "eng.tasker", ...(metadata ? { metadata } : {}) });
        expect(refused).toEqual({ ok: false, error: "total_task_cap_exceeded" });
      }
      expect(await h.rowsNamed("alice", "Too deep")).toEqual([]);
      // Every board above settled from the one below.
      expect((await one(h, "Go deep")).status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("refuses a session create that seeds a chain, a depth or a parent binding, naming the field", async () => {
    const h = bootSplitHost();
    try {
      for (const [field, value] of [
        ["taskChain", { depth: 1, top: { partition: "p", taskId: "t" } }],
        ["taskFlow", "splitter"],
        ["splitParent", null]
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
      for (let i = 0; i < 95; i += 1) {
        expect((await h.tool("alice", t1, "addTask", { goal: `filler ${i}` })).ok, `filler ${i}`).toBe(true);
      }
      expect(Object.keys(await entriesOf(h))).toHaveLength(99);

      const both = await Promise.all([
        h.tool("alice", t1, "addTask", { goal: "racing one" }),
        h.tool("alice", t2, "addTask", { goal: "racing two" })
      ]);
      expect(both.map((answer) => answer.ok).sort()).toEqual([false, true]);
      expect(both.find((answer) => !answer.ok)).toEqual({ ok: false, error: "total_task_cap_exceeded" });
      expect((await h.rowsNamed("alice", "racing one")).length + (await h.rowsNamed("alice", "racing two")).length).toBe(1);
      expect(Object.values(await entriesOf(h)).filter((entry) => entry.state === "added")).toHaveLength(100);

      expect(await h.tool("alice", t2, "addTask", { goal: "one too many" })).toEqual({ ok: false, error: "total_task_cap_exceeded" });
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
      expect(await h.tool("alice", t1, "addTask", { goal: "three" })).toEqual({ ok: false, error: "total_task_cap_exceeded" });

      // Its lease runs out.
      const { CHAIN_RESERVATION_LEASE_MS } = await import("../src/conversation-board/chain");
      const aged = (await h.chains("alice"))[key]!;
      await h.writeChain("alice", key, {
        ...aged,
        entries: { ...aged.entries, [ghost]: { state: "reserved", at: Date.now() - CHAIN_RESERVATION_LEASE_MS - 1 } }
      });
      expect((await h.tool("alice", t1, "addTask", { goal: "three" })).ok).toBe(true);
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
