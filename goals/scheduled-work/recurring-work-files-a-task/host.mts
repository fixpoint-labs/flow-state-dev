/**
 * One process of a Workforce app over a SQLite file, standing at the time
 * `GOAL_NOW` pins. It does the operations `GOAL_OPS` lists, as a person's app
 * and a host's scheduler would, waits until nothing it started is running, and
 * prints what each operation answered on one `__GOAL__<json>` line. `run.mts`
 * grades it.
 *
 * The app: `launch`, a worker that files tasks for its delegate `researcher`.
 * Both turns are deterministic: launch's says "Noted.", researcher's works for
 * `GOAL_WORK_MS` and reports. No model.
 *
 * Operations (JSON array in `GOAL_OPS`):
 *   { op: "save", schedule }       Alice saves a schedule (roster `saveSchedule`)
 *   { op: "delete", key }          Alice removes one (`deleteSchedule`)
 *   { op: "list" }                 Alice's schedules (`listSchedules`)
 *   { op: "fire", key, at? }       the scheduler POSTs the schedule's dispatch, with `at` as its time or none
 *   { op: "settle" }               wait until no request is running
 *   { op: "tasks" }                Alice's tasks with launch (`listTasks_tasks`)
 *   { op: "cancel-newest" }        wait for a second task, then Alice cancels the newest (`updateTask_tasks`, status "cancelled")
 *   { op: "endings" }              the ending requests launch's conversation ran, by task
 */
import "./clock.mts";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver, createFlowState } from "@flow-state-dev/engine";
import { createScheduledTransportAdapter, formatScheduleId } from "@flow-state-dev/scheduled";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  ROSTER_FLOW,
  createWorkerInstallation,
  defineSessionBoard,
  deriveWorkerSessionId,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { actingAs, silentLogger, untilIdle, writeGoalReport } from "../../lib/index.mts";

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`host: ${name} is not set`);
  return value;
};
const DB = env("GOAL_DB");
const ORG = env("GOAL_ORG");
const USER = env("GOAL_USER");
const FILER = env("GOAL_FILER");
const ASSIGNEE = env("GOAL_ASSIGNEE");
const SECRET = "goal-scheduler-secret";
const WORK_MS = Number(process.env.GOAL_WORK_MS ?? "1500");
const OPS = JSON.parse(env("GOAL_OPS")) as Array<Record<string, any>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const doorInput = z.object({ message: z.string() });

// ---- the app ----------------------------------------------------------------
const workers: WorkerManifest[] = [
  { id: FILER, declared: { flow: "launch", delegates: [ASSIGNEE], description: "Runs the launch." }, body: "", skills: [] },
  { id: ASSIGNEE, declared: { flow: "researcher", description: "Finds the numbers." }, body: "", skills: [] }
];
let workerFlows: Record<string, unknown> = {};
const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => workerFlows as never });

const board = defineSessionBoard({ installation, flowKind: "launch" });
const launchTurn = handler({ name: "goal-launch-turn", inputSchema: doorInput, execute: async () => "Noted." });
const launchFlow = defineFlow({
  kind: "launch",
  configSchema: workerConfigSchema(),
  session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
  resources: { ...installation.resources, ...board.resources },
  actions: {
    respond: { inputSchema: doorInput.strict(), block: launchTurn, userMessage: (input: { message: string }) => input.message },
    ...board.actions
  },
  internal: { actions: board.entries(launchTurn) }
} as never);

const researchTurn = handler({
  name: "goal-research-turn",
  inputSchema: doorInput,
  execute: async (input) => {
    await sleep(WORK_MS);
    return `refreshed: ${input.message.slice(0, 80)}`;
  }
});
const researcherFlow = defineFlow({
  kind: "researcher",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { respond: { inputSchema: doorInput, block: researchTurn, userMessage: (input: { message: string }) => input.message } },
  task: { actions: { work: workerTaskEntry({ name: "goal-research-task", turn: researchTurn }) } }
} as never);
workerFlows = { launch: { flow: launchFlow, roles: ["manager"] }, researcher: { flow: researcherFlow, roles: ["contributor"] } };

// No schedule index: the host's own cron POSTs per schedule.
const flows = Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy]));
const scheduler = createBearerSecretPrincipalResolver({ secret: SECRET, principal: { userId: "scheduler", orgId: ORG } });
const state = createFlowState({
  flows,
  stores: { default: { primary: sqliteStores({ filename: DB }) } },
  adapters: [createScheduledTransportAdapter()],
  logger: silentLogger,
  staleSweepIntervalMs: 0,
  resolvePrincipal: (context: any) => {
    if (context.source === "scheduled") return scheduler(context);
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  }
} as never);

// ---- what Alice's app and the scheduler do ----------------------------------
const results: unknown[] = [];
try {
  const runtime = await state.getRuntime();
  const router = (await state.getRouter()) as any;
  const alice = actingAs(router, USER);
  const conversation = await deriveWorkerSessionId({ userId: USER, orgId: ORG, flow: "launch", criteria: { worker: FILER } });
  let rosterSession: string | undefined;
  const roster = async (action: string, input: unknown) => {
    rosterSession ??= await alice.open(ROSTER_FLOW, {});
    return alice.act(ROSTER_FLOW, rosterSession, action, input);
  };
  /** Alice's conversation with the filer, opened at its derived address as her app opens it. */
  const openConversation = async () => {
    const created = await alice.call("POST", ["launch", "sessions"], { userId: USER, sessionId: conversation, state: { workerId: FILER } });
    if (created.status >= 300 && created.status !== 409) throw new Error(`opening Alice's conversation answered ${created.status}: ${created.text}`);
  };
  const tasks = async () => {
    await openConversation();
    const out = await alice.act("launch", conversation, "listTasks_tasks", {});
    if (out?.ok !== true) throw new Error(`listTasks_tasks refused: ${JSON.stringify(out)}`);
    return out.tasks as Array<{ id: string; goal: string; assignee?: string; status: string }>;
  };

  for (const op of OPS) {
    switch (op.op) {
      case "save":
        results.push({ op: "save", out: await roster("saveSchedule", op.schedule) });
        break;
      case "delete":
        results.push({ op: "delete", out: await roster("deleteSchedule", { key: op.key }) });
        break;
      case "list":
        results.push({ op: "list", now: new Date().toISOString(), out: await roster("listSchedules", {}) });
        break;
      case "fire": {
        // As a host's cron does: the shared secret, the schedule's dispatch id, and its time.
        const id = formatScheduleId(ORG, USER, op.key);
        const response = await router.POST(
          new Request(`http://goal/api/flows/${ROSTER_FLOW}/schedules/${encodeURIComponent(id)}/dispatch`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
            body: JSON.stringify(op.at === undefined ? {} : { nominalFireTime: op.at })
          }),
          { params: { path: [ROSTER_FLOW, "schedules", id, "dispatch"] } }
        );
        results.push({ op: "fire", at: op.at ?? null, status: response.status, body: await response.json() });
        break;
      }
      case "settle":
        await untilIdle(runtime.stores);
        results.push({ op: "settle" });
        break;
      case "tasks":
        results.push({ op: "tasks", out: await tasks() });
        break;
      case "cancel-newest": {
        let listed = await tasks();
        for (let i = 0; i < 200 && listed.length < op.count; i += 1) {
          await sleep(25);
          listed = await tasks();
        }
        const newest = listed.find((task) => !(op.before as string[]).includes(task.id));
        if (newest === undefined) throw new Error(`no new task appeared to cancel: ${JSON.stringify(listed)}`);
        const out = await alice.act("launch", conversation, "updateTask_tasks", { id: newest.id, status: "cancelled" });
        results.push({ op: "cancel-newest", taskId: newest.id, statusBefore: newest.status, out });
        break;
      }
      case "endings": {
        const requests = await runtime.stores.request.list({ sessionId: conversation });
        results.push({
          op: "endings",
          out: requests
            .filter((request) => request.actionName === "onTaskSettled")
            .map((request) => ({ taskId: (request.input as { taskId?: string })?.taskId, ending: (request.input as { ending?: string })?.ending, status: request.status }))
        });
        break;
      }
      default:
        throw new Error(`host: unknown op ${JSON.stringify(op)}`);
    }
  }
  // Nothing this process started is left half done when it exits.
  await untilIdle(runtime.stores);
  await writeGoalReport({ now: new Date().toISOString(), results });
} catch (error) {
  await writeGoalReport({ setup: error instanceof Error ? error.stack ?? error.message : String(error), results });
} finally {
  await state.dispose();
}

