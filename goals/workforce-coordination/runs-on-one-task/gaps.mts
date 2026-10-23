/**
 * Plan row 4's map: each of the 31 in-scope rows of `docs/internal/design/workforce-coordination-gaps.md`
 * (every phase 1 and phase 3 row), the child whose Linear scope line cites it, and the checks
 * that read it. A row is matched by its target's opening words, so a row renamed or added on the
 * page is a row this map doesn't hold, and the run says so. The verdict of each check is in
 * rows 1 to 3; this prints the map and fails a row no check reads.
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
  { target: "A request suspended by `waitForUser`", owners: "FIX-2077", checks: ["task-board/settles-when-its-work-is-over"], carved: "marking a task waiting on a person is FIX-2058's" },
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
  { target: "A failed or cancelled dependency cancels its dependents", owners: "FIX-2080", checks: ["task-board/runs-by-its-filing-settings d (control no-cascade)", "closure c:dependent-cancelled (control no-cascade)"] },
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

/** Print the map; a page row this map doesn't hold, or one with no check, is pushed as a failure. */
export function printGaps(report: string[], failures?: string[]): void {
  const page = pageRows();
  report.push(`row 4: ${page.length} in-scope gaps rows on the page, ${ROWS.length} mapped`);
  for (const target of page) {
    const row = ROWS.find((r) => target.startsWith(r.target));
    if (row === undefined || row.checks.length === 0) {
      failures?.push(`gaps — no check reads the row "${target.slice(0, 90)}"`);
      report.push(`  UNMAPPED ${target.slice(0, 90)}`);
      continue;
    }
    report.push(`  ${row.owners.padEnd(18)} ${row.target.slice(0, 60).padEnd(60)} ← ${row.checks.join(" · ")}${row.carved ? ` [carved: ${row.carved}]` : ""}`);
  }
}
