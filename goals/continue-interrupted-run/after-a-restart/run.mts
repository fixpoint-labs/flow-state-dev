/**
 * Goal check — a turn a restart cut off can be continued or discarded.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 *   Host A: a durable server on an on-disk SQLite store (`host.mts`). Two
 *           sessions each start a `respond` turn that holds. A is killed
 *           (SIGKILL to its process group): no shutdown, no settle.
 *   Host B: a fresh process on the same store. Through the shipped client,
 *           `interruptedBySession` lists each turn under its own session.
 *           Continue on the first finishes the SAME request id with its
 *           answer; Discard on the second ends it `aborted` and drops it from
 *           `requests.interrupted()`.
 *   Host C: started again on the same store. The discarded turn is still gone
 *           from the interrupted list, and both requests keep their endings.
 *
 * Control (`GOAL_CONTROL=old-abort`, same command): the engine's stop of an
 * interrupted request is patched back to answering "finished" as each host
 * loads it. The Discard leg must fail.
 *
 * Run: pnpm tsx goals/continue-interrupted-run/after-a-restart/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createClient, interruptedBySession, type InterruptedRequest } from "@flow-state-dev/client";
import {
  REPO_ROOT,
  assertPatched,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  refuseIfAnswering,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "old-abort"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

/** Today's abort, before FIX-2377: a dead request no gate holds is reported finished, and stays interrupted. */
const OLD_ABORT: ModulePatch[] = [
  {
    module: "packages/engine/src/execution/record-request-stop.ts",
    from: "return endInterrupted\\(requests, record\\.id, incarnation\\);",
    to: 'return { kind: "finished", status: "interrupted" };',
  },
];

const PORT = 4_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRATCH = goalTmpDir("after-a-restart");
const DB = join(SCRATCH, "store.sqlite");
const MARK = join(SCRATCH, "patched.txt");
const USER = "u_restart";
const ACTIONS = ["respond"];

/** Start the host on the shared store, and wait for it to answer. */
async function startHost(hold: boolean): Promise<ChildProcess> {
  await refuseIfAnswering(ORIGIN);
  const control = CONTROL === "old-abort" ? modulePatchEnv(OLD_ABORT, REPO_ROOT, MARK) : {};
  const child = spawn("pnpm", ["exec", "tsx", "goals/continue-interrupted-run/after-a-restart/host.mts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...control, PORT: String(PORT), GOAL_DB: DB, GOAL_HOLD: hold ? "1" : "" },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${ORIGIN}/healthz`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopProcessGroup(child, "SIGKILL");
  throw new Error("the host never answered /healthz");
}

/** Stop a host and wait until its port is free. */
async function stopHost(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  stopProcessGroup(child, signal);
  for (let i = 0; i < 80; i += 1) {
    try {
      await fetch(`${ORIGIN}/healthz`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the host kept answering after it was stopped");
}

const fsd = createClient({ userId: USER, baseUrl: ORIGIN });

/** The user's lost turns by session, read until `done` says so or the time runs out. */
async function lostUntil(
  done: (lost: Map<string, InterruptedRequest[]>) => boolean,
  ms: number,
): Promise<Map<string, InterruptedRequest[]>> {
  const until = Date.now() + ms;
  let lost = new Map<string, InterruptedRequest[]>();
  while (Date.now() < until) {
    lost = interruptedBySession(await fsd.requests.interrupted(), { actions: ACTIONS });
    if (done(lost)) return lost;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lost;
}

let host: ChildProcess | undefined;
await runGoal(async (failures) => {
  try {
    if (CONTROL !== "") console.error(`control ${CONTROL}:\n${describePatches(OLD_ABORT, REPO_ROOT)}`);

    // --- Host A: two turns in flight, then a hard kill -----------------------
    host = await startHost(true);
    const turns = fsd.flow("turns");
    const first = await turns.createSession();
    const second = await turns.createSession();
    const kept = await turns.send("respond", { message: "keep me" }, { sessionId: first.id });
    const dropped = await turns.send("respond", { message: "drop me" }, { sessionId: second.id });
    for (const sent of [kept, dropped]) {
      const until = Date.now() + 10_000;
      while ((await sent.status()).status !== "in_progress") {
        if (Date.now() > until) throw new Error(`turn ${sent.id} never started`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    // Let a heartbeat land, so the rows are a running turn's, then kill.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await stopHost(host, "SIGKILL");

    // --- Host B: find them, Continue one, Discard the other -----------------
    host = await startHost(false);
    const lost = await lostUntil((l) => l.has(first.id) && l.has(second.id), 20_000);
    const ofFirst = lost.get(first.id) ?? [];
    const ofSecond = lost.get(second.id) ?? [];
    if (ofFirst.map((r) => r.id).join() !== kept.id) failures.push(`session 1's lost turns read ${JSON.stringify(ofFirst.map((r) => r.id))}, expected [${kept.id}]`);
    if (ofSecond.map((r) => r.id).join() !== dropped.id) failures.push(`session 2's lost turns read ${JSON.stringify(ofSecond.map((r) => r.id))}, expected [${dropped.id}]`);
    if (ofFirst.length === 0 || ofSecond.length === 0) return { failures, evidence: "" };

    const continued = await ofFirst[0]!.continue();
    const settled = await continued.wait({ timeoutMs: 15_000 });
    if (continued.id !== kept.id) failures.push(`Continue ran ${continued.id}, not the lost request ${kept.id}`);
    if (settled.status !== "completed") failures.push(`the continued turn ended "${settled.status}", expected "completed"`);
    const answered = (await fsd.sessions.requests(first.id, { includeResultOutput: true })).find((r) => r.id === kept.id);
    const answer = JSON.stringify(answered?.result?.output ?? null);
    if (!answer.includes("answered: keep me")) failures.push(`the continued turn's output is ${answer}, expected its answer to "keep me"`);

    let discardError = "";
    try {
      await ofSecond[0]!.abort();
    } catch (error) {
      discardError = error instanceof Error ? error.message : String(error);
      failures.push(`Discard was refused: ${discardError}`);
    }
    const droppedStatus = (await dropped.status()).status;
    if (droppedStatus !== "aborted") failures.push(`the discarded turn is "${droppedStatus}", expected "aborted"`);
    const afterDiscard = interruptedBySession(await fsd.requests.interrupted(), { actions: ACTIONS });
    if (afterDiscard.has(second.id)) failures.push("the discarded turn is still listed as interrupted");
    await stopHost(host, "SIGTERM");

    // --- Host C: a discarded turn stays discarded ---------------------------
    host = await startHost(false);
    // Past a stale threshold and a sweep, so anything still owed would be listed.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const later = interruptedBySession(await fsd.requests.interrupted(), { actions: ACTIONS });
    if (later.size > 0) failures.push(`after another restart, sessions still list lost turns: ${JSON.stringify([...later.keys()])}`);
    const keptLater = (await fsd.flow("turns").request(kept.id).status()).status;
    const droppedLater = (await fsd.flow("turns").request(dropped.id).status()).status;
    if (keptLater !== "completed") failures.push(`after another restart the continued turn is "${keptLater}"`);
    if (droppedLater !== "aborted") failures.push(`after another restart the discarded turn is "${droppedLater}"`);

    if (CONTROL !== "") assertPatched(OLD_ABORT, REPO_ROOT, MARK);
    return {
      failures,
      evidence:
        `host killed with two turns in flight; a fresh host listed ${kept.id} under ${first.id} and ${dropped.id} under ${second.id}. ` +
        `Continue finished ${kept.id} itself (completed, output ${answer}); Discard ended ${dropped.id} "${droppedStatus}" and it left the list. ` +
        `After a second restart: no lost turns listed, ${kept.id} "${keptLater}", ${dropped.id} "${droppedLater}".`,
    };
  } finally {
    stopProcessGroup(host, "SIGKILL");
    rmSync(SCRATCH, { recursive: true, force: true });
  }
});
