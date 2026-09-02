// The throwaway world every sketch shares: a fake filesystem for lock files and
// checkout writes, and the manager's run record (stands in for the `runs/*` collection).
export type RunRow = {
  taskId: string;
  attempt: number;
  status: "open" | "completed" | "failed";
  sessionId: string | null;
  source: string | null;
  outcome: string | null;
  cost: { usd: number; basis: string } | null;
  reason: string | null;
};
export const world = {
  /** lock path → the token the acquiring attempt wrote (LAB-154 §7, "the lease as a value"). */
  locks: new Map<string, string>(),
  /** every write a vendor process made into a checkout, stamped with wall-clock ms. */
  treeWrites: [] as Array<{ cwd: string; by: string; at: number }>,
  /** the manager's run record, one row per task (the latest attempt wins, as `runs/*` does). */
  rows: new Map<string, RunRow>(),
  t0: Date.now(),
  say(line: string) {
    console.log(`  [${String(Date.now() - this.t0).padStart(4)}ms] ${line}`);
  },
  reset() {
    this.locks.clear();
    this.treeWrites.length = 0;
    this.rows.clear();
    this.t0 = Date.now();
  },
};
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
