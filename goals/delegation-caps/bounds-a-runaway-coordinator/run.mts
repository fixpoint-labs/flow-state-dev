/**
 * Goal check — the over-spawning guard (FIX-931): a real coordinator, planning
 * real work on a real delegation board, is BOUNDED by the board's creation caps
 * and still completes coherently.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * What makes this a goal check rather than a dressed-up unit test:
 *   - The caps are exercised through the SHIPPED delegation surface: a bound
 *     agent-declaring skill installs the board, the model calls `addTask` itself,
 *     and the refusal arrives as the soft error the model actually receives. The
 *     mocked specs prove the mechanism; only this proves that a model driving it
 *     is bounded and can recover.
 *   - Three runs over the IDENTICAL skill, prompt, and request, differing only in
 *     the library's cap options:
 *       A) uncapped — the anti-game control. The workload must naturally exceed
 *          the caps imposed below, or every bound assertion is vacuous.
 *       B) enqueue-capped — the burst is refused mid-plan, and the coordinator
 *          RECOVERS: it drains, then adds more. Refusal alone is not the outcome;
 *          "bounded while still completing" is.
 *       C) total-capped — the board never holds more than the lifetime ceiling,
 *          no matter how many drains happen.
 *   - Every task that did run is proven to be a real worker turn by a held-out
 *     salt that lives only in the agent's prompt (frontmatter, stripped from the
 *     coordinator's skill body) on a line the roster never copies. A coordinator
 *     inventing a board cannot produce it.
 *   - Both caps and the workload come from the fixture, never a literal here.
 *
 * Run: pnpm tsx goals/delegation-caps/bounds-a-runaway-coordinator/run.mts
 */
import {
  DEFAULT_MODEL,
  loadFixture,
  runGoal,
  stripIntentOverrides,
} from "../../lib/index.mts";
import { defineFlow, generator } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import { z } from "zod";

const MODEL = DEFAULT_MODEL;

const fx = loadFixture<{
  workerSalt: string;
  items: string[];
  enqueueCap: number;
  totalCap: number;
}>(import.meta.url);

// A bare `createModelResolver()` (no declared intents) rejects an ambient intent
// ladder; clear it so the resolver auto-wires the gateway from AI_GATEWAY_API_KEY.
stripIntentOverrides();

const SKILL_NAME = "batch-processor";

/**
 * The worker's salt sits on the SECOND line of the agent prompt, deliberately.
 * `agentPurpose` copies the FIRST nonempty line of each agent's prompt into the
 * roster the coordinator reads before any task runs; a salt there would let a
 * coordinator that never ran a worker still emit it. Agent specs live in
 * frontmatter, which `stripFrontmatter` removes from the rendered skill body, so
 * line two is genuinely out of the coordinator's reach.
 */
const skill: InitialSkill = {
  name: SKILL_NAME,
  skillMd: [
    "---",
    "description: Process a batch of item codes, one task per code.",
    "agents:",
    "  processor:",
    "    prompt: |",
    "      You process exactly one item code per task.",
    `      Reply with the item code you were given, a space, then the token ${fx.workerSalt}.`,
    "      Nothing else — no punctuation, no explanation.",
    "---",
    "",
    "When asked to process a batch of item codes, create ONE task per code with addTask",
    "(assignee: processor, goal: the item code), then call runBoard and report every result.",
    "",
    "Your board limits how much work can wait at once, so work in WAVES and keep going until",
    "every code is done:",
    "",
    "1. addTask for the codes that still have no result.",
    "2. If any addTask returns enqueued_task_cap_exceeded, that code was NOT added. Note it as",
    "   still outstanding — it is not an error and not a reason to stop.",
    "3. Call runBoard to drain the tasks that WERE added.",
    "4. Draining frees the queue again. If any codes are still outstanding, go back to step 1",
    "   and add the next wave. Call runBoard again after each wave.",
    "5. Only when every code has a result, report all of them.",
    "",
    "Never end your turn with codes still outstanding after an enqueued_task_cap_exceeded —",
    "drain and add them in the next wave instead.",
    "",
    "The one exception: if addTask returns total_task_cap_exceeded, the board is full for this",
    "run and no further wave will help. Stop adding tasks, run the board if anything is still",
    "queued, and report the results you have.",
  ].join("\n"),
};

const COORDINATOR_PROMPT = [
  "You are a coordinator with a private task board and a team reachable through it.",
  "Follow your active skill's instructions exactly when they apply.",
].join("\n");

const USER_TURN = `Process these item codes and report every result: ${fx.items.join(", ")}.`;

const inputSchema = z.object({ message: z.string() });

/**
 * All three coordinators are identical apart from the library's cap options —
 * the contrast REQUIRES that, so one factory builds them and no drift is
 * possible.
 */
function makeCoordinator(
  name: string,
  caps: { maxTotalTasks?: number | null; maxEnqueuedTasks?: number | null },
) {
  const skills = createSkillsLibrary({
    catalog: {},
    initialSkills: [skill],
    workerModelId: MODEL,
    scope: "session",
    ...caps,
  });
  return generator({
    name,
    model: MODEL,
    prompt: COORDINATOR_PROMPT,
    inputSchema,
    user: (i: { message: string }) => i.message,
    outputSchema: z.string(),
    itemVisibility: { client: true, history: true },
    history: true,
    uses: [skills.with({ active: [SKILL_NAME] } as never)],
    maxIterations: 16,
  });
}

/**
 * One flow per run, not one flow with three actions. Each coordinator carries
 * its own `createSkillsLibrary`, and two libraries in the same flow declare the
 * `skills` resource under different `defineResource` references — a genuine
 * conflict the framework refuses at flow construction. Separate flows keep the
 * three coordinators otherwise identical.
 */
function makeFlow(
  kind: string,
  name: string,
  caps: { maxTotalTasks?: number | null; maxEnqueuedTasks?: number | null },
) {
  return defineFlow({
    kind,
    requireUser: true,
    actions: {
      process: {
        inputSchema,
        block: makeCoordinator(name, caps),
        userMessage: (i: { message: string }) => i.message,
      },
    },
  })({ id: "default" });
}

const flows = {
  // The control: no bound at all on either axis.
  uncapped: makeFlow("delegation-caps-uncapped", "coordinatorUncapped", {
    maxTotalTasks: null,
    maxEnqueuedTasks: null,
  }),
  // The burst bound — refuses, refreshes on drain, so the run can still finish.
  enqueueCapped: makeFlow("delegation-caps-enqueue", "coordinatorEnqueueCapped", {
    maxEnqueuedTasks: fx.enqueueCap,
  }),
  // The lifetime bound — never refunded, so it holds across every drain.
  totalCapped: makeFlow("delegation-caps-total", "coordinatorTotalCapped", {
    maxTotalTasks: fx.totalCap,
    maxEnqueuedTasks: fx.totalCap,
  }),
};

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

type ActionName = keyof typeof flows;

interface StreamItem {
  type?: string;
  component?: string;
  blockName?: string;
  output?: unknown;
  data?: { task?: { id: string; status: string; output?: unknown } };
}

/** What one run produced, read entirely from the emitted item stream. */
interface Observed {
  /** Terminal answer the caller received. */
  answer: string;
  /** Every task id that ever appeared on the board. */
  taskIds: string[];
  /** Final status + output per task. */
  tasks: Map<string, { status: string; output?: unknown }>;
  /** Every `addTask` result, in call order. */
  addResults: Array<{ ok?: boolean; error?: string; taskId?: string }>;
  /** How many times the coordinator drained the board. */
  runBoardCalls: number;
}

async function run(actionName: ActionName): Promise<Observed> {
  const res = await runAction({
    flow: flows[actionName],
    actionName: "process" as never,
    input: { message: USER_TURN },
    userId: "goal-user",
    sessionId: `caps-${actionName}`,
    stores,
    runtimeConfig,
  });
  if (res.error) throw new Error(`${actionName} run failed: ${res.error.message}`);

  const items = res.items as unknown as StreamItem[];
  const tasks = new Map<string, { status: string; output?: unknown }>();
  const taskOrder: string[] = [];
  const addResults: Observed["addResults"] = [];
  let runBoardCalls = 0;

  for (const item of items) {
    if (item.type === "component" && item.component === "task-change" && item.data?.task) {
      const task = item.data.task;
      if (!tasks.has(task.id)) taskOrder.push(task.id);
      // Keyed items upsert — the last snapshot per id is the final state.
      tasks.set(task.id, { status: task.status, output: task.output });
      continue;
    }
    if (item.type === "tool_output" && item.blockName === "addTask") {
      addResults.push((item.output ?? {}) as Observed["addResults"][number]);
      continue;
    }
    if (item.type === "tool_output" && item.blockName === "runBoard") runBoardCalls++;
  }

  return {
    answer: typeof res.output === "string" ? res.output : "",
    taskIds: taskOrder,
    tasks,
    addResults,
    runBoardCalls,
  };
}

/** Soft-error codes seen across a run's `addTask` calls. */
function refusals(observed: Observed, code: string): number {
  return observed.addResults.filter((r) => r.ok === false && r.error === code).length;
}

/** Task ids the coordinator successfully created, in call order. */
function createdIds(observed: Observed): string[] {
  return observed.addResults
    .filter((r) => r.ok === true && typeof r.taskId === "string")
    .map((r) => r.taskId!);
}

/**
 * Every task that reached `completed` must carry the held-out salt in its
 * recorded output. This is what makes the count assertions mean anything: it
 * proves the rows on the board are real worker turns, not a coordinator
 * narrating a board it never used.
 */
function saltedCompletions(observed: Observed): { completed: number; salted: number } {
  let completed = 0;
  let salted = 0;
  for (const state of observed.tasks.values()) {
    if (state.status !== "completed") continue;
    completed++;
    if (String(state.output ?? "").includes(fx.workerSalt)) salted++;
  }
  return { completed, salted };
}

async function runGoalCheck(): Promise<{ failures: string[]; log: string }> {
  const failures: string[] = [];

  // Setup honesty: the caps must actually be able to bind on this workload, and
  // the salt must not be derivable from anything the coordinator is handed.
  if (fx.items.length <= Math.max(fx.enqueueCap, fx.totalCap)) {
    return {
      failures: [
        `setup invalid: ${fx.items.length} items cannot exceed a cap of ` +
          `${Math.max(fx.enqueueCap, fx.totalCap)} — no bound could ever bind`,
      ],
      log: "",
    };
  }
  const coordinatorContext = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (coordinatorContext.includes(fx.workerSalt.toLowerCase())) {
    return {
      failures: ["setup invalid: the worker salt leaked into the coordinator's own context"],
      log: "",
    };
  }

  // --- A) The control. Without this the bounds below prove nothing. ---
  const uncapped = await run("uncapped");
  const bindingCap = Math.max(fx.enqueueCap, fx.totalCap);
  if (uncapped.taskIds.length <= bindingCap) {
    failures.push(
      `ANTI-GAME VOID: the uncapped coordinator created only ${uncapped.taskIds.length} task(s), ` +
        `which is within the caps under test (${bindingCap}). The workload must naturally exceed ` +
        `them or "the board stayed under the cap" is true by accident, not by enforcement.`,
    );
  }

  // --- B) The enqueue bound: refuse, then refresh on drain. ---
  const enqueued = await run("enqueueCapped");
  const enqueueRefusals = refusals(enqueued, "enqueued_task_cap_exceeded");
  if (enqueueRefusals === 0) {
    failures.push(
      `the enqueue-capped run never saw enqueued_task_cap_exceeded across ` +
        `${enqueued.addResults.length} addTask call(s) — the burst bound never fired against a ` +
        `real coordinator`,
    );
  }
  // The bound is checked at creation against the resulting `pending` count, so
  // no single drain window may have created more than the cap's worth in a row.
  const created = createdIds(enqueued);
  let streak = 0;
  let worstStreak = 0;
  for (const result of enqueued.addResults) {
    streak = result.ok === true ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }
  if (worstStreak > fx.enqueueCap) {
    failures.push(
      `the enqueue-capped run created ${worstStreak} tasks in an unbroken run without a refusal, ` +
        `above the cap of ${fx.enqueueCap} — the bound did not hold at creation`,
    );
  }
  // Recovery is the outcome, not the refusal. More tasks must exist than the cap
  // allowed at once, and the board must have been drained more than once.
  if (created.length <= fx.enqueueCap) {
    failures.push(
      `the enqueue-capped run created only ${created.length} task(s) (cap ${fx.enqueueCap}) — it ` +
        `was refused and never recovered, so the bound stopped the work instead of pacing it`,
    );
  }
  if (enqueued.runBoardCalls < 2) {
    failures.push(
      `the enqueue-capped run drained the board ${enqueued.runBoardCalls} time(s) — recovery from ` +
        `the enqueue bound is drain-then-continue, so a single drain means it never refreshed`,
    );
  }
  if (enqueued.answer.trim() === "") {
    failures.push(
      `the enqueue-capped coordinator produced an EMPTY terminal answer — bounded but not ` +
        `completing is a failure of this outcome, not a pass`,
    );
  }

  // --- C) The lifetime bound: never refunded, holds across drains. ---
  const total = await run("totalCapped");
  if (refusals(total, "total_task_cap_exceeded") === 0) {
    failures.push(
      `the total-capped run never saw total_task_cap_exceeded across ` +
        `${total.addResults.length} addTask call(s) — the lifetime ceiling never fired`,
    );
  }
  if (total.taskIds.length > fx.totalCap) {
    failures.push(
      `the total-capped board held ${total.taskIds.length} tasks, above its lifetime ceiling of ` +
        `${fx.totalCap}. This is the guard's whole claim: draining must not refund the budget.`,
    );
  }
  if (total.answer.trim() === "") {
    failures.push(
      `the total-capped coordinator produced an EMPTY terminal answer — it must report what it ` +
        `has rather than stalling at the ceiling`,
    );
  }

  // --- D) The rows on every capped board were real worker turns. ---
  for (const [label, observed] of [
    ["enqueue-capped", enqueued],
    ["total-capped", total],
  ] as const) {
    const { completed, salted } = saltedCompletions(observed);
    if (completed === 0) {
      failures.push(
        `${label}: no task completed, so nothing proves the bounded board still ran real work`,
      );
    } else if (salted !== completed) {
      failures.push(
        `${label}: only ${salted}/${completed} completed tasks carry the held-out worker salt ` +
          `"${fx.workerSalt}" — the board's rows are not all real worker turns`,
      );
    }
  }

  const describe = (label: string, o: Observed) =>
    `${label}: ${o.taskIds.length} task(s) on the board, ${o.addResults.length} addTask call(s) ` +
    `(${refusals(o, "enqueued_task_cap_exceeded")} enqueue-refused, ` +
    `${refusals(o, "total_task_cap_exceeded")} total-refused), ` +
    `${o.runBoardCalls} runBoard call(s), ` +
    `${saltedCompletions(o).salted}/${saltedCompletions(o).completed} completions salted\n` +
    `    answer: ${JSON.stringify(o.answer.slice(0, 200))}`;

  const log = [
    describe(`uncapped (control, must exceed ${bindingCap})`, uncapped),
    describe(`enqueue-capped (cap ${fx.enqueueCap})`, enqueued),
    describe(`total-capped (cap ${fx.totalCap})`, total),
  ].join("\n  ");

  return { failures, log };
}

await runGoal(async () => {
  const { failures, log } = await runGoalCheck();
  if (log !== "") console.log(`  ${log}`);
  return {
    failures,
    evidence:
      `over the identical skill, prompt, and request, an uncapped coordinator created more tasks ` +
      `than either cap under test; the enqueue-capped run was refused mid-plan with ` +
      `enqueued_task_cap_exceeded, never created more than ${fx.enqueueCap} in a row, drained and ` +
      `then kept going, and still answered; the total-capped run was refused with ` +
      `total_task_cap_exceeded and its board never held more than ${fx.totalCap} tasks across every ` +
      `drain, while still reporting what it had. Every completed task on both capped boards carried ` +
      `the held-out worker salt, so the bounded boards ran real worker turns.`,
  };
});
