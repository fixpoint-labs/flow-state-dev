/**
 * Goal check, leg b of FIX-2076: a board whose declared mode contradicts its
 * assignees is refused when it is built, naming the setting and the fix, and so
 * is a goal-seek loop over a board whose drain can return with a row not ended.
 * No model. The boards, what each refusal must name, and the control are in
 * goal.md.
 *
 * Run: pnpm tsx goals/task-board/refuses-a-board-built-wrong/run.mts
 * Control: GOAL_CONTROL=no-fence (the refusals removed: every board must build)
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dispatcher, handler } from "@flow-state-dev/core";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { goalSeekLoop, taskBoard, taskWorkerInputSchema, type Verdict } from "@flow-state-dev/orchestration/task-board";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = goalTmpDir("refuses-a-board-built-wrong");

const CONTROLS: Record<string, ModulePatch[]> = {
  // Today's `main`: no mode, so nothing contradicts it. The mode check and the
  // loop's two guards are skipped.
  "no-fence": [
    {
      module: "packages/orchestration/src/task-board/board-mode.ts",
      from: String.raw`const \{ name, mode, dispatchers, inline, uniformInline, floorInline \} = options;`,
      to: "const { name, mode, dispatchers, inline, uniformInline, floorInline } = options; return;"
    },
    {
      module: "packages/orchestration/src/task-board/goal-seek-loop.ts",
      from: String.raw`if \(board\.mode === "delegation"\) \{`,
      to: "if (false) {"
    },
    {
      module: "packages/orchestration/src/task-board/index.ts",
      from: String.raw`if \("onReview" in \(config as object\)\) \{`,
      to: "if (false) {"
    }
  ]
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) }
  });
  assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const inline = (name: string) =>
  handler({ name, inputSchema: taskWorkerInputSchema, outputSchema: z.unknown(), execute: (task) => task.goal }) as TaskWorker;
let count = 0;
const handsOff = (wait?: boolean) => {
  count += 1;
  return dispatcher({
    name: `hand-off-${count}`,
    type: "task",
    action: "work",
    session: "per-task",
    ...(wait !== undefined ? { wait } : {})
  }) as unknown as TaskWorker;
};
const ledger = (id: string) => defineTaskCollection({ id, scope: "user" });
const judge = () => ({ decision: "done", reason: "ok" }) as Verdict;

/** One board as an author would write it, the setting its refusal must name, and the fix it must give. */
const WRONG: Array<{ name: string; build: () => unknown; setting: RegExp; fix: RegExp }> = [
  // FIX-2082: a plan board waits on the rows it hands over, so the refusal is
  // of a dispatcher that says otherwise, on either kind of board.
  {
    name: "a plan board whose dispatcher won't wait",
    build: () =>
      taskBoard({ name: "issue-work", boardId: "issue-work", collection: ledger("issue-work"), workers: { implement: handsOff(false) } }),
    setting: /is a plan board.*assignee:implement says `wait: false`/s,
    fix: /declare `mode: "delegation"`/
  },
  {
    name: "a delegation board whose dispatcher waits",
    build: () =>
      taskBoard({
        name: "waiting-work",
        boardId: "waiting-work",
        mode: "delegation",
        collection: ledger("waiting-work"),
        workers: { implement: handsOff(true) }
      }),
    setting: /is a delegation board, and its dispatcher at assignee:implement says `wait: true`/,
    fix: /drop `mode` for a plan board/
  },
  {
    name: "a delegation board with an inline assignee",
    build: () =>
      taskBoard({
        name: "mixed-work",
        boardId: "mixed-work",
        mode: "delegation",
        collection: ledger("mixed-work"),
        workers: { implement: handsOff(), summarize: inline("summarize") }
      }),
    setting: /is a delegation board, and assignee:summarize runs in the drain/,
    fix: /Put a `dispatcher\(\{ action, session \}\)` there, or move the inline work to a plan board \(drop `mode`\)/
  },
  {
    name: "a delegation board with no dispatcher",
    build: () => taskBoard({ name: "empty-work", mode: "delegation", workers: {} }),
    setting: /is a delegation board with no dispatcher/,
    fix: /drop `mode` for a plan board/
  },
  {
    name: "a goal-seek loop over a delegation board",
    build: () =>
      goalSeekLoop({
        name: "seek-over-delegation",
        maxIterations: 3,
        judge,
        board: taskBoard({ name: "handed-off", boardId: "handed-off", mode: "delegation", collection: ledger("handed-off"), workers: { implement: handsOff() } })
      }),
    setting: /"handed-off", a delegation board/,
    fix: /Loop over a plan board/
  },
  {
    // A board written before FIX-2131, when a task waiting on a person parked:
    // the option is gone, and a board that still sets it is refused by name.
    name: "a board that still sets the removed onReview",
    build: () => taskBoard({ name: "parks-out", collection: ledger("parks-out"), workers: inline("parks-out-w"), onReview: "exit" } as never),
    setting: /"parks-out" sets `onReview`/,
    fix: /Remove the option/
  }
];

await runGoal((failures, tell) => {
  const refused: string[] = [];
  for (const board of tell.over("the wrong boards", WRONG)) {
    let message: string | undefined;
    try {
      board.build();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (message === undefined) {
      failures.push(`b:refused · ${board.name}: built, with no refusal`);
      continue;
    }
    if (!board.setting.test(message)) failures.push(`b:names-the-setting · ${board.name}: ${message}`);
    if (!board.fix.test(message)) failures.push(`b:names-the-fix · ${board.name}: ${message}`);
    refused.push(board.name);
  }
  // The same boards, declared right, build: the fence refuses only the contradiction.
  try {
    taskBoard({ name: "issue-work-right", boardId: "issue-work-right", mode: "delegation", collection: ledger("issue-work-right"), workers: { implement: handsOff() } });
    // A plan board that hands a row over and waits on it (FIX-2082).
    taskBoard({ name: "plan-hands-over", boardId: "plan-hands-over", collection: ledger("plan-hands-over"), workers: { implement: handsOff() } });
    goalSeekLoop({ name: "seek-right", maxIterations: 3, judge, board: taskBoard({ name: "plan-right", workers: inline("plan-right-w") }) });
  } catch (error) {
    failures.push(`b:right-builds: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { failures, evidence: `${refused.length} boards refused at build, each naming its setting and fix: ${refused.join("; ")}` };
});
