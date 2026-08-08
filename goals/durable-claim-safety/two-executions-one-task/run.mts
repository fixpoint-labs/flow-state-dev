/**
 * Goal check — two concurrent executions over one durable task board cannot
 * both start a task, and a worker cannot settle a task it does not hold.
 *
 * Real path, no mocking, out of CI. Real SQLite on a real file, real
 * `runAction` executions (separate requests over one session, exactly as two
 * concurrent HTTP requests are), a real durable `taskBoard`, and the verdict
 * read back through a **reopened** database connection. Nothing about the
 * concurrency is simulated: the executions are real, their per-execution
 * resource caches are real, and the contention is on one row.
 *
 * Two properties, because the milestone needs both and each hides the other's
 * failure:
 *
 *   1. **Exclusivity** — two executions racing for one task, exactly one wins.
 *      Without this a fix could fence settlement while leaving `claim` open,
 *      which still runs the same task twice and still satisfies "they cannot
 *      both settle".
 *   2. **Binding** — a worker holding task X presents its ownership token
 *      against task Y. The two tasks sit on the same attempt number, so a
 *      token that is only a counter is satisfied by the wrong task. This is
 *      the property that fails today.
 *
 * Held out: both task ids and both output payloads come from
 * fixtures/input.json. Nothing is asserted against a literal — swap any of
 * them and a correct implementation still passes, a broken one still fails.
 *
 * Run: pnpm tsx goals/durable-claim-safety/two-executions-one-task/run.mts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { runAction } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import {
  defineTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskWriteOutcome,
} from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import {
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides,
  type GoalResult,
} from "../../lib/index.mts";

interface Fixture {
  contendedTask: string;
  otherTask: string;
  holderOutput: string;
  strangerOutput: string;
}

const COLLECTION_ID = "durable-claim-safety";
const SESSION_ID = "goal-session";

// This flow declares no generator intents (goal.md's Model field is n/a);
// clear pinned overrides so the model resolver doesn't throw.
stripIntentOverrides();

type Board = TaskCollectionRef<{ goal: string }, unknown>;

const taskCollection = defineTaskCollection({
  id: COLLECTION_ID,
  scope: "session",
  stateSchema: z.object({ goal: z.string() }),
});

/**
 * The board registers and resolves the durable collection. The scenario drives
 * `claim` / `complete` directly rather than through `drain`: the defect is
 * about which token a write presents, and the drain offers no seam to present
 * a mismatched one.
 */
const board = taskBoard({
  name: COLLECTION_ID,
  collection: taskCollection,
  concurrency: 1,
  workers: handler({
    name: "claim-safety-idle-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => ({ ok: input.goal }),
  }) as Parameters<typeof taskBoard>[0]["workers"],
  onIdle: "complete",
});

/** A promise plus its resolver — the deterministic interleaving primitive. */
interface Gate {
  readonly reached: Promise<void>;
  open(): void;
}
function gate(): Gate {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

/**
 * Await a gate, or fail naming it.
 *
 * Every handoff in this check crosses executions, and `runAction` CAPTURES a
 * body's throw rather than propagating it — so a racer that dies during
 * hydration or inside `claim()` never opens the gate the other side is parked
 * on, and a bare `await` then blocks forever. A goal that hangs produces no
 * verdict at all, and takes any `goal:all` sweep containing it down with it:
 * the one outcome this artifact exists to prevent is the one it would then
 * report least. The budget only has to beat a human's patience, never be tight
 * enough to go flaky on a loaded machine.
 *
 * Deliberately a local copy of the integration suite's helper
 * (`packages/integration-tests/src/scenarios/task-board-durable-claim-safety.test.ts`)
 * rather than a shared one — `goals/README.md` puts the bar for a `goals/lib`
 * helper at a *third* consumer, and a test package cannot import from `goals/`.
 */
const GATE_TIMEOUT_MS = 10_000;
async function reach(g: Gate, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      g.reached,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `gate "${what}" was never opened — the other execution did not reach it, ` +
                  `so this scenario never happened`
              )
            ),
          GATE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One execution: a flow with a single handler running `body` on the board. */
function execution(name: string, body: (tasks: Board) => Promise<unknown>) {
  return defineFlow({
    kind: `claim-safety-${name}`,
    actions: {
      run: {
        block: handler({
          name: `claim-safety-${name}-body`,
          inputSchema: z.unknown(),
          uses: [board.capability],
          execute: async (_input, ctx) => {
            const accessor = (ctx.cap as Record<string, { tasks(): Promise<Board> }>)[
              COLLECTION_ID
            ]!;
            return (await body(await accessor.tasks())) ?? null;
          },
        }),
      },
    },
  })({ id: "default" });
}

await runGoal(async (): Promise<GoalResult> => {
  const fixture = loadFixture<Fixture>(import.meta.url);
  const failures: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-claim-safety-"));
  const dbFile = join(dir, "goal.db");
  let stores = createSQLiteStores({ filename: dbFile });

  /** Launch one real execution over the shared SQLite stores and session. */
  const run = async (name: string, body: (tasks: Board) => Promise<unknown>) => {
    const flow = execution(name, body);
    const result = await runAction({
      flow: flow as never,
      actionName: "run",
      input: {},
      userId: "goal-user",
      sessionId: SESSION_ID,
      stores,
      runtimeConfig: { logger: silentLogger } as never,
    });
    // `output` rides the runAction result, not the persisted RequestRecord —
    // that type carries items but no output field.
    const record = await stores.request.get(result.requestId!);
    if (record?.status !== "completed") {
      failures.push(
        `execution "${name}" ended "${record?.status}" rather than completing — the scenario did not run`
      );
    }
    return { status: record?.status, output: result.output };
  };

  try {
    await run("seed", async (tasks) => {
      await tasks.addTasks(
        [fixture.contendedTask, fixture.otherTask].map((id) => ({
          id,
          goal: id,
          input: { goal: id },
        }))
      );
      return "seeded";
    });

    // --- Property 1: exclusivity. Two executions race for the contended task.
    //
    // Both are launched, and both reach the barrier, before either claims.
    // Building the second lazily would turn the race into a sequence, which a
    // broken implementation also survives.
    const bothReady = gate();
    let arrived = 0;
    const arrive = () => {
      if (++arrived === 2) bothReady.open();
    };
    // Opened once BOTH racers have decided their claim, so the stranger runs
    // against a board whose contention has settled — and so a run where nobody
    // wins reports that failure instead of hanging.
    const claimsDecided = gate();
    let decided = 0;
    const decide = () => {
      if (++decided === 2) claimsDecided.open();
    };
    const strangerDone = gate();

    // Launched, NOT awaited: the winner deliberately parks holding its claim
    // until the stranger has made its attempt, so awaiting here would deadlock.
    const racerRuns = ["racer-a", "racer-b"].map((name) =>
      run(name, async (tasks) => {
        arrive();
        await reach(bothReady, "both racers arrived at the barrier");
        // The `status` clause is NOT redundant with narrowing to one id: a
        // custom `eligibility` REPLACES the substrate's default (pending +
        // deps satisfied), and readiness is what the claim's re-check inside
        // the atomic write consults to decide it lost the race. Narrow by id
        // alone and every racer's re-check passes on an already-claimed task,
        // so the board hands the same task out twice — measured, not assumed.
        //
        // `decide()` runs in a `finally`: a claim that THROWS still has to
        // release the barrier, or the run below it waits on a decision that
        // will never come and the whole check hangs instead of failing.
        let mine: Task<{ goal: string }, unknown> | null;
        try {
          mine = await tasks.claim(name, {
            eligibility: (t) => t.id === fixture.contendedTask && t.status === "pending",
          });
        } finally {
          decide();
        }
        if (mine === null) return { claimed: false };
        // The winner KEEPS HOLDING its task across the stranger's write. A
        // task already settled would be refused by the terminal guard, which
        // would prove nothing about ownership.
        await reach(strangerDone, "the stranger finished its write");
        return {
          claimed: true,
          attempt: mine.attempts,
          outcome: await tasks.complete(
            fixture.contendedTask,
            fixture.holderOutput,
            { ifAllowed: true, expectAttempt: mine.attempts }
          ),
        };
      })
    );

    // --- Property 2: binding. A worker holding one task presents its token
    // against the other.
    //
    // The stranger starts only once the contended task is claimed, so its view
    // of the board is current — the ordinary shape of a worker joining a board
    // whose siblings are already running. See goal.md's anti-game note: on the
    // opposite ordering the write is refused by an unrelated guard arm and the
    // check would pass without proving anything.
    await reach(claimsDecided, "both racers decided their claim");

    const stranger = await run("stranger", async (tasks) => {
      const mine = await tasks.claim("stranger", {
        eligibility: (t) => t.id === fixture.otherTask && t.status === "pending",
      });
      return {
        heldAttempt: mine!.attempts,
        targetAttempt: tasks.get(fixture.contendedTask)!.attempts,
        outcome: await tasks.complete(
          fixture.contendedTask,
          fixture.strangerOutput,
          { ifAllowed: true, expectAttempt: mine!.attempts }
        ),
      };
    });
    strangerDone.open();
    const racers = await Promise.all(racerRuns);

    const winners = racers
      .map((r) => r.output as { claimed?: boolean; attempt?: number; outcome?: TaskWriteOutcome })
      .filter((o) => o?.claimed === true);
    if (winners.length !== 1) {
      failures.push(
        `expected exactly one execution to claim "${fixture.contendedTask}", ${winners.length} did — ` +
          `two executions both started the same task, so it runs twice`
      );
    }

    const s = stranger.output as {
      heldAttempt: number;
      targetAttempt: number;
      outcome: TaskWriteOutcome;
    };

    // The precondition that makes this a real collision rather than an accident
    // of ordering. If the two tasks sat on different attempts the counter alone
    // would refuse the write and this check would prove nothing.
    if (s.heldAttempt !== s.targetAttempt) {
      failures.push(
        `setup did not produce a token collision: the stranger holds attempt ${s.heldAttempt} ` +
          `while "${fixture.contendedTask}" is on attempt ${s.targetAttempt} — the check cannot discriminate`
      );
    }
    if (s.outcome.outcome !== "declined") {
      failures.push(
        `the stranger holds "${fixture.otherTask}" but its write to "${fixture.contendedTask}" was ` +
          `"${s.outcome.outcome}" — a token issued for one task settled another`
      );
    }

    // --- The durable verdict, through a REOPENED connection. A per-execution
    // cache can show a correct-looking task while the persisted row disagrees,
    // and the persisted row is what the next execution reads.
    stores.close();
    stores = createSQLiteStores({ filename: dbFile });
    const readBack = async (id: string): Promise<Task | undefined> => {
      const row = await stores.resourceState.get(
        "session",
        SESSION_ID,
        `${COLLECTION_ID}/${id}`
      );
      return row?.state as Task | undefined;
    };
    const contended = await readBack(fixture.contendedTask);
    const other = await readBack(fixture.otherTask);
    stores.close();

    if (contended === undefined) {
      return { failures: [...failures, "no durable row for the contended task"], evidence: "" };
    }
    // Settled exactly once, and by the worker that actually held it.
    if (contended.output !== fixture.holderOutput) {
      failures.push(
        `"${fixture.contendedTask}" carries output ${JSON.stringify(contended.output)}, expected the ` +
          `holder's ${JSON.stringify(fixture.holderOutput)} — the settlement that landed was not its owner's`
      );
    }
    if (contended.status !== "completed") {
      failures.push(
        `"${fixture.contendedTask}" is "${contended.status}" after its holder settled it, expected "completed"`
      );
    }
    // The stranger's own task is untouched by any of this — a fix that fenced
    // by refusing everything would fail here.
    if (other?.status !== "in_progress") {
      failures.push(
        `"${fixture.otherTask}" is "${other?.status}", expected "in_progress" — the stranger's own claim ` +
          `should be unaffected by the refusal of its cross-task write`
      );
    }

    return {
      failures,
      evidence:
        `two concurrent runAction executions over one SQLite-backed durable board: ` +
        `${winners.length} of 2 racers claimed "${fixture.contendedTask}"; a third execution holding ` +
        `"${fixture.otherTask}" at attempt ${s.heldAttempt} presented that token against ` +
        `"${fixture.contendedTask}" at attempt ${s.targetAttempt} and the write was "${s.outcome.outcome}"; ` +
        `the reopened row for "${fixture.contendedTask}" is ${contended.status} carrying ` +
        `${JSON.stringify(contended.output)}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
