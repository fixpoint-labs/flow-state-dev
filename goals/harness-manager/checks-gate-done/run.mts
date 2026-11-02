/**
 * Goal check — harness-manager › a run is done only when its checks pass.
 *
 * harness-manager on a real engine, a real task board with fenced settlement,
 * a real git checkout cut from a scratch repository, and real check commands.
 * Only the harness is a stub, scripted per leg to commit a change the check
 * rejects, the fix, or a run stopped at its limit. The check is the scratch
 * repository's own `node check.mjs`: red, printing the fixture's marker, until
 * `state.txt` holds the fixture's good state.
 *
 * Legs (`GOAL_LEGS=a,b,c,d,e`; unset runs all):
 *
 *   a   run 1 commits code the check rejects: the task is not done after
 *       attempt 1, and the run record holds the command, exit 3 and a tail
 *       with the marker
 *   b   attempt 2's brief carries that tail; run 2 commits the fix and the
 *       task waits on review with `data.checks` 1 of 1 passed
 *   c   a run that stopped at its limit runs no command
 *   d   a command past `timeoutMs` is stopped, recorded as timed out, and
 *       the attempt is not done
 *   e   `harnessSessionFlow` with `verify`: a red check is on the turn's
 *       record, and the turn is not failed
 *
 * Controls (`GOAL_CONTROL`): `no-checks` (the helper hands the phase back
 * unchanged) must FAIL `a:not-done`; `drop-reason` (the manager ignores the
 * verdict's reason) must FAIL `b:brief-has-tail`. Each is a scratch patch
 * applied as the code loads, printed by the run, and refused when it never
 * reached the code.
 *
 * Run: pnpm tsx goals/harness-manager/checks-gate-done/run.mts
 */
process.env.FSDEV_TRACE_OBSERVABILITY = "0";
delete process.env.FSDEV_DEFAULT_MODEL;

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { defineTaskCollection, type SuspensionHold, type Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { taskSettledEntry } from "@flow-state-dev/orchestration";
import {
  ASK_MARKER_IGNORE_RULE,
  commandCheck,
  harnessManager,
  harnessSessionFlow,
  harnessTaskInputSchema,
  runOwnerClaimOrder,
  runTopic,
  type HarnessFeeds,
  type HarnessSessionState,
  type PhaseSpec,
} from "@flow-state-dev/harness-manager";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, type ModulePatch } from "../../lib/index.mts";

interface Fixture {
  marker: string;
  goodState: string;
  verifyMarker: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);

const ALL_LEGS = ["a", "b", "c", "d", "e"] as const;
const LEGS = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((leg) => leg.trim()).filter(Boolean));
const SCRATCH = goalTmpDir("checks-gate-done");
const MANAGER = "packages/harness-manager/src/manager.ts";
const COMMAND_CHECK = "packages/harness-manager/src/command-check.ts";

// ---- controls: scratch patches, applied in a child that loads them ----------------

const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[]; legs: string }> = {
  "no-checks": {
    must: ["a:not-done"],
    legs: "a",
    patches: [{ module: COMMAND_CHECK, from: String.raw`  const own = phase\.doneTimeoutMs \?\? NETWORK_CALL_TIMEOUT_MS;`, to: "  return phase;\n  const own = 0;" }],
  },
  "drop-reason": {
    must: ["b:brief-has-tail"],
    legs: "b",
    patches: [{ module: MANAGER, from: String.raw`notDoneReason = verdict\.done \? undefined : verdict\.reason;`, to: "notDoneReason = undefined;" }],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must, legs } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, GOAL_LEGS: process.env.GOAL_LEGS ?? legs, ...modulePatchEnv(patches, REPO_ROOT, mark) },
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

const show = (value: unknown) => JSON.stringify(value);
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });

// ---- the scratch repository: its check is red until state.txt holds the good state ---

function scratchRepo(label: string): string {
  const repo = join(SCRATCH, `${label}-${RUN_STAMP}`, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "--initial-branch=main", ".");
  writeFileSync(join(repo, ".gitignore"), `${ASK_MARKER_IGNORE_RULE}\n`);
  writeFileSync(
    join(repo, "check.mjs"),
    `import { readFileSync } from "node:fs";\n` +
      `let s = ""; try { s = readFileSync("state.txt", "utf8").trim(); } catch {}\n` +
      `if (s !== ${JSON.stringify(fixture.goodState)}) { console.error(${JSON.stringify(fixture.marker)} + ": state is " + JSON.stringify(s)); process.exit(3); }\n` +
      `console.log("all good");\n`,
  );
  writeFileSync(join(repo, "hang.mjs"), "setInterval(() => {}, 1000);\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "the project and its check");
  return repo;
}

// ---- the stub harness: commits per its script, records each prompt -----------------

type Step = "breaks" | "fixes" | "stops-at-limit";

function stub(script: Step[], prompts: string[]) {
  return (feeds: HarnessFeeds): HarnessBlock =>
    handler({
      name: "goal-stub-harness",
      inputSchema: harnessRunInputSchema,
      outputSchema: harnessRunHandleSchema,
      execute: async (input, ctx) => {
        const n = prompts.length + 1;
        prompts.push(input.prompt);
        const step = script[n - 1] ?? "breaks";
        const cwd = await feeds.cwd(ctx as never);
        await feeds.onSession(`sess_${n}`, ctx as never);
        writeFileSync(join(cwd, "state.txt"), step === "fixes" ? `${fixture.goodState}\n` : "broken\n");
        git(cwd, "add", "state.txt");
        git(cwd, "commit", "-q", "-m", `Step ${n}`);
        return {
          source: "stub/goal",
          status: "completed" as const,
          sessionId: `sess_${n}`,
          url: null,
          dispatchedAt: Date.now(),
          outcome: step === "stops-at-limit" ? ("stopped-at-limit" as const) : ("finished" as const),
          finalMessage: "done",
          usage: null,
          cost: null,
        };
      },
    }) as unknown as HarnessBlock;
}

// ---- the host: one manager, one board, one task ------------------------------------

const BOARD = "goal.checks";
const ORG = "org_goal_checks";
const USER = "alice";
const ISSUE = "FIX-1";
const PHASE = "implement";
const TASK = harnessTaskId(ISSUE, PHASE);

async function open(options: { label: string; script: Step[]; commands: string[]; timeoutMs: number; reviewChanges?: boolean }) {
  const repo = scratchRepo(options.label);
  const prompts: string[] = [];
  const base: PhaseSpec = {
    phase: PHASE,
    buildPrompt: (run) =>
      [`Work on ${run.issue}.`, ...(run.feedback === undefined ? [] : ["# Why the last attempt stopped", run.feedback])].join("\n\n"),
    isDone: (run) => run.stopReport === "finished",
  };
  const ledger = defineTaskCollection({ id: BOARD, scope: "org" as const, stateSchema: harnessTaskInputSchema });
  const manager = harnessManager({
    boardCollectionId: BOARD,
    boardCollection: ledger,
    tenant: undefined,
    phase: commandCheck(base, { commands: options.commands, timeoutMs: options.timeoutMs }),
    workspace: { root: join(repo, "..", "checkouts"), sourceRepo: repo, baseRef: "main", provisionTimeoutMs: 20_000 },
    runTimeoutMs: 30_000,
    ownership: { pollMs: 25 },
    harness: stub(options.script, prompts),
    ...(options.reviewChanges === true ? { reviewChanges: true } : {}),
  });
  const board = taskBoard({
    name: "goal-board",
    boardId: "goal-board",
    mode: "delegation",
    collection: ledger,
    concurrency: 1,
    claimOrder: runOwnerClaimOrder(),
    workers: { coder: dispatcher({ name: "goal-board-dispatch", action: "work", session: "per-task" }) },
  });
  const seed = handler({
    name: "goal-seed",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string() }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap["goal-board"];
      if ((await tasks.getTask(TASK)) === undefined) {
        await tasks.createTask({ id: TASK, goal: "the feature", input: { issue: ISSUE, phase: PHASE }, assignee: "coder", maxAttempts: 2 });
      }
      return { id: TASK };
    },
  });
  const heard = taskSettledEntry({ block: handler({ name: "goal-heard", inputSchema: z.unknown(), outputSchema: z.unknown(), execute: () => ({}) }) });
  const flow = defineFlow({
    kind: "checks-goal",
    actions: { seed: { block: seed }, drain: { block: board.drain } },
    internal: { actions: { onTaskSettled: heard } },
    task: { actions: { work: { block: manager } } },
  } as never)({ id: "checks-goal" } as never);
  const state = createFlowState({
    flows: { "checks-goal": flow },
    stores: { goal: { primary: inMemoryStores() } },
    defaultProfile: "goal",
    dispatchDrainTimeoutMs: 60_000,
    durable: true,
  } as never);
  const runtime = async () => (state as unknown as { getRuntime(): Promise<{ stores: any; runtimeConfig: object }> }).getRuntime();
  const act = async (action: string) => {
    const rt = await runtime();
    return runAction({ flow, actionName: action, input: {}, userId: USER, orgId: ORG, sessionId: `s_${USER}`, stores: rt.stores, runtimeConfig: { ...rt.runtimeConfig } } as never);
  };
  const task = async (): Promise<Task> => (await (await runtime()).stores.resourceState.get("org", ORG, `${BOARD}/${TASK}`))?.state as Task;
  const record = async (): Promise<any> =>
    (await (await runtime()).stores.resourceState.get("user", `${USER}:~org:${ORG}`, `runs/${runTopic(BOARD, ISSUE, PHASE)}`))?.state;
  const until = async (predicate: (t: Task) => boolean, what: string, ms = 45_000): Promise<Task> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const current = await task();
      if (current !== undefined && predicate(current)) return current;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; the task is ${show(current)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const review = (t: Task) => t.holds?.find((h): h is SuspensionHold => h.source.kind === "suspension" && h.ask.kind === "review");
  const suspension = async (hold: SuspensionHold) =>
    (await (await runtime()).stores.suspensions.get(hold.source.requestId, hold.source.suspensionId)) as { data?: any } | null;
  await state.getRouter();
  await act("seed");
  await act("drain");
  return { act, task, record, until, review, suspension, prompts, dispose: () => state.dispose() };
}

/** Wait for the first try to come back to the board. */
const backOnBoard = (t: Task) => t.status === "pending" && t.attempts === 1;

// ---- the session leg: `verify` on a turn ------------------------------------------

async function sessionTurn(): Promise<{ error: unknown; turn: any }> {
  const dir = join(SCRATCH, `session-${RUN_STAMP}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "red.mjs"), `console.error(${JSON.stringify(fixture.verifyMarker)}); process.exit(1);`);
  const stores = createInMemoryStores();
  const now = Date.now();
  const sessionId = "s-verify";
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: "verify-goal", userId: "u", orgId: DEFAULT_ORG_ID, metadata: undefined, latestRequestId: undefined, state: { model: "stub" }, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any" as never,
  );
  const agent = () =>
    handler({
      name: "goal-session-harness",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async () => ({ source: "stub/goal", status: "completed", sessionId: null, url: null, dispatchedAt: 0, outcome: "finished", finalMessage: null }),
    }) as unknown as HarnessBlock;
  const result = (await runAction({
    flow: harnessSessionFlow({
      kind: "verify-goal",
      workspace: { provision: async () => dir, locate: () => dir, branch: () => null },
      agent,
      verify: { commands: ["node red.mjs"], timeoutMs: 20_000 },
    }),
    actionName: "turn",
    input: { prompt: "change it" },
    userId: "u",
    orgId: DEFAULT_ORG_ID,
    sessionId,
    stores,
    runtimeConfig: {},
  } as never)) as { error?: unknown };
  const state = (await stores.session.get(sessionId))?.state as HarnessSessionState;
  return { error: result.error, turn: Object.values(state.turns ?? {})[0] };
}

// ---- the legs ----------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (tag: string, what: string) => failures.push(`${tag} — ${what}`);
  try {
    if (LEGS.has("a") || LEGS.has("b")) {
      const host = await open({ label: "ab", script: ["breaks", "fixes"], commands: ["node check.mjs"], timeoutMs: 20_000, reviewChanges: true });
      try {
        // a: the run's code fails the check, so attempt 1 is not done.
        const after = await host.until((t) => backOnBoard(t) || t.status === "completed" || t.status === "in_progress" && host.review(t) !== undefined, "attempt 1 to settle");
        if (!backOnBoard(after)) fail("a:not-done", `attempt 1 settled as ${after.status} (attempts ${after.attempts}), not back on the board`);
        const red = (await host.record())?.checks;
        if (!(Array.isArray(red) && red[0]?.command === "node check.mjs" && red[0]?.exitCode === 3)) fail("a:recorded", `the run record's checks are ${show(red)}`);
        else if (!String(red[0].tail).includes(fixture.marker)) fail("a:tail", `the recorded tail lacks the marker: ${show(red[0].tail)}`);
        else evidence.push(`a: attempt 1 not done; run record: \`node check.mjs\` exit 3, tail has the marker`);

        if (LEGS.has("b") && backOnBoard(after)) {
          await host.act("drain");
          const held = await host.until((t) => t.attempts === 2 && host.review(t) !== undefined, "attempt 2's review");
          const brief = host.prompts[1] ?? "";
          if (!(brief.includes("`node check.mjs` exited 3") && brief.includes(fixture.marker))) fail("b:brief-has-tail", `attempt 2's brief lacks the command or its output: ${show(brief.slice(0, 400))}`);
          const data = (await host.suspension(host.review(held)!))?.data;
          const checks = data?.checks;
          if (!(Array.isArray(checks) && checks.length === 1 && checks[0]?.exitCode === 0)) fail("b:review-checks", `the review's data.checks is ${show(checks)}`);
          if (!host.review(held)!.ask.prompt.includes("Checks 1/1 passed.")) fail("b:review-prompt", `the review's prompt: ${show(host.review(held)!.ask.prompt)}`);
          evidence.push(`b: attempt 2's brief named the command and carried the marker; review data.checks 1/1 passed`);
        }
      } finally {
        await host.dispose();
      }
    }

    if (LEGS.has("c")) {
      const host = await open({ label: "c", script: ["stops-at-limit"], commands: ["node check.mjs"], timeoutMs: 20_000 });
      try {
        await host.until(backOnBoard, "attempt 1 back on the board");
        const checks = (await host.record())?.checks;
        if (checks != null) fail("c:no-command", `a run stopped at its limit ran checks: ${show(checks)}`);
        else evidence.push("c: a run stopped at its limit ran no command");
      } finally {
        await host.dispose();
      }
    }

    if (LEGS.has("d")) {
      const host = await open({ label: "d", script: ["fixes"], commands: ["node hang.mjs", "node check.mjs"], timeoutMs: 1_500 });
      try {
        const after = await host.until((t) => backOnBoard(t) || t.status === "completed", "attempt 1 to settle");
        const checks = (await host.record())?.checks;
        if (!backOnBoard(after)) fail("d:not-done", `a check past its budget settled the task ${after.status}`);
        if (!(checks?.[0]?.timedOut === true && checks?.[1]?.skipped === true)) fail("d:timed-out", `the run record's checks are ${show(checks)}`);
        else evidence.push("d: `node hang.mjs` stopped at 1.5 s and recorded timed out, the next skipped; not done");
      } finally {
        await host.dispose();
      }
    }

    if (LEGS.has("e")) {
      const { error, turn } = await sessionTurn();
      if (error !== undefined) fail("e:turn-stands", `a red check failed the turn: ${show(error)}`);
      const checks = turn?.checks;
      if (!(checks?.[0]?.exitCode === 1 && String(checks[0].tail).includes(fixture.verifyMarker))) fail("e:on-the-turn", `the turn's checks are ${show(checks)}`);
      else evidence.push("e: a red verify check is on the turn's record, and the turn stands");
    }
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true });
  }
  return { failures, evidence: evidence.join("; ") };
});
