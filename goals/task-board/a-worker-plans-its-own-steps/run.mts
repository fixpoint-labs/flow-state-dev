/**
 * Goal check, leg a of FIX-2076: a hired agent worker on a real model, handed
 * a task in steps, files each step for itself, and its task's own request
 * works them in order, each seeing the one before, with no session of its own
 * per step and no task handed to anyone; then it answers once, and that answer
 * is the task's result. The tree, the legs and what each must fail are in
 * goal.md.
 *
 * Run: pnpm tsx goals/task-board/a-worker-plans-its-own-steps/run.mts
 * Legs: GOAL_LEGS=a1,a2 (default: both)
 * Control: GOAL_CONTROL=no-plan (today's main: no plan, a step for itself is a task session of itself)
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createFlowState, createModelResolver } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createWorkerInstallation, defineAgentWorkerFlow, defineSessionBoard, hireWorkforce, sessionIdOfFiling, workerConfigSchema } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  gatewayModel,
  goalAttempts,
  goalModel,
  goalTmpDir,
  actingAs,
  keysServing,
  loadFixture,
  modulePatchEnv,
  runGoal,
  silentLogger,
  type ModulePatch
} from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const USER_ID = "u_plans_its_steps";
const ORG_ID = "org_plans_its_steps";
const SCRATCH = goalTmpDir("a-worker-plans-its-own-steps");
const MODEL = gatewayModel(goalModel());
const WRITER = "crew.writer";
const DESK = "crew.desk";
/** The ledger a worker's steps sit on, read by an app the way it reads `tasks`. */
const PLAN_LEDGER = "plan";
const QUIET_BUDGET_MS = 300_000;
/** Tries per leg when the model files fewer steps than the brief has (`GOAL_ATTEMPTS` overrides). */
const ATTEMPTS = goalAttempts();

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, { patches: ModulePatch[]; assertions: string[] }> = {
  // Today's main: the agent's turn runs without its plan, and a filing that
  // names the worker is a task like any other, handed to a session of itself.
  "no-plan": {
    // `a1:no-child-session` goes red with it only when the model, planless, files for itself;
    // since 2026-10-24 it mostly answers in one turn instead (4 of 4 runs), so it isn't required.
    assertions: ["a1:steps-in-task-session"],
    patches: [
      {
        module: "packages/workforce/src/agent-worker-flow.ts",
        // The plan's second source (`answerAgain`, FIX-2159) rides along; the control drops both.
        from: String.raw`const run = board !== undefined \? board\.planned\(answeredRun, answerAgain\) : answeredRun;`,
        to: "const run = answeredRun;"
      },
      {
        module: "packages/workforce/src/conversation-board/board.ts",
        from: String.raw`if \(self !== undefined && init\.assignee === self\) throw stepFromItsOwnTurn\(self\);`,
        to: ""
      }
    ]
  }
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, mark) }
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const legs = new Set((process.env.GOAL_LEGS ?? "a1,a2").split(",").map((s) => s.trim()).filter(Boolean));
const say = (s: string) => console.error(`[plans-its-steps ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown) => JSON.stringify(value)?.slice(0, 600);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value) ?? "");

const { subjects } = loadFixture<{ subjects: string[] }>(import.meta.url, "briefs.json");

/** A brief in `count` steps about a subject picked at run time; the first step invents a codename only it holds. */
function brief(count: 2 | 3): { goal: string; subject: string } {
  const subject = subjects[randomInt(subjects.length)]!;
  const steps = [
    "1. Outline: invent a two-word codename for the product, never used before, and state it on its own line as `CODENAME: <two words>`, then a three-point outline.",
    count === 3
      ? "2. Draft: from the outline, write a one-paragraph announcement that uses the codename."
      : "2. Write: from the outline, write a one-sentence announcement that uses the codename.",
    ...(count === 3 ? ["3. Tighten: cut the draft to one or two sentences that keep the codename."] : [])
  ];
  return { subject, goal: `Write a short product announcement for ${subject}, in ${count} steps:\n${steps.join("\n")}` };
}

const tree = await readWorkforce(TREE);
if (tree.errors.length > 0) throw new Error(`the tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}`);

function startHost(db: string) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows as never });
  const doorInput = z.object({ message: z.string() });
  const deskBoard = defineSessionBoard({ installation, flowKind: "desk" });
  const deskTurn = handler({ name: "plans-its-steps-desk-turn", inputSchema: doorInput, execute: async () => "Noted." });
  const desk = defineFlow({
    kind: "desk",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(deskBoard.sessionStateShape), serverOwned: [...deskBoard.serverOwned] },
    resources: { ...installation.resources, ...deskBoard.resources },
    actions: {
      respond: { inputSchema: doorInput.strict(), block: deskTurn, userMessage: (input: { message: string }) => input.message },
      ...deskBoard.actions
    },
    internal: { actions: deskBoard.entries(deskTurn) }
  } as never);
  flows = { agent: defineAgentWorkerFlow({ installation }), desk: { flow: desk, roles: ["manager"] } };

  const real = createModelResolver() as unknown as (id: string, block?: string) => unknown;
  const modelResolver = Object.assign((id: string, block?: string) => real(id === "goal/real" ? MODEL : id, block), {
    resolveId: (id: string) => (id === "goal/real" ? MODEL : id)
  });
  return createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename: db }) } },
    logger: silentLogger,
    modelResolver,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    }
  } as never);
}

type Host = ReturnType<typeof startHost>;
type Row = Task & { partition: string };

async function storeOf(host: Host) {
  const stores = (await host.getRuntime()).stores as any;
  const scope = `${USER_ID}:~org:${ORG_ID}`;
  const read = async (prefix: string): Promise<Row[]> =>
    Object.entries(await stores.resourceState.getByPrefix("user", scope, prefix))
      .map(([key, value]: [string, any]) => ({ ...(value.state as Task), partition: key.split("/")[1]! }))
      .sort((a, b) => a.createdAt - b.createdAt);
  return {
    tasks: () => read("tasks/"),
    steps: () => read("plan/"),
    requests: async (sessionId: string): Promise<any[]> =>
      ((await stores.request.list({ sessionId })) as any[]).sort((a, b) => a.createdAt - b.createdAt),
    running: async (): Promise<number> => (await stores.request.list({ status: "in_progress", orderBy: "none", limit: 1 })).length
  };
}

async function quiet(host: Host): Promise<boolean> {
  const store = await storeOf(host);
  for (const deadline = Date.now() + QUIET_BUDGET_MS; Date.now() < deadline; await sleep(250)) {
    if ((await store.running()) === 0) {
      await sleep(2_000);
      if ((await store.running()) === 0) return true;
    }
  }
  return false;
}

await runGoal(async (failures, tell) => {
  const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  if (key === undefined) return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };
  const db = join(SCRATCH, `${RUN_STAMP}.sqlite`);
  say(`store ${db}; model ${MODEL}; legs ${[...legs].join(", ")}`);
  const host = startHost(db);
  const notes: string[] = [];
  try {
    const http = actingAs((await host.getRouter()) as any, USER_ID);
    const conv = await http.open("desk", { workerId: DESK });

    /** Every task the person filed from the desk: the only rows the conversation ledger may hold. */
    const deskTasks = new Set<string>();
    for (const leg of ["a1", "a2"] as const) {
      if (!legs.has(leg)) continue;
      const count = leg === "a1" ? 3 : 2;
      for (let attempt = 1; ; attempt += 1) {
        const legFailures: string[] = [];
        const { goal, subject } = brief(count);
        say(`${leg} attempt ${attempt}: ${count} steps about ${subject}`);
        const store = await storeOf(host);
        const stepsBefore = new Set((await store.steps()).map((row) => row.id));
        const filed = await http.act("desk", conv, "createTask_tasks", { goal, assignee: WRITER });
        if (filed?.ok !== true) {
          failures.push(`${leg}:filed — the desk's filing for ${WRITER} was refused: ${show(filed)}`);
          break;
        }
        const taskId = filed.taskId as string;
        deskTasks.add(taskId);
        if (!(await quiet(host))) legFailures.push(`${leg}:quiet — the run didn't settle in ${QUIET_BUDGET_MS} ms`);

        const tasks = await store.tasks();
        const task = tasks.find((row) => row.id === taskId);
        const taskSession = (task as { run?: { sessionId?: string } } | undefined)?.run?.sessionId;
        const steps = (await store.steps()).filter((row) => !stepsBefore.has(row.id));
        tell.over(`${leg} · the steps filed`, steps);

        // In the task's own session, all the worker's, all ended completed.
        const own = taskSession === undefined ? undefined : encodeUserSegment(`${taskSession}~`);
        const misplaced = steps.filter((row) => row.status !== "completed" || row.assignee !== WRITER || own === undefined || !row.partition.startsWith(own));
        if (steps.length !== count || misplaced.length > 0) {
          legFailures.push(
            `${leg}:steps-in-task-session — wanted ${count} steps for ${WRITER}, completed, in its task session ${taskSession}; read ${show(steps.map((row) => [row.goal.slice(0, 40), row.status, row.assignee, row.partition.slice(0, 30)]))}`
          );
        }
        // Each started after the one before it ended.
        for (let i = 1; i < steps.length; i += 1) {
          if ((steps[i]!.startedAt ?? 0) < (steps[i - 1]!.completedAt ?? Number.POSITIVE_INFINITY)) {
            legFailures.push(`${leg}:in-order — step ${i + 1} started before step ${i} ended`);
          }
        }
        // The codename only the first step invented, carried by every later step and the result.
        const codename = /CODENAME:\s*\**\s*([A-Za-z][A-Za-z-]*\s+[A-Za-z][A-Za-z-]*)/i.exec(text(steps[0]?.output))?.[1]?.trim();
        const carries = (value: unknown) => codename !== undefined && text(value).toLowerCase().includes(codename.toLowerCase());
        if (codename === undefined || steps.slice(1).some((row) => !carries(row.output))) {
          legFailures.push(`${leg}:carries-forward — wanted step 1's codename in every later step's output; codename ${show(codename)}, outputs ${show(steps.map((row) => text(row.output).slice(0, 160)))}`);
        }
        // No task handed to anyone: the person's tasks are the only rows on the conversation ledger.
        const delegated = tasks.filter((row) => !deskTasks.has(row.id));
        if (delegated.length !== 0) {
          legFailures.push(`${leg}:no-child-session — wanted no row handed to a session but the person's tasks; read ${show(delegated.map((row) => [row.goal.slice(0, 40), row.assignee, row.status]))}`);
        }
        // What the person's app reads (delegating-work.md, "Working in steps"): a worker with no
        // delegate has no delegation board, so its `<tool>_tasks` actions answer
        // `no_delegation_board`, and its steps are read from the `plan` ledger over the router.
        if (taskSession !== undefined) {
          const listed = await http.act("agent", taskSession, "listTasks_tasks", {});
          if (listed?.ok !== false || listed?.error !== "no_delegation_board" || Object.keys(listed).length !== 2) {
            legFailures.push(`${leg}:listed — wanted the task session's listTasks_tasks to answer { ok: false, error: "no_delegation_board" }; read ${show(listed)}`);
          }
          const read = await http.call("GET", ["sessions", taskSession, "resources", PLAN_LEDGER], undefined, "?limit=200");
          const page = read.status === 200 ? (JSON.parse(read.text) as { items?: Array<{ topic: string; clientData?: { id?: string; assignee?: string } }>; nextCursor?: string }) : undefined;
          // The read covers every session this person filed from; keep this task session's rows.
          const planned = tell.over(
            `${leg} · the plan ledger, read over the router`,
            (page?.items ?? []).filter((row) => sessionIdOfFiling(decodeURIComponent(row.topic.split("/")[0]!)) === taskSession)
          );
          const plannedIds = new Set(planned.map((row) => row.clientData?.id));
          const exact = plannedIds.size === planned.length && planned.length === steps.length && steps.every((row) => plannedIds.has(row.id));
          if (page === undefined || page.nextCursor !== undefined || planned.length === 0 || !exact || planned.some((row) => row.clientData?.assignee !== WRITER)) {
            legFailures.push(
              `${leg}:listed — wanted the task session's plan ledger to list exactly its new steps, each assigned to ${WRITER}; read ${read.status} ${show(planned.map((row) => [row.clientData?.id, row.clientData?.assignee]))}, filed ${show(steps.map((row) => row.id))}`
            );
          }
        }
        // One answer, from the turn that saw every step end, as the task's result.
        if (task?.status !== "completed" || typeof task.output !== "string" || !carries(task.output)) {
          legFailures.push(`${leg}:result-is-the-answer — wanted the task completed with one answer naming the codename; it is ${task?.status ?? "missing"}, output ${show(task?.output)}`);
        }
        const requests = taskSession === undefined ? [] : await store.requests(taskSession);
        notes.push(
          `${leg} attempt ${attempt}: task ${task?.status}; ${steps.length} steps ${show(steps.map((row) => row.status))}; codename ${show(codename)}; requests in its session ${show(requests.map((r) => r.actionName))}; result ${show(text(task?.output).slice(0, 200))}`
        );
        // The model filing fewer steps than the brief has is the model's call, not the
        // mechanism: every step it did file ran right. Only that case is tried again.
        const underFiled =
          steps.length > 0 &&
          steps.length < count &&
          misplaced.length === 0 &&
          legFailures.every((f) => f.startsWith(`${leg}:steps-in-task-session `));
        if (underFiled && attempt < ATTEMPTS) {
          say(`${leg} attempt ${attempt}: the model filed ${steps.length} of ${count} steps; trying again`);
          continue;
        }
        failures.push(...legFailures);
        break;
      }
    }
  } finally {
    await host.dispose();
  }
  for (const note of notes) say(note);
  if (control !== undefined) {
    for (const assertion of control.assertions) {
      if (!legs.has(assertion.split(":")[0]!)) continue;
      const named = failures.some((f) => f.startsWith(`${assertion} `));
      failures.unshift(named ? `control ${CONTROL}: ${assertion} failed, as it must` : `control ${CONTROL}: ${assertion} did NOT fail, so the check can't see what the control removes`);
    }
  }
  return { failures, evidence: `${MODEL}; ${notes.join(" | ")}` };
});
