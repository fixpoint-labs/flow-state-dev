/**
 * Goal check — a real `goalSeekLoop` with an LLM evaluator judge replans until
 * the goal is REACHED, and terminates on `converged` rather than on the cap.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Shape of the check. The board is seeded with a DELIBERATELY INCOMPLETE plan:
 * the fixture's goal requires two aspects, and the seed creates a task for only
 * ONE of them. A correct LLM judge, reading the settled board against the goal,
 * must therefore ask for a replan once — supplying a task for the missing
 * aspect — and only then converge. So:
 *
 *   drain 1 → covered aspect researched → judge: "replan" (+ 1 task)
 *   drain 2 → missing aspect researched → judge: "done" / converged
 *
 * `maxIterations` is 4, comfortably above the 2 a correct run needs, so landing
 * on the cap means the loop genuinely failed to converge — not that it ran out
 * of budget.
 *
 * The graded signal is the loop's own terminal observability item
 * (`goal-seek-loop-termination`), read for `data.reason` and `data.iterations`
 * exactly as goal.md prescribes — never board-meta.
 *
 * Run: pnpm tsx goals/goal-seek-loop/replans-until-done/run.mts
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { runAction, createInMemoryStores, createModelResolver } from "@flow-state-dev/engine";
import {
  goalSeekLoop,
  taskBoard,
  taskWorkerInputSchema,
  GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
  type TaskBoardHandle,
  type Verdict,
} from "@flow-state-dev/orchestration/task-board";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { join } from "node:path";
import {
  DEFAULT_MODEL,
  KITCHEN_SINK,
  answerText,
  captureIntentOverrides,
  goalAttempts,
  goalSessionId,
  goalTmpDir,
  loadFixture,
  readCapture,
  runFsdev,
  runGoal,
  silentLogger,
  stripIntentOverrides,
} from "../../lib/index.mts";

const MODEL = DEFAULT_MODEL;
const MAX_ITERATIONS = 4;
const SEEDED_TASK_COUNT = 1;
const MAX_ATTEMPTS = goalAttempts(3);

// Held-out fixture. Nothing below hardcodes the subject or either aspect — the
// prompts and the seed read them from here, so swapping in a different
// two-aspect goal must still pass a correct implementation.
const fx = loadFixture<{
  subject: string;
  coveredAspect: string;
  missingAspect: string;
  goal: string;
}>(import.meta.url, "topic.json");

// A bare `createModelResolver()` (no declared intents) rejects a pinned intent
// ladder; clear it so the resolver auto-wires the gateway from the env.
//
// But `stripIntentOverrides()` mutates the PARENT env, and the second arm
// below shells out to kitchen-sink deliberately WITHOUT `--model` so it runs on
// the app's configured ladder. Left alone, that child would inherit the
// stripped env and silently resolve a different model than the caller pinned.
// So snapshot the ladder first and hand it back to that child explicitly.
const CALLER_LADDER = captureIntentOverrides();
stripIntentOverrides();

/** The loop's terminal observability signal — the graded surface. */
interface Termination {
  reason: string;
  iterations: number;
}

/**
 * Read the termination item from an emitted item stream. Same access the
 * primitive's own suite uses: the LAST `goal-seek-loop-termination` component,
 * read off `data`. Deliberately not board-meta (goal.md).
 */
function readTermination(items: readonly unknown[]): Termination | undefined {
  const item = [...items]
    .reverse()
    .find(
      (i) =>
        (i as { type?: string }).type === "component" &&
        (i as { component?: string }).component === GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
    ) as { data?: Termination } | undefined;
  return item?.data;
}

/** Render the settled board for the judge — one line per task with its result. */
function renderBoard(collection: TaskCollectionRef): string {
  const tasks = collection.list();
  if (tasks.length === 0) return "(the board is empty)";
  return tasks
    .map((t) => {
      const task = t as unknown as {
        id: string;
        goal: string;
        status: string;
        output?: unknown;
      };
      const output =
        task.output === undefined || task.output === null
          ? "(no result yet)"
          : typeof task.output === "string"
            ? task.output
            : JSON.stringify(task.output);
      return `- [${task.status}] ${task.goal}\n  result: ${output}`;
    })
    .join("\n");
}

/** The worker: researches one aspect and reports a short finding. */
const researcher = generator({
  name: "gsl-researcher",
  model: MODEL,
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.string(),
  prompt:
    `You are a research assistant working on a briefing about ${fx.subject}. ` +
    `You are given ONE research task. Answer it in two or three factual sentences. ` +
    `Answer only the task you were given — do not cover other aspects.`,
  user: (input: z.infer<typeof taskWorkerInputSchema>) => input.goal,
});

/**
 * The judge generator. It sees the goal and the settled board, and decides
 * whether every required aspect is covered. When something is missing it must
 * supply the follow-up task itself — a `replan` with no tasks and no replanner
 * is a judge error by design (`goalSeekLoop` throws rather than silently
 * re-draining a settled board to the cap).
 */
const judgeGen = generator({
  name: "gsl-judge",
  model: MODEL,
  inputSchema: z.object({ goal: z.string(), board: z.string() }),
  outputSchema: z.object({
    decision: z.enum(["done", "replan"]),
    reason: z.string(),
    // Always present (empty when done) — an always-required array keeps the
    // schema OpenAI strict-compatible (BP-016).
    tasks: z.array(z.object({ goal: z.string() })),
  }),
  prompt:
    "You are evaluating whether a research board has fully satisfied a goal.\n" +
    "You are given the GOAL and the settled BOARD (each task and its result).\n\n" +
    "Decide:\n" +
    '- If EVERY aspect the goal requires is covered by some task result, return decision "done" ' +
    'with an empty tasks array.\n' +
    '- If any required aspect is NOT covered, return decision "replan" AND supply one task per ' +
    "missing aspect in `tasks`, each with a specific, self-contained `goal` string. " +
    'Never return "replan" with an empty tasks array.\n\n' +
    "Judge only against what the goal explicitly requires.",
  user: (input: { goal: string; board: string }) =>
    `GOAL:\n${input.goal}\n\nBOARD:\n${input.board}`,
});

/** Build the board + loop. Fresh per attempt so no state carries between runs. */
function buildLoop(): { board: TaskBoardHandle<any, any, any>; loop: ReturnType<typeof goalSeekLoop> } {
  const board = taskBoard({
    name: "gsl-goal-board",
    collection: { collectionId: "gsl-goal" },
    workers: researcher,
    onIdle: "complete",
  });

  // The deliberately INCOMPLETE plan: one task, covering only one of the two
  // aspects the goal requires. The gap is what a correct judge must notice.
  const seed = handler({
    name: "gsl-seed",
    inputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      await (ctx.cap as any)[board.capability.name].addTasks([
        { id: "covered", goal: `Research ${fx.coveredAspect} of ${fx.subject}.` },
      ]);
    },
  });

  // Render the live board for the judge model.
  //
  // A block / sub-sequencer judge does NOT receive `{ collection, drainResult }`
  // — that shape is built locally for an INLINE-FN judge only. A block judge is
  // handed the raw drain result (the workers' loop decisions, not a board
  // projection) and must read the board from `ctx`, because a live
  // `TaskCollectionRef` is a methods-bearing object that would not survive the
  // structured-clone boundary between steps. See the `judgeStep` comment in
  // `packages/orchestration/src/task-board/goal-seek-loop.ts`. So this is a
  // capability-using handler, not a `.map()`.
  const renderForJudge = handler({
    name: "gsl-render-board",
    inputSchema: z.unknown(),
    outputSchema: z.object({ goal: z.string(), board: z.string() }),
    uses: [board.capability],
    execute: async (_drainResult, ctx) => {
      // `.tasks()` is the accessor that yields the live `TaskCollectionRef` —
      // the capability object itself only carries the write conveniences
      // (`addTasks`), not the query surface (`list`).
      const collection = await (
        ctx.cap as Record<string, { tasks: () => Promise<TaskCollectionRef> }>
      )[board.capability.name].tasks();
      return { goal: fx.goal, board: renderBoard(collection) };
    },
  });

  // A sub-sequencer judge: render the live board for the model, ask it, then
  // shape its answer into a Verdict.
  const judge = sequencer({ name: "gsl-judge-seq", inputSchema: z.any() })
    .step(renderForJudge)
    .step(judgeGen)
    .map((v: { decision: "done" | "replan"; reason: string; tasks: { goal: string }[] }): Verdict =>
      v.decision === "replan" && v.tasks.length > 0
        ? { decision: "replan", reason: v.reason, tasks: v.tasks.map((t) => ({ goal: t.goal })) }
        : { decision: "done", reason: v.decision === "done" ? "converged" : v.reason },
    );

  const loop = goalSeekLoop({
    name: "gsl-goal-loop",
    board,
    seed,
    judge,
    // Well above the 2 drains a correct run needs, so landing on the cap means
    // real non-convergence rather than budget starvation.
    maxIterations: MAX_ITERATIONS,
    // `onError` is left at its default ("skip"), which is the posture a real
    // consumer gets (and what plan-and-execute uses): a judge throw lands as
    // `{ done, reason: "judge-error" }` rather than propagating. That keeps the
    // model-flakiness retry below meaningful — a transient malformed verdict is
    // retried rather than aborting the run.
    //
    // DEBUGGING NOTE: "skip" also swallows the underlying message, so a wiring
    // bug in the judge shows up only as an opaque `judge-error`. Temporarily set
    // `onError: "fail"` to propagate the real error — that is how the board-
    // accessor bug in `renderForJudge` above was found.
  });

  return { board, loop };
}

interface Observation {
  termination: Termination | undefined;
  finalTaskCount: number;
  error?: string;
}

async function runLoopOnce(attempt: number): Promise<Observation> {
  const { loop } = buildLoop();

  const flow = defineFlow({
    kind: "gsl-goal",
    actions: { run: { block: loop as never, inputSchema: z.unknown() } },
  })({ id: "gsl-goal" });

  const res = await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "goal-user",
    sessionId: goalSessionId(`gsl-${attempt}`),
    stores: createInMemoryStores(),
    runtimeConfig: { modelResolver: createModelResolver(), logger: silentLogger } as never,
  });

  if (res.error) return { termination: undefined, finalTaskCount: 0, error: res.error.message };

  // How many tasks the board ended with. The seed creates exactly one, so a
  // larger final count is the structural proof that the REPLAN added work —
  // `iterations >= 2` alone would also be satisfied by a `continue` verdict
  // re-draining a settled board with no new tasks, which is not a replan.
  const taskIds = new Set<string>();
  for (const item of res.items as { type?: string; data?: { task?: { id?: string } } }[]) {
    if (item.type === "component" && item.data?.task?.id) taskIds.add(item.data.task.id);
  }

  return { termination: readTermination(res.items), finalTaskCount: taskIds.size };
}

/**
 * Second arm (goal.md → Signal): drive the RE-EXPRESSED `planAndExecute` — the
 * shipped pattern that now runs on `goalSeekLoop` — through `fsdev run` against
 * a real model, and confirm a multi-step plan completes and synthesizes.
 *
 * The primitive arm above proves the loop converges in isolation; this proves
 * the re-expression did not break the pattern built on it. Asserts the run
 * completed, that it actually went through the task-board substrate (the
 * `task-change` / `task-board-meta` components only that substrate emits), and
 * that a substantive answer came back.
 *
 * No `--model`: the app's own intent ladder decides, which is the realistic
 * path. (`structured-output` deliberately pins GLM 5.2 to reproduce a
 * model-specific coercion bug — a different claim, not this one.)
 */
function runPlanAndExecuteArm(): string[] {
  const capture = join(goalTmpDir("gsl-pae"), "pae.json");
  const exit = runFsdev({
    app: KITCHEN_SINK,
    flow: "chat-agent",
    action: "run",
    input: {
      message: `Write a short briefing on ${fx.subject} covering ${fx.coveredAspect} and ${fx.missingAspect}.`,
      mode: "ask",
      thinkingStyle: "plan-and-execute",
    },
    capture,
    quiet: true,
    silent: true,
    // Restore the caller's intent ladder, which the in-process strip above
    // removed from the parent env. This arm must run on the app's own ladder.
    env: CALLER_LADDER,
  });
  if (exit !== 0) return [`plan-and-execute arm: fsdev run exited ${exit}`];

  const parsed = readCapture(capture);
  const failures: string[] = [];
  if (parsed.result.success !== true) {
    failures.push(
      `plan-and-execute arm: run did not complete: ` +
        `${JSON.stringify(parsed.result.error ?? "unknown")}`,
    );
  }
  const planItems = parsed.items.filter(
    (i) =>
      i.type === "component" &&
      (i.component === "task-change" || i.component === "task-board-meta"),
  );
  if (planItems.length === 0) {
    failures.push(
      "plan-and-execute arm: no task-board items (task-change / task-board-meta) — the " +
        "re-expressed pattern did not run on the task-board substrate",
    );
  }
  const answer = answerText(parsed);
  if (answer.length < 200) {
    failures.push(
      `plan-and-execute arm: answer too short (${answer.length} chars) — the plan did not synthesize`,
    );
  }
  if (failures.length === 0) {
    console.log(
      `plan-and-execute arm: completed with ${planItems.length} task-board items and a ` +
        `${answer.length}-char synthesized answer.`,
    );
  }
  return failures;
}

await runGoal(async () => {
  let last: Observation | undefined;
  let lastNote = "";

  // A real model's judgment is probabilistic: it may converge on drain 1 (never
  // noticing the gap) or return a malformed verdict. Both are MODEL flakiness,
  // not the loop failing, so they retry. A `max-iterations` landing does NOT
  // retry — that is precisely the failure this goal exists to catch.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await runLoopOnce(attempt);
    if (last.error) return { failures: [`loop run failed: ${last.error}`], evidence: "" };

    const term = last.termination;
    if (term === undefined) {
      return {
        failures: [
          "no goal-seek-loop-termination item was emitted — the loop did not reach its terminal block",
        ],
        evidence: "",
      };
    }

    console.log(
      `attempt ${attempt}/${MAX_ATTEMPTS}: reason=${term.reason} iterations=${term.iterations} ` +
        `finalTasks=${last.finalTaskCount}`,
    );

    // The headline failure — NOT retried. Landing on the cap is the exact
    // regression this goal guards against.
    if (term.reason === "max-iterations") {
      return {
        failures: [
          `the loop terminated on "max-iterations" after ${term.iterations} drains — it ran out of ` +
            `budget instead of reaching the goal. maxIterations was ${MAX_ITERATIONS}, well above ` +
            `the 2 drains a correct run needs, so this is genuine non-convergence.`,
        ],
        evidence: "",
      };
    }

    if (term.reason === "converged" && term.iterations >= 2 && last.finalTaskCount > SEEDED_TASK_COUNT) {
      // The primitive converged. Now the second arm goal.md prescribes: the
      // re-expressed planAndExecute built on this loop still completes.
      const paeFailures = runPlanAndExecuteArm();
      if (paeFailures.length > 0) return { failures: paeFailures, evidence: "" };
      return {
        failures: [],
        evidence:
          `a real ${MODEL} evaluator judge drove goalSeekLoop to terminate on "converged" after ` +
          `${term.iterations} drains (cap was ${MAX_ITERATIONS}, so it stopped because the goal was ` +
          `REACHED, not because it ran out of budget). The seeded plan was deliberately incomplete ` +
          `(${SEEDED_TASK_COUNT} task, covering only "${fx.coveredAspect}"); the board ended with ` +
          `${last.finalTaskCount} tasks, so the judge's replan added real work for the missing ` +
          `aspect ("${fx.missingAspect}") rather than merely re-draining a settled board. ` +
          `The re-expressed planAndExecute built on this loop also completed and synthesized ` +
          `through the task-board substrate.` +
          (attempt > 1 ? ` [passed on attempt ${attempt}; earlier: ${lastNote}]` : ""),
      };
    }

    // Everything else is model flakiness worth another attempt.
    lastNote =
      `attempt ${attempt}: reason="${term.reason}", iterations=${term.iterations}, ` +
      `finalTasks=${last.finalTaskCount}`;
    console.error(`(retrying) ${lastNote}`);
  }

  const term = last?.termination;
  const failures: string[] = [];
  if (term === undefined) {
    failures.push("no termination item on the final attempt");
  } else {
    if (term.reason !== "converged") {
      failures.push(
        `terminated on "${term.reason}", expected "converged" — the loop did not stop because the ` +
          `goal was reached. ("judge-error" means the real judge returned a malformed verdict, ` +
          `e.g. a "replan" with no tasks, which goalSeekLoop rejects by design.)`,
      );
    }
    if (term.iterations < 2) {
      failures.push(
        `only ${term.iterations} drain(s) — no replan happened, so the loop never demonstrated it ` +
          `iterates until done. The seeded plan omits "${fx.missingAspect}", so a correct judge ` +
          `should have asked for at least one replan.`,
      );
    }
    if ((last?.finalTaskCount ?? 0) <= SEEDED_TASK_COUNT) {
      failures.push(
        `the board ended with ${last?.finalTaskCount} task(s), no more than the ${SEEDED_TASK_COUNT} ` +
          `seeded — the extra drain(s) re-drained a settled board ("continue") instead of replanning ` +
          `with new work.`,
      );
    }
  }
  return { failures, evidence: "" };
});
