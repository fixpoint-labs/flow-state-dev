/**
 * Goal check — a worker flow that can't do what its roles promise is refused
 * when it is hired, and every worker takes a user's message on `respond` and
 * runs its delegation board on `dispatch`. No model. The legs, what each
 * reads, and the control are in goal.md.
 *
 *   a  six flows with one fault each are each refused by `hireWorkforce`,
 *      with one problem naming the flow, the role and the entry; nothing hired
 *   b  a flow wired only from `workerTaskEntry`, `defineSessionBoard` and a
 *      `respond` door hires as both roles on a real engine; a task it files
 *      starts through `dispatch`, and its ending arrives on `onTaskSettled`
 *   c  the repo's worker flows (agent, coordinator, Shift Manager's devteam)
 *      hire; each has `respond` and no `run`, and each manager `dispatch` and
 *      no `runTaskBoard`, read off the registered copies
 *
 * Run: pnpm tsx goals/workers/roles-checked-at-hire/run.mts
 * Control: GOAL_CONTROL=no-role-check (the role check removed from the hire)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  actingAs,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";
import { openLab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { harnessStub } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = goalTmpDir("roles-checked-at-hire");
const USER_ID = "u_roles_at_hire";
const ORG_ID = "org_roles_at_hire";

const CONTROLS: Record<string, ModulePatch[]> = {
  // The hire with no role check: a flow's roles, and its factories' pieces, go unread.
  "no-role-check": [
    {
      module: "packages/workforce/src/worker-flow-contract.ts",
      from: String.raw`\.\.\.roleProblems\(name, flow, roles\)`,
      to: "...[]"
    }
  ]
};

if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const patches = CONTROLS[CONTROL]!;
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) }
  });
  assertPatched(patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const doorInput = z.object({ message: z.string() });
const turn = handler({ name: "roles-goal-turn", inputSchema: doorInput, execute: async () => "Noted." });
const respond = { inputSchema: doorInput.strict(), block: turn, userMessage: (input: { message: string }) => input.message };

/** A worker flow on `installation`, with the door and whatever `over` adds. */
function flowOn(installation: WorkerInstallation, kind: string, over: Record<string, unknown> = {}): unknown {
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond },
    ...over
  } as never);
}

/** A worker flow carrying the manager kit, its entries picked by `pick`. */
function kitFlow(
  installation: WorkerInstallation,
  kind: string,
  pick: (entries: Record<string, unknown>) => Record<string, unknown>,
  actions: boolean
): unknown {
  const board = defineSessionBoard({ installation, flowKind: kind });
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { respond, ...(actions ? board.actions : {}) },
    internal: { actions: pick(board.entries(turn)) }
  } as never);
}

/**
 * Leg a's six flows. Each has one fault only the role check can refuse, and
 * the words its one problem must hold: the flow, the role, the entry. None
 * lacks `onTaskSettled` while declaring a manager: that is the board's build
 * check, which refuses it before the hire runs.
 */
const BROKEN: Array<{ name: string; fault: string; roles: string[]; build: (i: WorkerInstallation) => unknown; names: string[] }> = [
  {
    name: "takes-nothing",
    fault: "a contributor without `work`",
    roles: ["contributor"],
    build: (i) => flowOn(i, "takes-nothing"),
    names: ['"contributor"', '"work"', "workerTaskEntry"]
  },
  {
    name: "gated-elsewhere",
    fault: "a `work` not built by `workerTaskEntry`",
    roles: ["contributor"],
    build: (i) =>
      flowOn(i, "gated-elsewhere", {
        task: { actions: { work: { block: turn, from: taskLedgers({ name: "feature-board", resolve: async () => undefined as never }) } } }
      }),
    names: ['"contributor"', '"work"', "workerTaskEntry"]
  },
  {
    name: "own-pass",
    fault: "a manager without its marked `dispatch`",
    roles: ["manager"],
    build: (i) => kitFlow(i, "own-pass", (entries) => ({ ...entries, dispatch: { inputSchema: z.object({}).strict(), block: turn } }), true),
    names: ['"manager"', '"dispatch"', "defineSessionBoard"]
  },
  {
    name: "quiet-taker",
    fault: "a `workerTaskEntry` with `contributor` undeclared",
    roles: [],
    build: (i) => flowOn(i, "quiet-taker", { task: { actions: { work: workerTaskEntry({ name: "quiet-taker-work", turn }) } } }),
    names: ['"contributor"', '"work"', "roles"]
  },
  {
    name: "half-kit",
    fault: "the manager kit spread with its `onTaskSettled` but neither `dispatch` nor `roles`",
    roles: [],
    build: (i) => kitFlow(i, "half-kit", (entries) => ({ onTaskSettled: entries.onTaskSettled }), false),
    names: ['"manager"', '"onTaskSettled"', "roles"]
  },
  {
    name: "old-door",
    fault: "a door named `run`",
    roles: [],
    build: (i) => flowOn(i, "old-door", { actions: { run: respond } }),
    names: ['"run"', '"respond"']
  }
];

/** What `hireWorkforce` did with one flow: the copies it returned, or what it threw. */
function hire(entry: { name: string; roles: string[]; build: (i: WorkerInstallation) => unknown }): { copies?: FlowInstance[]; refusal?: string } {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ workerFlows: () => flows as never });
  flows = { [entry.name]: { flow: entry.build(installation), roles: entry.roles } };
  try {
    return { copies: hireWorkforce(installation) };
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error) };
  }
}

/** The names a registered copy declares in each section. */
const namesOf = (copy: FlowInstance) => ({
  actions: Object.keys((copy as { actions?: object }).actions ?? {}),
  internal: Object.keys((copy as { internal?: { actions?: object } }).internal?.actions ?? {})
});

await runGoal(async (failures, tell) => {
  // ---- a. each broken flow is refused at hire, by name -----------------------
  const refused: string[] = [];
  for (const broken of tell.over("a · broken flows", BROKEN)) {
    const { copies, refusal } = hire(broken);
    if (refusal === undefined) {
      failures.push(`a:refused · ${broken.name} (${broken.fault}): hired ${copies?.length ?? 0} copies, nothing refused`);
      continue;
    }
    const problems = refusal.split("\n  - ").slice(1);
    if (problems.length !== 1) {
      failures.push(`a:one-problem · ${broken.name}: ${problems.length} problems: ${refusal}`);
      continue;
    }
    const problem = problems[0]!;
    const missing = [`"${broken.name}"`, ...broken.names].filter((word) => !problem.includes(word));
    if (missing.length > 0) failures.push(`a:names · ${broken.name}: the problem doesn't name ${missing.join(", ")}: ${problem}`);
    else refused.push(broken.name);
  }

  // ---- b. a flow from the factories alone, on a real engine -------------------
  const LEAD = "desk.lead";
  const HAND = "desk.hand";
  const workers: WorkerManifest[] = [
    { id: LEAD, declared: { flow: "desk", delegates: [HAND] }, body: "Files the work." },
    { id: HAND, declared: { flow: "desk" }, body: "Does the work." }
  ];
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  const board = defineSessionBoard({ installation, flowKind: "desk" });
  const desk = defineFlow({
    kind: "desk",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { respond, ...board.actions },
    internal: { actions: board.entries(turn, () => "fixed") },
    task: { actions: { work: workerTaskEntry({ name: "roles-goal-desk-work", turn }) } }
  } as never);
  flows = { desk: { flow: desk, roles: ["contributor", "manager"] } };
  let hired: FlowInstance[] = [];
  try {
    hired = hireWorkforce(installation);
  } catch (error) {
    failures.push(`b:hired · the flow built from the factories was refused: ${error instanceof Error ? error.message : String(error)}`);
  }
  let filedEnded = false;
  if (hired.length > 0) {
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
      const conversation = await open("desk", { workerId: LEAD });
      const goal = `count the chairs ${RUN_STAMP}`;
      const filed = await act("desk", conversation, "createTask_tasks", { goal, assignee: HAND });
      if (filed?.ok !== true) failures.push(`b:filed · the lead's conversation could not file: ${JSON.stringify(filed)}`);
      await untilIdle(runtime.stores);

      // What the engine ran, read from its request store.
      const requests = await runtime.stores.request.list({ sessionId: conversation });
      const ran = (name: string) => requests.filter((r) => r.actionName === name && r.status === "completed");
      tell.over("b · the conversation's requests", requests);
      if (ran("dispatch").length === 0) failures.push(`b:dispatch · no completed \`dispatch\` in the conversation: ${requests.map((r) => `${r.actionName}:${r.status}`).join(", ")}`);
      if (requests.some((r) => r.actionName === "runTaskBoard")) failures.push("b:dispatch · the conversation ran `runTaskBoard`");
      if (ran("onTaskSettled").length === 0) failures.push(`b:settled · the task's ending never arrived on \`onTaskSettled\`: ${requests.map((r) => `${r.actionName}:${r.status}`).join(", ")}`);
      const all = await runtime.stores.request.list({});
      if (!all.some((r) => r.actionName === "work" && r.status === "completed" && r.sessionId !== conversation)) {
        failures.push("b:worked · no completed `work` ran in a task session of its own");
      }
      const rows = Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER_ID}:~org:${ORG_ID}`, "tasks/")).map(
        (value) => value.state as Task
      );
      const row = tell.over("b · the stored tasks", rows).find((r) => r.goal === goal);
      if (row?.status !== "completed") failures.push(`b:completed · the task is ${row?.status ?? "not stored"}, not completed`);
      else filedEnded = true;
    } finally {
      await state.dispose?.();
    }
  }

  // ---- c. the repo's worker flows ---------------------------------------------
  const copies: Array<{ host: string; copy: FlowInstance; manager: boolean }> = [];
  {
    let builtIns: Record<string, unknown> = {};
    const builtInstallation = createWorkerInstallation({ workerFlows: () => builtIns as never });
    builtIns = {
      agent: defineAgentWorkerFlow({ installation: builtInstallation }),
      coordinator: defineCoordinatorFlow({ installation: builtInstallation, routeModel: "roles-goal/route" })
    };
    try {
      const resolved = builtInstallation.workerFlows();
      for (const copy of hireWorkforce(builtInstallation)) {
        // The roster flow is no worker flow; a host with no roles reads as none.
        if (resolved[copy.id] === undefined) continue;
        const roles: readonly string[] = resolved[copy.id]!.roles ?? [];
        copies.push({ host: "built-ins", copy, manager: roles.includes("manager") || roles.includes("coordinator") });
      }
    } catch (error) {
      failures.push(`c:hired · the built-in agent and coordinator were refused: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const root = mkdtempSync(join(tmpdir(), "roles-goal-devteam-"));
  try {
    const lab = await openLab({
      stores: inMemoryStores(),
      harness: harnessStub().slot,
      runTimeoutMs: 30_000,
      workspace: { root, remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      inventory: true,
      logger: silentLogger
    } as never);
    try {
      const resolved = lab.installation.workerFlows();
      const runtime = await lab.state.getRuntime();
      for (const flowName of Object.keys(resolved)) {
        const copy = runtime.registry.get(flowName) as FlowInstance | undefined;
        if (copy === undefined) {
          failures.push(`c:registered · Shift Manager's "${flowName}" is not registered`);
          continue;
        }
        const roles: readonly string[] = resolved[flowName]!.roles ?? [];
        copies.push({ host: "devteam", copy, manager: roles.includes("manager") || roles.includes("coordinator") });
      }
    } finally {
      await lab.dispose();
    }
  } catch (error) {
    failures.push(`c:hired · Shift Manager's devteam host did not open: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const { host, copy, manager } of tell.over("c · registered worker flows", copies)) {
    const { actions, internal } = namesOf(copy);
    if (!actions.includes("respond")) failures.push(`c:respond · ${host} "${copy.id}" has no \`respond\`: ${actions.join(", ")}`);
    if (actions.includes("run")) failures.push(`c:no-run · ${host} "${copy.id}" still has \`run\``);
    if (manager && !internal.includes("dispatch")) failures.push(`c:dispatch · ${host} manager "${copy.id}" has no \`dispatch\``);
    if (internal.includes("runTaskBoard")) failures.push(`c:no-runTaskBoard · ${host} "${copy.id}" still has \`runTaskBoard\``);
  }
  const managers = tell.over("c · managers", copies.filter((c) => c.manager));

  return {
    failures,
    evidence:
      `a: ${refused.length}/${BROKEN.length} broken flows refused at hire, each with one problem naming flow, role and entry (${refused.join(", ")}); ` +
      `b: the factory-built flow hired as contributor and manager, its task ${filedEnded ? "completed" : "did not complete"} through \`dispatch\` and \`onTaskSettled\`; ` +
      `c: ${copies.length} registered worker flows (${copies.map((c) => `${c.host}:${c.copy.id}`).join(", ")}) take \`respond\`, ${managers.length} managers run \`dispatch\``
  };
});
