/**
 * Plan row 4's map: each of the 31 in-scope rows of `docs/internal/design/workforce-coordination-gaps.md`
 * (every phase 1 and phase 3 row), the child whose Linear scope line cites it, and the checks
 * that read it. A row is matched by its target's opening words, so a row renamed or added on the
 * page is a row this map doesn't hold, and the run says so. Each check names a run of this
 * closure: `closure <tags>` row 1's assertions, `sweep: …` the sweep, `<package> <file>.test.ts`
 * a regression test row 3 runs, or a goal path row 3 runs, then its legs and `(control …)`.
 * A row passes only when every run it names ran in this closure run and passed (a goal and each
 * control it names, as row 3 graded them; an assertion, as its leg's last attempt): a label
 * naming no such run, or one not run here, fails, as a stale `by` does. Leg letters after a goal
 * are where in it the row is read; the goal's own verdict covers them.
 *
 * Four rows hold a half other epics own (FIX-2056 D2, (f)); the carved half is printed beside
 * its row and does not gate the closure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../lib/index.mts";

const GAPS = "docs/internal/design/workforce-coordination-gaps.md";

interface Row {
  /** The row's target, its opening words. */
  target: string;
  owners: string;
  checks: string[];
  carved?: string;
}

/** The 31 rows, in the page's order. */
export const ROWS: Row[] = [
  { target: "Routed tasks; attempts a setting", owners: "FIX-2083, FIX-2080", checks: ["coordinators/routes-each-message-as-a-task a:tasks", "task-board/runs-by-its-filing-settings", "closure a:routed-listed"] },
  { target: "`onTaskSettled` in orchestration", owners: "FIX-2078", checks: ["task-board/every-ending-reaches-its-filer a", "closure a:one-settled, a:once"] },
  { target: "A failure is an ending delivered to the filer", owners: "FIX-2078", checks: ["task-board/every-ending-reaches-its-filer d", "closure c:one-failure-notice"], carved: "the Error Reporter's intake half is (f)'s: errorCapture stays the request route" },
  { target: "Every debt a row owes carries a due time", owners: "FIX-2078", checks: ["task-board/every-ending-reaches-its-filer b, e (control no-sweeper-payment)", "closure b:hears-in-due-time"] },
  { target: "A plan board and a delegation board", owners: "FIX-2076", checks: ["task-board/refuses-a-board-built-wrong", "task-board/a-worker-plans-its-own-steps"] },
  { target: "A plan board waits on a row it dispatched", owners: "FIX-2082", checks: ["task-board/waits-on-a-task-it-filed d (control drain-moves-on)", "closure a:drain-waits, a:answers-after-steps"] },
  { target: "A goal-seek loop needs a plan board", owners: "FIX-2076", checks: ["task-board/refuses-a-board-built-wrong b", "goal-seek-loop/replans-until-done (j3)"] },
  { target: "An ending that makes a row startable runs `dispatch`", owners: "FIX-2078", checks: ["task-board/every-ending-reaches-its-filer c"] },
  { target: "`respond`; `dispatch`", owners: "FIX-2084", checks: ["workers/roles-checked-at-hire", "sweep: the door matcher"] },
  { target: "`dispatch` runs one at a time per session", owners: "FIX-2078", checks: ["task-board/every-ending-reaches-its-filer c"] },
  { target: "The drain's last startable check runs after its repairs", owners: "FIX-2078, FIX-2096", checks: ["task-board/every-ending-reaches-its-filer c", "orchestration drain-pays-owed-cascade.test.ts"] },
  { target: "A task's request may wait on a task it filed, up to 5 waits deep", owners: "FIX-2082", checks: ["task-board/waits-on-a-task-it-filed b"] },
  { target: "A request waits on a task it filed, just now or earlier", owners: "FIX-2082", checks: ["task-board/waits-on-a-task-it-filed a", "closure j1:waits-in-request"] },
  { target: "A wait's deadline leaves the task running", owners: "FIX-2082", checks: ["task-board/waits-on-a-task-it-filed c (control deadline-cancels)"] },
  { target: "A request suspended by `suspendForUser`", owners: "FIX-2077", checks: ["task-board/settles-when-its-work-is-over"], carved: "marking a task waiting on a person is FIX-2058's" },
  { target: "A message to an open task's session is conversation", owners: "FIX-2077", checks: ["task-board/settles-when-its-work-is-over"] },
  { target: "The row settles only after the request's background work ends", owners: "FIX-2077, FIX-2088", checks: ["task-board/settles-when-its-work-is-over a (control settle-at-return)", "task-board/background-error-fails-the-attempt"] },
  { target: "Splits use delegates and stay running", owners: "FIX-2077, FIX-2081", checks: ["task-board/settles-when-its-work-is-over", "workforce/split-to-roster", "closure a:ends-running"] },
  { target: "Delegates are authority; `all`", owners: "FIX-2081", checks: ["task-tools/five-tools-one-rule-per-field c (control roster-reach)"] },
  { target: "One open task per session; another stays pending", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings"] },
  { target: "Start: now, after named tasks, or held", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings"] },
  { target: "`updateTask`, one rule per field", owners: "FIX-2081", checks: ["task-tools/five-tools-one-rule-per-field b (control edit-any-state)"] },
  { target: "Recurring work is a schedule that files an ordinary task", owners: "FIX-2085", checks: ["scheduled-work/recurring-work-files-a-task"] },
  { target: "A dependency stays within one board", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings"] },
  { target: "Cancelling, retrying or failing a task cancels its open tasks", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings d (control no-cascade)"] },
  { target: "A failed or cancelled dependency cancels its dependents", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings d (control no-cascade)", "closure c:dependent-cancelled"] },
  { target: "Five task tools", owners: "FIX-2081, FIX-2083", checks: ["task-tools/five-tools-one-rule-per-field a", "coordinators/routes-each-message-as-a-task d:one-check", "sweep: the tools rule", "closure j1:tools"], carved: "`sendMessage` among the model's tools is FIX-2070's" },
  { target: "The task tools are public actions a screen calls as the user", owners: "FIX-2081", checks: ["task-tools/five-tools-one-rule-per-field", "closure a:routed-listed, j2:cancelled"], carved: "answering a question by public action is FIX-2058's" },
  { target: "A worker declares its roles", owners: "FIX-2084", checks: ["workers/roles-checked-at-hire a (control no-role-check)"] },
  { target: "`updateTask`'s `message`, until a task finishes", owners: "FIX-2086", checks: ["task-tools/steer-and-follow-up (controls drop-late-steer, reopen)", "closure j2:steered, j2:steer-shows"], carved: "answering a question with the message is FIX-2058's" },
  { target: "A finished task's output never changes", owners: "FIX-2086", checks: ["task-tools/steer-and-follow-up d (control reopen)", "closure a:follow-up, a:original-unchanged"] },
];

/** The in-scope rows on the page: every phase 1 and phase 3 row of the differences table. */
function pageRows(): string[] {
  return readFileSync(join(REPO_ROOT, GAPS), "utf8")
    .split("\n")
    .filter((l) => /^\| (1 · One task|3 · Into a task) \| /.test(l))
    .map((l) => l.split("|")[2]!.trim())
    .filter((target) => target !== "FIX-2056 (one epic)");
}

/** What this closure run ran, and each run's verdict, for resolving a row's checks. */
export interface Ran {
  /** Row 1's assertion tags. */
  tags: readonly string[];
  /** Each walk leg run, and whether its last attempt passed (`j1:` and `j2:` are leg a's). */
  legs: ReadonlyMap<string, boolean>;
  /** The sweep's verdict, plain and `--control` both, if it ran. */
  sweep: boolean | undefined;
  /** Row 3's goals (`goals/<path>`), its controls (`<path> GOAL_CONTROL=<name>`) and its test files, each with whether it passed (a control: went red as documented). */
  checks: ReadonlyMap<string, boolean>;
}

/** Why one check label isn't a run that passed here, or undefined when it is. */
function unresolved(label: string, ran: Ran): string | undefined {
  if (label.startsWith("closure ")) {
    for (const tag of label.slice("closure ".length).split(/,\s*/)) {
      if (!ran.tags.includes(tag)) return `${tag} is no row-1 assertion`;
      const leg = /^j[12]:/.test(tag) ? "a" : tag.split(":")[0]!;
      const passed = ran.legs.get(leg);
      if (passed === undefined) return `leg ${leg}, which holds ${tag}, didn't run`;
      if (!passed) return `leg ${leg}, which holds ${tag}, failed`;
    }
    return undefined;
  }
  if (label.startsWith("sweep:")) return ran.sweep === undefined ? "the sweep didn't run" : ran.sweep ? undefined : "the sweep failed";
  const test = /^\S+ (\S+\.test\.ts)$/.exec(label)?.[1];
  if (test !== undefined) {
    const hits = [...ran.checks].filter(([k]) => k.endsWith(`/${test}`));
    if (hits.length === 0) return `${test} didn't run`;
    return hits.every(([, ok]) => ok) ? undefined : `${test} failed`;
  }
  const goal = label.split(" ")[0]!;
  const passed = ran.checks.get(goal);
  if (passed === undefined) return `${goal} didn't run`;
  if (!passed) return `${goal} failed`;
  for (const name of (/\(controls? ([^)]+)\)/.exec(label)?.[1] ?? "").split(/,\s*/).filter(Boolean)) {
    const red = ran.checks.get(`${goal} GOAL_CONTROL=${name}`);
    if (red === undefined) return `${goal}'s control ${name} didn't run`;
    if (!red) return `${goal}'s control ${name} didn't go red as documented`;
  }
  return undefined;
}

/**
 * Print the map, each check with whether it ran and passed here. A page row this map doesn't
 * hold, one with no check, and a check naming no run that passed in this closure run are each
 * pushed as a failure.
 */
export function printGaps(report: string[], failures: string[], ran: Ran): void {
  const page = pageRows();
  report.push(`row 4: ${page.length} in-scope gaps rows on the page, ${ROWS.length} mapped`);
  let green = 0;
  for (const target of page) {
    const row = ROWS.find((r) => target.startsWith(r.target));
    if (row === undefined || row.checks.length === 0) {
      failures.push(`gaps — no check reads the row "${target.slice(0, 90)}"`);
      report.push(`  UNMAPPED ${target.slice(0, 90)}`);
      continue;
    }
    const misses = row.checks.flatMap((c) => {
      const why = unresolved(c, ran);
      return why === undefined ? [] : [`${c}: ${why}`];
    });
    if (misses.length === 0) green += 1;
    else failures.push(`gaps — the row "${row.target.slice(0, 60)}" names checks that didn't pass in this run: ${misses.join("; ")}`);
    report.push(`  ${misses.length === 0 ? "PASS" : "FAIL"} ${row.owners.padEnd(18)} ${row.target.slice(0, 60).padEnd(60)} ← ${row.checks.join(" · ")}${row.carved ? ` [carved: ${row.carved}]` : ""}`);
  }
  report.push(`row 4: ${green} of ${page.length} rows with every check run and passed here`);
}
