/**
 * Goal check — a team declared entirely in files has work filed by one worker
 * and run to completion by another, with nothing in a file declaring a board.
 *
 * **Model-free on purpose.** Nothing here is a judgment call: a task is filed,
 * a board runs it, a side effect happens or it does not. Putting a model in
 * the loop would add a way to fail that has nothing to do with the claim.
 *
 * What the tree contributes, and the code does not: who files (the worker
 * whose file names `delegates:`), whom it files for, and which flow each runs
 * on. No file declares a board, and none names where the work is kept: the
 * board is the filer's own conversation's, at a partition the server mints,
 * which is why leg 0 greps the whole tree for it and fails if it is there.
 *
 * Legs:
 *   0  the tree declares no board, and never names where the work is kept
 *   a  the tree alone produces the roster and the workers' flows
 *   b  the filer's conversation lists its delegate as taking a task
 *   c  the filer files one task through its own conversation's action
 *   d  the conversation's board hands it to the delegate, whose run really ran
 *   e  the task is completed in the filer's own store, at its conversation's
 *      partition, read straight out of storage, and nowhere at org scope
 *
 * Controls (GOAL_CONTROL=...), each perturbing THIS FILE, never the tree:
 *   no-delegates  the filer's file is read without its `delegates:` line.
 *                 Must FAIL at leg (b) and (c): nothing grants it the task
 *                 tools, so its filing is refused; (d) and (e) follow.
 *   hollow-run    the delegate's run writes nothing outside the board. Must
 *                 FAIL at leg (d) only: the board still reports the task done.
 *
 * Run: pnpm tsx goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds/run.mts
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { goalTmpDir, actingAs, hearsMessages, runGoal, silentLogger, untilIdle } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_mailbox_boards";
const ORG_ID = "org_mailbox_boards";
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** Where the delegate's run leaves its proof. A real file, not a counter. */
const OUTBOX = join(goalTmpDir("mailbox-boards"), "ran.txt");

/** Every file in the tree, so leg 0 can look for what no file may say. */
function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

await runGoal(async (failures) => {
  mkdirSync(join(OUTBOX, ".."), { recursive: true });
  writeFileSync(OUTBOX, "", "utf8");

  // ---- a. the tree alone produces the roster --------------------------------
  const roster = await readWorkforce(TREE);
  if (roster.errors.length > 0) return { failures: [`a: the tree did not load cleanly: ${JSON.stringify(roster.errors)}`], evidence: "" };
  const workers: WorkerManifest[] =
    CONTROL === "no-delegates"
      ? roster.workers.map((w) => {
          const { delegates: _dropped, ...declared } = w.declared as Record<string, unknown>;
          return { ...w, declared };
        })
      : roster.workers;
  // Read off the FILES, never hardcoded: the filer is the worker whose file
  // names delegates, and its first delegate is the one it files for.
  const filer = roster.workers.find((w) => Array.isArray(w.declared.delegates) && (w.declared.delegates as unknown[]).length > 0);
  if (filer === undefined) return { failures: ["a: no worker file in the tree names delegates"], evidence: "" };
  const delegate = roster.workers.find((w) => w.id === (filer.declared.delegates as string[])[0]);
  if (delegate === undefined) return { failures: ["a: the filer's delegate is declared by no file"], evidence: "" };
  const filerKind = String(filer.declared.flow);
  const delegateKind = String(delegate.declared.flow);

  // ---- 0. no file declares a board ------------------------------------------
  for (const path of treeFiles(TREE)) {
    const text = readFileSync(path, "utf8");
    if (/^(boards|boardActions|filing):/m.test(text)) failures.push(`0: ${path} declares a board or a grant; a worker files through its delegates`);
  }

  // ---- the two flows. Neither names a ledger, a board or a partition. -------
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });

  const board = defineSessionBoard({ installation, flowKind: filerKind });
  const filerTurn = handler({ name: "row-goal-filer-turn", inputSchema: doorInput, execute: async () => "Noted." });
  const filerFlow = defineFlow({
    kind: filerKind,
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: filerTurn, userMessage: (input: { message: string }) => input.message },
      ...board.actions
    },
    internal: { actions: board.entries(filerTurn, () => "fixed") }
  } as never);

  const delegateTurn = handler({
    name: "row-goal-delegate-turn",
    inputSchema: doorInput,
    execute: async (input) => {
      // A real side effect: proving "it ran" by a file rather than by the
      // board's own report, which the board would produce either way.
      if (CONTROL !== "hollow-run") writeFileSync(OUTBOX, `${input.message}\n`, { flag: "a" });
      return `done: ${input.message}`;
    }
  });
  const delegateFlow = defineFlow({
    kind: delegateKind,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { inputSchema: doorInput, block: delegateTurn, userMessage: (input: { message: string }) => input.message } },
    internal: { actions: hearsMessages(installation, delegateKind) },
    task: { actions: { work: workerTaskEntry({ name: "row-goal-delegate-task", turn: delegateTurn }) } }
  } as never);

  workerFlows = { [filerKind]: { flow: filerFlow, roles: ["manager"] }, [delegateKind]: { flow: delegateFlow, roles: ["contributor"] } };
  const hired = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(hired.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);

  try {
    const runtime = await state.getRuntime();
    const { act, open } = actingAs(await state.getRouter(), USER_ID);
    const conversation = await open(filerKind, { workerId: filer.id });

    // ---- b. the conversation lists its delegate as taking a task ------------
    const listed = await act(filerKind, conversation, "listDelegates", {});
    const partition = listed?.filingSessionId as string | undefined;
    const entry = ((listed?.delegates ?? []) as Array<{ worker: string; takes: string }>).find((d) => d.worker === delegate.id);
    if (entry === undefined || (entry.takes !== "tasks" && entry.takes !== "both")) {
      failures.push(`b: the conversation lists ${delegate.id} as ${entry === undefined ? "absent" : `taking ${entry.takes}`}, not as taking a task`);
    }

    // ---- c. the filer files one task, through its own conversation ----------
    const goal = `wire the ${delegate.id} feature end to end`;
    const filed = await act(filerKind, conversation, "createTask_tasks", { goal, assignee: delegate.id });
    if (filed?.ok !== true) failures.push(`c: ${filer.id}'s conversation could not file a task: ${JSON.stringify(filed)}`);
    await untilIdle(runtime.stores);

    // ---- d. the board handed it over, and the work really ran ----------------
    // Nothing here names the task, the assignee or the worker to a board run:
    // the filing started it.
    const outbox = readFileSync(OUTBOX, "utf8").trim();
    if (!outbox.includes(goal)) failures.push(`d: the work did not run: the outbox holds ${JSON.stringify(outbox)}`);

    // ---- e. the task itself, read out of storage ----------------------------
    // Read from the store rather than from the board's report, which would say
    // "completed" whatever it actually wrote.
    const userScope = `${USER_ID}:~org:${ORG_ID}`;
    const stored = Object.entries(await runtime.stores.resourceState.getByPrefix("user", userScope, "tasks/"));
    const rows = stored.map(([key, value]) => ({ key, row: value.state as Task }));
    if (rows.length !== 1) failures.push(`e: expected exactly one task in ${USER_ID}'s store, found ${rows.length}`);
    const only = rows[0];
    if (only !== undefined) {
      if (only.row.status !== "completed") failures.push(`e: the task is ${only.row.status}, not completed`);
      if (only.row.goal !== goal) failures.push(`e: the task's goal is ${JSON.stringify(only.row.goal)}`);
      if (only.row.assignee !== delegate.id) failures.push(`e: the task names ${only.row.assignee}, not ${delegate.id}`);
      if (partition === undefined || only.key !== `tasks/${encodeUserSegment(partition)}/${only.row.id}`) {
        failures.push(`e: the task is kept at ${only.key}, not at the conversation's partition ${partition}`);
      }
    }
    const atOrg = await runtime.stores.resourceState.getByPrefix("org", ORG_ID, "");
    if (Object.keys(atOrg).some((key) => key.includes(only?.row.id ?? "\u0000"))) failures.push("e: the task is also kept at org scope");

    // ---- 0, again: no file names where the work is kept ----------------------
    if (partition !== undefined) {
      for (const path of treeFiles(TREE)) {
        if (readFileSync(path, "utf8").includes(partition)) failures.push(`0: ${path} names the conversation's partition "${partition}"`);
      }
    }

    return {
      failures,
      evidence:
        `one tree at ${TREE}: ${filer.id} (flow ${filerKind}) names ${delegate.id} (flow ${delegateKind}) as its ` +
        `delegate, and no file declares a board. Its conversation listed ${delegate.id} as taking ${entry?.takes}, ` +
        `dispatched one task through its own createTask_tasks, and the board handed it to ${delegate.id}'s task entry, ` +
        `which ran it: proved by ${OUTBOX}, a side effect the board could not have produced by reporting. The task ` +
        `reads ${only?.row.status} out of ${USER_ID}'s own store at ${only?.key}, the conversation's partition, ` +
        `which no file names, and nothing of it is at org scope.`
    };
  } finally {
    await state.dispose();
  }
});
