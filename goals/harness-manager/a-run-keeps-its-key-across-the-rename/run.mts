/**
 * Goal: harness-manager › a run keeps its key across the rename.
 *
 * A coding run on the kit's mode, started before its key's last segment was
 * renamed (`code` → `default`) and resumed after, is found under the old key
 * and finishes there: same branch, checkout and coding session, and nothing is
 * written under the new key. A run that starts after the rename is keyed by
 * the new name.
 *
 * The "after" manager takes the kit's real mode names (`codingMode({})`), so
 * the check fails if the kit drops its former name. Real engine, real claim
 * gate, real fenced settlement and a real git checkout (the package's claim
 * host, restarted over the same stores). Only the harness is a stub.
 *
 * A second leg (`fixed:*`) does the same on a fixed board, whose row names
 * its segment in its payload (`{ issue, phase: "code" }`): the manager must
 * take that row as its own mode, under its former name.
 *
 * Controls (`GOAL_CONTROL`): `no-legacy-key` removes the former-name read from
 * `readModeRunRecord`; must fail `resume:session`. `former-name-refused`
 * removes the former name from the manager's row identity check; must fail
 * `fixed:resume`.
 *
 * Run: pnpm tsx goals/harness-manager/a-run-keeps-its-key-across-the-rename/run.mts
 */
process.env.FSDEV_TRACE_OBSERVABILITY = "0";
delete process.env.FSDEV_DEFAULT_MODEL;

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTopic } from "@flow-state-dev/harness-manager";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";
import { codingMode } from "../../../packages/harness-manager/src/kit/coder-flow.ts";
import { runBoardSegment } from "../../../packages/harness-manager/src/workspace.ts";
import { CONVERSATIONS, FIXED_BOARD, claimHost, cleanUpHosts, messageOf } from "../../../packages/harness-manager/test/claim-host.ts";

interface Fixture {
  /** The segment the kit's runs were keyed by before modes had names. */
  formerSegment: string;
  /** The conversation (board partition) the task is filed in. */
  partition: string;
  /** The task's goal. Any goal passes the same way. */
  goal: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);
const SCRATCH = goalTmpDir("a-run-keeps-its-key-across-the-rename");

// ---- control: a scratch patch, applied in a child that loads it ----------------

const RUN_RECORD = "packages/harness-manager/src/run-record.ts";
const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[] }> = {
  "no-legacy-key": {
    must: ["resume:session"],
    patches: [
      {
        module: RUN_RECORD,
        from: String.raw`  for \(const older of \[spelled, mode\.formerName\]\) \{`,
        to: "  for (const older of [] as (string | undefined)[]) {",
      },
    ],
  },
  "former-name-refused": {
    must: ["fixed:resume"],
    patches: [
      {
        module: "packages/harness-manager/src/manager.ts",
        from: String.raw` && !\(mode\.formerName !== undefined && sameSegment\(phaseName, mode\.formerName\)\)\) \{`,
        to: ") {",
      },
    ],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assertPatched(patches, REPO_ROOT, mark);
  const out = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const failedOn = must.filter((assertion) => /^FAIL/m.test(out) && out.includes(`${assertion} —`));
  console.log(
    failedOn.length > 0
      ? `control ${CONTROL}: failed on ${failedOn.join(", ")}, as it must`
      : `control ${CONTROL}: did NOT fail on any of ${must.join(", ")}, so the check can't see what the control removes`,
  );
  process.exit(failedOn.length > 0 ? 0 : 1);
}

await runGoal(async (failures, tell) => {
  const fail = (assertion: string, why: string) => failures.push(`${assertion} — ${why}`);
  const evidence: string[] = [];
  const kit = codingMode({});
  const segment = runBoardSegment(CONVERSATIONS, fixture.partition);
  const at = (issue: string, name: string) => runTopic(segment, issue, name);
  try {
    // Before the change: the kit's mode keyed its runs by the former segment. Attempt 1 is not done, so its task goes back to the board.
    const before = claimHost({ mode: "claim", modeName: fixture.formerSegment, isDone: () => false, script: [{ answer: "half done", commits: 1 }] });
    await before.seed({ ledgerId: CONVERSATIONS, partition: fixture.partition, id: "t1", goal: fixture.goal, input: {}, maxAttempts: 3 });
    await before.runAttempt(CONVERSATIONS, "t1", fixture.partition);
    const stored = await before.record(at("t1", fixture.formerSegment));
    if (stored?.sessionId == null || stored.branch == null) {
      fail("setup:stored", `no run was stored under ${at("t1", fixture.formerSegment)}: ${JSON.stringify(stored)}`);
      return { failures, evidence: "" };
    }

    // After the change: a new engine and manager on the kit's mode, over the same stores and checkouts.
    if (kit.name === fixture.formerSegment) fail("mode:renamed", `the kit's mode is still named "${kit.name}"`);
    const after = claimHost({
      mode: "claim",
      modeName: kit.name,
      ...(kit.formerName === undefined ? {} : { formerName: kit.formerName }),
      restartOf: { dir: before.dir, stores: before.stores },
    });
    const resumed = await after.runAttempt(CONVERSATIONS, "t1", fixture.partition);
    if (resumed.result.error !== undefined) fail("resume:ran", messageOf(resumed.result.error));
    const runs = tell.over("resume · the harness calls after the change", after.seen);
    const run = runs[0];
    if (run?.resume !== stored.sessionId) fail("resume:session", `the resumed run was handed session ${JSON.stringify(run?.resume)}, not the stored ${stored.sessionId}`);
    if (run !== undefined && run.cwd !== before.seen[0]?.cwd) fail("resume:checkout", `the resumed run worked in ${run.cwd}, not ${before.seen[0]?.cwd}`);
    const finished = await after.record(at("t1", fixture.formerSegment));
    if (finished?.attempt !== 2 || finished.outcome !== "succeeded") fail("resume:finished-there", `the old key's record is ${JSON.stringify({ attempt: finished?.attempt, outcome: finished?.outcome })}`);
    if (finished?.branch !== stored.branch) fail("resume:branch", `the run's branch moved from ${stored.branch} to ${finished?.branch}`);
    const underNew = await after.record(at("t1", kit.name));
    if (underNew !== null) fail("resume:nothing-new", `a record was written under ${at("t1", kit.name)}`);
    if (failures.length === 0) evidence.push(`a run stored under ${at("t1", fixture.formerSegment)} resumed on session ${stored.sessionId}, branch ${stored.branch}, and finished there; nothing under ${at("t1", kit.name)}`);

    // A new run on the same mode, after the change: keyed by the new name.
    await after.seed({ ledgerId: CONVERSATIONS, partition: fixture.partition, id: "t2", goal: fixture.goal, input: {} });
    const fresh = await after.runAttempt(CONVERSATIONS, "t2", fixture.partition);
    if (fresh.result.error !== undefined) fail("new:ran", messageOf(fresh.result.error));
    const freshRecord = await after.record(at("t2", kit.name));
    if (freshRecord?.outcome !== "succeeded") fail("new:keyed-by-name", `no finished record under ${at("t2", kit.name)}: ${JSON.stringify(freshRecord?.outcome)}`);
    if ((await after.record(at("t2", fixture.formerSegment))) !== null) fail("new:not-former", `a new run wrote under ${at("t2", fixture.formerSegment)}`);
    else evidence.push(`a new run was keyed ${at("t2", kit.name)}`);

    // A fixed board: the row names its segment in its payload, filed before the rename.
    const rowId = `fix-1--${fixture.formerSegment}`;
    const fixedBefore = claimHost({ mode: "fixed", modeName: fixture.formerSegment, isDone: () => false, script: [{ answer: "half done", commits: 1 }] });
    await fixedBefore.seed({ ledgerId: FIXED_BOARD, id: rowId, goal: fixture.goal, input: { issue: "FIX-1", phase: fixture.formerSegment }, maxAttempts: 3 });
    await fixedBefore.runAttempt(FIXED_BOARD, rowId);
    const fixedStored = await fixedBefore.record(runTopic(FIXED_BOARD, "FIX-1", fixture.formerSegment));
    if (fixedStored?.sessionId == null) fail("fixed:stored", `no run was stored under ${runTopic(FIXED_BOARD, "FIX-1", fixture.formerSegment)}`);
    const fixedAfter = claimHost({
      mode: "fixed",
      modeName: kit.name,
      ...(kit.formerName === undefined ? {} : { formerName: kit.formerName }),
      restartOf: { dir: fixedBefore.dir, stores: fixedBefore.stores },
    });
    await fixedAfter.runAttempt(FIXED_BOARD, rowId);
    const fixedRow = await fixedAfter.row(FIXED_BOARD, rowId);
    if (fixedAfter.seen[0]?.resume !== fixedStored?.sessionId || fixedAfter.seen[0] === undefined) {
      fail("fixed:resume", `the row filed as "${fixture.formerSegment}" did not resume its session: ${JSON.stringify({ seen: fixedAfter.seen.length, resume: fixedAfter.seen[0]?.resume, status: fixedRow.status, error: (fixedRow as { error?: unknown }).error })}`);
    }
    const fixedFinished = await fixedAfter.record(runTopic(FIXED_BOARD, "FIX-1", fixture.formerSegment));
    if (fixedFinished?.outcome !== "succeeded" || fixedRow.status !== "completed") fail("fixed:finished-there", `record ${JSON.stringify(fixedFinished?.outcome)}, row ${fixedRow.status}`);
    else if ((await fixedAfter.record(runTopic(FIXED_BOARD, "FIX-1", kit.name))) !== null) fail("fixed:nothing-new", `a record was written under ${runTopic(FIXED_BOARD, "FIX-1", kit.name)}`);
    else evidence.push(`a fixed-board row filed as ${fixture.formerSegment} resumed on its session and finished under ${runTopic(FIXED_BOARD, "FIX-1", fixture.formerSegment)}`);
  } finally {
    cleanUpHosts();
  }
  return { failures, evidence: evidence.join("; ") };
});
