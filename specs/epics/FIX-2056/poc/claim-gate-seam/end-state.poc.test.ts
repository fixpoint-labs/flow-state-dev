/**
 * FIX-2056 end-state POC, part 2 · the claim gate once FIX-2076, FIX-2077 and
 * FIX-2082 have all merged, as a small executable model. Experimental, not a
 * maintained test: run it with `run.sh`.
 *
 * The question: does the gate need exactly one "is this task done?" answer
 * across a plan board's waited dispatch (FIX-2076), rule 6 at the gate
 * (FIX-2077) and nested `getTask` waits (FIX-2082), or more than one?
 *
 * Three variants of who answers it, run over the same six scenarios:
 *
 *   today        the gate settles at the entry's last step (part 1, G1/G2);
 *                a wait's deadline cancels its row; a task request can't wait (G4)
 *   two-answers  FIX-2077's predicate at the gate, but the plan board's drain
 *                takes "the child's request returned" as done (its own answer),
 *                while `getTask` waits on the row's ending
 *   one-answer   FIX-2077's predicate is the only answer; every waiter, the
 *                drain's included, wakes only on the ending the gate writes;
 *                a deadline never writes an ending
 *
 * What would show MORE THAN ONE answer is needed: a scenario where one-answer
 * breaks an invariant that only a second, seam-local "done" could keep. The
 * invariants are the concept's rules 6, 9 and 18, checked on every ending and
 * every wake.
 *
 * Part 1 pins today's real gate on the real engine. This part is a model: it
 * shows whether the division holds together, not that the code will.
 */
import { describe, expect, it } from "vitest";

type Variant = "today" | "two-answers" | "one-answer";
type Ending = "completed" | "failed" | "cancelled";
type WaitKind = "drain" | "getTask";

interface Row {
  id: string;
  filer: string; // a task id, or "top" for a request working no task
  status: "running" | Ending;
}
interface Run {
  returned: boolean;
  background: number;
  queued: number;
  suspended?: "person" | "wait";
}
interface Wait {
  id: string;
  waiter: string;
  on: string;
  kind: WaitKind;
}

/** FIX-2077's predicate: rule 6, one place. */
function ruleSix(row: Row, run: Run, rows: Map<string, Row>): "done" | "running" | "person" {
  if (run.suspended === "person") return "person";
  if (!run.returned || run.suspended === "wait" || run.background > 0 || run.queued > 0) return "running";
  for (const r of rows.values()) if (r.filer === row.id && r.status === "running") return "running";
  return "done";
}

class World {
  rows = new Map<string, Row>();
  runs = new Map<string, Run>();
  waits: Wait[] = [];
  violations: string[] = [];
  refused: string[] = [];

  constructor(readonly variant: Variant) {
    this.runs.set("top", { returned: false, background: 0, queued: 0 });
  }

  /** File a task; `wait` makes the filer's request wait on it (a waited dispatch or a getTask wait). */
  file(id: string, filer: string, wait?: WaitKind): void {
    if (wait && this.variant === "today" && filer !== "top") {
      this.refused.push(`${filer} may not wait on ${id}`); // part 1, G4
      wait = undefined;
    }
    this.rows.set(id, { id, filer, status: "running" });
    this.runs.set(id, { returned: false, background: 0, queued: 0 });
    if (wait) {
      this.waits.push({ id: `w-${id}`, waiter: filer, on: id, kind: wait });
      this.runs.get(filer)!.suspended = "wait";
      if (this.depth(filer) > 5) this.violations.push(`${filer} waits past 5 deep`);
    }
  }

  depth(id: string): number {
    const w = this.waits.find((x) => x.on === id);
    return w ? 1 + this.depth(w.waiter) : 1;
  }

  background(id: string): void {
    this.runs.get(id)!.background += 1;
  }
  queue(id: string): void {
    this.runs.get(id)!.queued += 1;
  }
  askPerson(id: string): void {
    this.runs.get(id)!.suspended = "person";
    this.check(id);
  }

  /** The entry's block returns. */
  returns(id: string): void {
    const run = this.runs.get(id)!;
    run.returned = true;
    run.suspended = undefined;
    if (this.variant === "today") return this.write(id, "completed", "gate");
    this.check(id); // the gate goes first, so a row rule 6 already holds for is written before any drain reads it
    if (this.variant === "two-answers") {
      for (const w of this.waits.filter((x) => x.on === id && x.kind === "drain")) this.wake(w);
    }
  }
  backgroundEnds(id: string): void {
    this.runs.get(id)!.background -= 1;
    this.check(id);
  }
  receiveRuns(id: string): void {
    this.runs.get(id)!.queued -= 1;
    this.check(id);
  }
  fails(id: string): void {
    this.write(id, "failed", "gate");
  }

  /** A wait's deadline passes. */
  deadline(on: string): void {
    const w = this.waits.find((x) => x.on === on);
    if (!w) return;
    if (this.variant === "today") return this.write(on, "cancelled", "a wait deadline");
    if (w.kind === "drain") return; // a plan board's drain waits again: rule 14, every row
    this.waits = this.waits.filter((x) => x !== w);
    this.runs.get(w.waiter)!.suspended = undefined; // resumes without the result
  }

  /** The gate, at each of its triggers: request end, background drained, queue empty, a filed task's ending. */
  check(id: string): void {
    if (this.variant === "today") return;
    const row = this.rows.get(id);
    if (!row || row.status !== "running") return;
    if (ruleSix(row, this.runs.get(id)!, this.rows) === "done") this.write(id, "completed", "gate");
  }

  write(id: string, ending: Ending, by: string): void {
    const row = this.rows.get(id)!;
    const run = this.runs.get(id)!;
    if (row.status !== "running") return void this.violations.push(`${id} ended twice`);
    if (by !== "gate") this.violations.push(`${id} ended by ${by}, not the gate`);
    if (ending === "completed") {
      if (run.background > 0) this.violations.push(`${id} settled with background work running`);
      if (run.queued > 0) this.violations.push(`${id} settled with a message queued`);
      if ([...this.rows.values()].some((r) => r.filer === id && r.status === "running"))
        this.violations.push(`${id} settled with a filed task open`);
    }
    row.status = ending;
    for (const w of this.waits.filter((x) => x.on === id)) this.wake(w);
    if (row.filer !== "top") this.check(row.filer); // the settle a filer is owed
  }

  wake(w: Wait): void {
    if (this.rows.get(w.on)!.status === "running") this.violations.push(`${w.waiter} took ${w.on} as done while it runs`);
    this.waits = this.waits.filter((x) => x !== w);
    this.runs.get(w.waiter)!.suspended = undefined;
  }
}

/** Each scenario drives one world and returns it. */
const scenarios: Record<string, (w: World) => void> = {
  // writer's plan board dispatches fact-check and waits; fact-check files a
  // fire-and-forget task and returns
  "S1 waited dispatch, the child files a task and returns": (w) => {
    w.file("fact", "top", "drain");
    w.file("lookup", "fact");
    w.returns("fact");
    w.returns("lookup");
  },
  "S2 waited dispatch, the child's background work outlives its return": (w) => {
    w.file("fact", "top", "drain");
    w.background("fact");
    w.returns("fact");
    w.backgroundEnds("fact");
  },
  // a plan row dispatched and waited, which waits on a task, which waits on a task
  "S3 three waits nested inside a waited dispatch": (w) => {
    w.file("t1", "top", "drain");
    w.file("t2", "t1", "getTask");
    w.file("t3", "t2", "getTask");
    w.returns("t3");
    w.returns("t2");
    w.returns("t1");
  },
  "S4 a getTask deadline passes mid-chain, then the task ends": (w) => {
    w.file("t1", "top", "drain");
    w.file("t2", "t1", "getTask");
    w.deadline("t2");
    w.returns("t1"); // carries on without t2's result
    w.returns("t2");
  },
  "S5 the drain's own deadline passes while the child runs": (w) => {
    w.file("t1", "top", "drain");
    w.deadline("t1");
    w.returns("t1");
  },
  "S6 a person's stop, then a queued message, then the end": (w) => {
    w.file("t1", "top", "drain");
    w.askPerson("t1");
    w.queue("t1");
    w.returns("t1");
    w.receiveRuns("t1");
  },
};

function run(variant: Variant) {
  return Object.fromEntries(
    Object.entries(scenarios).map(([name, drive]) => {
      const w = new World(variant);
      drive(w);
      const unsettled = [...w.rows.values()].filter((r) => r.status === "running").map((r) => r.id);
      return [name, { violations: w.violations, refused: w.refused, unsettled }];
    })
  );
}

describe("the claim gate once the three children merge", () => {
  it("one-answer · every scenario keeps rules 6, 9 and 18, and every row ends once", () => {
    const result = run("one-answer");
    console.log("one-answer", JSON.stringify(result, null, 1));
    for (const r of Object.values(result)) expect(r).toEqual({ violations: [], refused: [], unsettled: [] });
  });

  it("two-answers · a drain with its own 'done' moves past a running row", () => {
    const result = run("two-answers");
    console.log("two-answers", JSON.stringify(result, null, 1));
    expect(result["S1 waited dispatch, the child files a task and returns"].violations).toEqual([
      "top took fact as done while it runs",
    ]);
    expect(result["S2 waited dispatch, the child's background work outlives its return"].violations).toEqual([
      "top took fact as done while it runs",
    ]);
    expect(result["S4 a getTask deadline passes mid-chain, then the task ends"].violations).toEqual([
      "top took t1 as done while it runs",
    ]);
    expect(result["S6 a person's stop, then a queued message, then the end"].violations).toEqual([
      "top took t1 as done while it runs",
    ]);
    // Where rule 6 already holds at return, the two answers agree and nothing breaks.
    expect(result["S3 three waits nested inside a waited dispatch"].violations).toEqual([]);
    expect(result["S5 the drain's own deadline passes while the child runs"].violations).toEqual([]);
  });

  it("today · the gate settles early, a deadline ends a row, and a task can't wait", () => {
    const result = run("today");
    console.log("today", JSON.stringify(result, null, 1));
    expect(result["S1 waited dispatch, the child files a task and returns"].violations).toContain(
      "fact settled with a filed task open"
    );
    expect(result["S2 waited dispatch, the child's background work outlives its return"].violations).toContain(
      "fact settled with background work running"
    );
    expect(result["S3 three waits nested inside a waited dispatch"].refused).toEqual([
      "t1 may not wait on t2",
      "t2 may not wait on t3",
    ]);
    expect(result["S5 the drain's own deadline passes while the child runs"].violations).toContain(
      "t1 ended by a wait deadline, not the gate"
    );
  });
});
