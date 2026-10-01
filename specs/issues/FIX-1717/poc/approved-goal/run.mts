/**
 * FIX-1717 spec evidence: what a coding run started from Shift Manager's
 * "Approve & run" is actually handed.
 *
 * Drives the path Shift Manager drives, model-free: the DevForce lab's tree
 * opened with its ask on (the `devteam` profile's boot), the pending approval
 * found where Inbox finds it, approved through the engine's resume route with
 * the lab's verified bearer, and the coder seat's run reached through the board
 * hand-off. The harness slot is the lab's scripted stub, which records the
 * prompt the manager built — the only evidence of what a run is handed.
 *
 * Claim (today, the default): the row the person approved carries the goal,
 * and the prompt does NOT — neither the approved goal nor the charter of the
 * channel both seats share reaches the run. The seat's own files do.
 *
 * `AFTER=1` checks the target state instead: the prompt carries the approved
 * goal and the shared channel's charter, and still carries the seat's files.
 *
 * Positive control, always run: the prompt carries the coder's instructions
 * token, so an "absent" verdict is about the prompt the run got, not about a
 * check that read nothing.
 *
 * Run from the repo root:
 *   pnpm tsx specs/issues/FIX-1717/poc/approved-goal/run.mts
 * Retained spec evidence, not production code; nothing discovers or runs it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { harnessStub, type StubRun } from "../../../../../goals/devforce-lab/lab/harness-stub.mts";
import { openLab } from "../../../../../goals/devforce-lab/lab/host.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../../../../../goals/devforce-lab/lab/scratch-repo.mts";
import { seatSessionId } from "../../../../../goals/devforce-lab/lab/ask.mts";
import { silentLogger } from "../../../../../goals/lib/index.mts";

// The engine resolves from the goals package, which depends on it; this file
// lives under specs/ and has no node_modules of its own.
const goalsRequire = createRequire(new URL("../../../../../goals/package.json", import.meta.url));
const { inMemoryStores } = (await import(
  pathToFileURL(goalsRequire.resolve("@flow-state-dev/engine")).href
)) as { inMemoryStores: () => unknown };

const AFTER = process.env.AFTER === "1";
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../../goals/devforce-lab/it-waits-for-a-person-before-it-files/fixtures/input.json", import.meta.url),
    ),
    "utf8",
  ),
) as { feature: { issue: string; goal: string }; coordinatorSeat: string; assignedSeat: string };

const charter = readFileSync(
  fileURLToPath(new URL("../../../../../goals/devforce-lab/lab/workforce/teams/eng/channels/feature/CHANNEL.md", import.meta.url)),
  "utf8",
);
const CHARTER_TOKEN = /Charter identifier: (\S+)/.exec(charter)![1]!;
const GOAL = fixture.feature.goal;
const SEAT_TOKEN = "CODER-INSTRUCTIONS-B42D9";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const commitWork = (run: StubRun): void => {
  writeFileSync(join(run.cwd, "WORK.md"), "work\n");
  commitAll(run.cwd, "work");
};

const dirs = createScratchRepo("fix-1717-poc");
const stub = harnessStub({ duringRun: commitWork });
const lab = await openLab({
  stores: inMemoryStores(),
  harness: stub.slot,
  workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
  coderSeatId: fixture.assignedSeat,
  logger: silentLogger,
  ask: fixture.feature,
});

let exit = 0;
try {
  // Find the pending approval where Inbox finds it, and approve it the way Shift Manager does.
  const session = seatSessionId(fixture.coordinatorSeat);
  const found = await lab.door("GET", `sessions/${session}/requests?include_items=true`);
  const request = (found.body.requests as any[]).find((r) => r.status === "suspended");
  const suspension = (request?.items ?? []).filter((i: any) => i.type === "suspension").at(-1);
  if (suspension === undefined) throw new Error("no pending approval in the EM's session");
  const approved = await lab.door("POST", `${fixture.coordinatorSeat}/requests/${request.id}/resume`, {
    body: { suspensionId: suspension.suspensionId, action: "approve" },
  });
  if (approved.status !== 202) throw new Error(`approve answered ${approved.status}`);

  for (let waited = 0; stub.runs.length === 0 && waited < 60_000; waited += 100) await sleep(100);
  const run = stub.runs[0];
  if (run === undefined) throw new Error("the coder seat was never reached");
  const rows = Object.values(await lab.rows()) as Array<{ id: string; goal?: string }>;

  const has = (token: string) => run.prompt.includes(token);
  console.log("---- the prompt the coder's harness was handed ----");
  console.log(run.prompt);
  console.log("---- verdict ----");
  console.log(`row ${rows[0]?.id} carries the approved goal: ${rows[0]?.goal === GOAL}`);
  console.log(`positive control, the seat's instructions token in the prompt: ${has(SEAT_TOKEN)}`);
  console.log(`the approved goal in the prompt: ${has(GOAL)}`);
  console.log(`the shared channel's charter (${CHARTER_TOKEN}) in the prompt: ${has(CHARTER_TOKEN)}`);

  if (!has(SEAT_TOKEN) || rows[0]?.goal !== GOAL) {
    console.log("INCONCLUSIVE — the check did not read the real prompt, or the row lacks the goal");
    exit = 2;
  } else if (!AFTER) {
    const thin = !has(GOAL) && !has(CHARTER_TOKEN);
    console.log(thin ? "CONFIRMED — the run is handed neither the approved goal nor the shared charter" : "REFUTED");
    exit = thin ? 0 : 1;
  } else {
    const packed = has(GOAL) && has(CHARTER_TOKEN);
    console.log(packed ? "PASS — the run is handed the approved goal and the shared charter" : "FAIL");
    exit = packed ? 0 : 1;
  }
} finally {
  await lab.dispose();
}
process.exit(exit);
