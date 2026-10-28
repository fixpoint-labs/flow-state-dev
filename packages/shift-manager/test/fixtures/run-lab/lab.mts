/**
 * The run-lab: a Lab whose lead files tasks on its own conversation's board
 * for workers whose scripted coding runs hold until they are stopped. The
 * input tree for `goals/shift-manager/it-shows-and-stops-a-task-run`, and the
 * Lab Shift Manager's task screen tests open in CI.
 *
 * The tree is one team: a coordinator (`desk`), a lead whose `delegates:`
 * names the three workers it files for (which is what gives its conversation
 * the task tools and actions), and those three, read off each `WORKER.md`:
 * two on one shared flow, and one on a flow of its own. No worker, flow or
 * board is named in this file.
 *
 * Every flow is registered once and runs the installation's workers: a run's
 * session names the worker whose flow it runs on. Each task the lead files
 * runs in a task session of its own, on its worker's flow, through
 * Workforce's task entry (`workerTaskEntry`).
 *
 * At boot, after the inventory, the Lab opens one conversation with the lead
 * and files its tasks there through the conversation's own `createTask_tasks`:
 *
 * - one **held** task for each worker named first on its flow: its run
 *   narrates a step about every second and holds until it is aborted (or
 *   `holdMs` passes);
 * - two **short** tasks for the other worker on the shared flow, which run
 *   two steps each and finish;
 * - with `asking`, one **asking** task for the worker on a flow of its own,
 *   whose run opens and then waits on a user's approval. With `holdAsk`, it
 *   asks only once `releaseAsk()` is called, so a screen can be open first;
 * - one **waiting** task, filed last, which depends on the first held task,
 *   so nothing claims it while that task holds.
 *
 * Every run opens as a coding harness does: a message, a reasoning item, and
 * one tool call with its result, each stamped with the task the way the
 * framework's own emit sites stamp theirs, so the Session draws each kind of
 * item a harness run stores.
 *
 * Every run emits a keyed progress snapshot as it starts and again as it
 * finishes, so a finished run's session stores two versions of one snapshot
 * and a screen must draw only the latest.
 *
 * The worker on a flow of its own records a plan and one file operation under
 * its own request id, in the collections a recording harness declares. The
 * shared flow declares none, so its runs record none.
 *
 * No model. The "harness" is the scripted run below, the turn each task
 * entry runs.
 */
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { harnessConversationNamespace, type BlockContext, type FlowInstance } from "@flow-state-dev/core/types";
import {
  OBSERVED_FILE_OPS,
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  observedFileOpsCollection,
  observedPlanCollection,
  observedPlanListCollection,
} from "@flow-state-dev/claude-code/sdk";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  COORDINATOR_FLOW,
  createWorkerInstallation,
  defineCoordinatorFlow,
  defineSessionBoard,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  workerConfigSchema,
  workerTaskEntry,
  type InventoryActionRequest,
  MESSAGE_RECEIVED_ENTRY,
  messageReceivedEntry,
  workerMessagesResources,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { hearingDoor } from "./hearing-door.mts";

/** The tree this Lab reads. */
const RUN_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");
/** The one user this Lab runs as. */
export const RUN_LAB_USER_ID = "u_run_lab";
/** The conversation with the lead the tasks are filed on. */
const RUN_LAB_LEAD_SESSION = "s_run_lab_lead";
/** The flow the inventory's worker rows are written from: the Lab's own, carrying the writer. */
const INVENTORY_WRITER_FLOW = "inventory-writer";
/**
 * The model the coordinator's best-fit call would run on. `desk` routes to
 * everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:openai/gpt-5.4-mini";

/** How often a held run narrates a step. */
const STEP_MS = 1_000;
/** The keyed progress snapshot every run emits as it starts and again as it finishes. */
const PROGRESS_COMPONENT = "run-lab-progress";
const PROGRESS_KEY = "progress";

/** What an asking run asks a user to approve. */
export const RUN_LAB_ASK = "Write the audit note?";

/**
 * What a task asks its scripted run to do, filed as the task's `input`; `ask`:
 * suspend on a user's approval of this, after the opening; `holdAsk`: only
 * once the Lab's `releaseAsk()` is called.
 */
export type RunScript = { steps?: number; holdMs?: number; ask?: string; holdAsk?: boolean };

/** The open Lab's ask gate: a `holdAsk` run asks once it resolves. One Lab is open at a time. */
let askGate: { opened: Promise<void>; open(): void } = gate();

function gate(): { opened: Promise<void>; open(): void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

type Upsertable = { upsert(key: string, state: Record<string, unknown>): Promise<unknown> };

/**
 * The script a task carries, read off the turn's message: Workforce's task
 * entry hands the turn the task as filed, its `input` last, as JSON under an
 * `Input:` line. A task filed with no input runs the default script.
 */
function scriptOf(message: string): RunScript {
  const at = message.lastIndexOf("Input:\n");
  return at < 0 ? {} : (JSON.parse(message.slice(at + "Input:\n".length)) as RunScript);
}

/**
 * What a coding harness stores as it starts: its reasoning, then one tool call
 * and its result. Written as whole items through `ctx.response.emit`, the way a
 * harness adapter writes them, and stamped with the run's task and provenance
 * the way the framework's own emit sites stamp theirs.
 */
async function emitHarnessOpening(ctx: BlockContext): Promise<void> {
  const identity = (ctx as { _blockIdentity?: { taskId?: string; blockInstanceId?: string } })._blockIdentity;
  const base = (kind: string) => ({
    id: `item_${kind}_${ctx.request.identity.id}`,
    requestId: ctx.request.identity.id,
    itemIndex: ctx.response.getItemCount(),
    provenance: { blockName: "run-lab-scripted-run", blockInstanceId: identity?.blockInstanceId ?? "run-lab-scripted-run", phase: "main" as const },
    ts: Date.now(),
    itemVisibility: { client: true, history: true },
    ...(identity?.taskId !== undefined ? { taskId: identity.taskId } : {}),
  });
  const reasoning = { ...base("reasoning"), type: "reasoning" as const, summary: [{ type: "reasoning_text" as const, text: "The task names one note. Read it before writing." }] };
  await ctx.response.emit({ type: "item.added", item: { ...reasoning, status: "in_progress" } });
  await ctx.response.emit({ type: "item.done", item: { ...reasoning, status: "completed" } });
  const toolCall = { callId: `${ctx.request.identity.id}/read`, name: "read_file", arguments: JSON.stringify({ path: "notes/audit.md" }), generatorBlock: "run-lab-scripted-run" };
  const tool = { ...base("tool"), type: "tool_output" as const, blockName: "read_file", toolCall };
  await ctx.response.emit({ type: "item.added", item: { ...tool, status: "in_progress", output: null } });
  await ctx.response.emit({ type: "item.done", item: { ...tool, status: "completed", output: { lines: 0, note: "notes/audit.md is empty" } } });
}

/**
 * The scripted run, a worker's turn for one task: narrate, record what a
 * recording harness records when the flow declares it, then one step per
 * {@link STEP_MS} until the script's steps run out, the hold passes, or the
 * request is aborted.
 */
const scriptedRun = handler({
  name: "run-lab-scripted-run",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ steps: z.number() }),
  execute: async (input, ctx) => {
    const script = scriptOf(input.message);
    ctx.emit.message(`Reading the task: ${input.message.split("\n")[0]}`);
    await emitHarnessOpening(ctx);
    if (script.holdAsk === true) {
      await Promise.race([
        askGate.opened,
        new Promise<never>((_, reject) => {
          if (ctx.signal.aborted) reject(ctx.signal.reason ?? new Error("aborted"));
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason ?? new Error("aborted")), { once: true });
        }),
      ]);
    }
    if (script.ask !== undefined) await ctx.suspend!({ reason: "user_approval", message: script.ask });

    const resources = (ctx as { resources?: Record<string, unknown> }).resources ?? {};
    const plan = resources[OBSERVED_PLAN] as Upsertable | undefined;
    const files = resources[OBSERVED_FILE_OPS] as Upsertable | undefined;
    const marker = resources[OBSERVED_PLAN_LIST] as Upsertable | undefined;
    const run = `${ctx.request.identity.id}/0#0`;
    // As a harness records it: the plan under its conversation, the run's pointer to it, files per run.
    const conversation = harnessConversationNamespace("conv_1");
    if (plan !== undefined && files !== undefined && marker !== undefined) {
      const now = Date.now();
      await marker.upsert(run, { conversation });
      await plan.upsert(`${conversation}/1`, { title: "Read the task", status: "completed", previousStatus: "in_progress", lastOutcome: "applied", lastTouchedAt: now });
      await plan.upsert(`${conversation}/2`, { title: "Write the audit note", status: "in_progress", previousStatus: "pending", lastOutcome: "applied", lastTouchedAt: now });
      await files.upsert(`${run}/notes/audit.md`, { lastKind: "created", outcome: "applied", lastTouchedAt: now, appliedCount: 1 });
      ctx.emit.message("Wrote notes/audit.md");
    }

    // A keyed snapshot: stored once per version, drawn as its latest only.
    ctx.emit.component(PROGRESS_COMPONENT, { state: "started" }, { key: PROGRESS_KEY });
    const until = Date.now() + (script.holdMs ?? 10 * 60_000);
    let step = 0;
    while (script.steps === undefined ? Date.now() < until : step < script.steps) {
      await sleep(STEP_MS, ctx.signal);
      step += 1;
      ctx.emit.message(`Step ${step}`);
    }
    ctx.emit.component(PROGRESS_COMPONENT, { state: "finished", steps: step }, { key: PROGRESS_KEY });
    return { steps: step };
  },
});

/** Read the tree, refusing it whole if anything did not load. */
async function readTree() {
  const roster = await readDeclaredRoster(RUN_LAB_TREE);
  if (roster.problems.length > 0) {
    throw new Error(`the run-lab tree did not load: ${roster.problems.map((p) => `${p.path}: ${p.error.message}`).join("; ")}`);
  }
  return roster;
}

/** Build, open and hand back the Lab, with its tasks filed on the lead's conversation. */
export async function openRunLab(options: { asking?: boolean; holdAsk?: boolean } = {}) {
  const asks = (askGate = gate());
  const orgId = DEFAULT_ORG_ID;
  const tree = await readTree();

  // The lead: the worker whose file names delegates other than a coordinator's.
  // Its delegates are the workers it files for, each on the flow its own file names.
  const byId = new Map(tree.workers.map((w) => [w.id, w]));
  const lead = tree.workers.find(
    (w) => w.declared.flow !== COORDINATOR_FLOW && ((w.declared.delegates as string[] | undefined) ?? []).length > 0,
  );
  if (lead === undefined) throw new Error("the run-lab tree declares no worker that files for delegates");
  const leadFlow = String(lead.declared.flow);
  const workers = (lead.declared.delegates as string[]).map((id) => {
    const worker = byId.get(id);
    if (worker === undefined) throw new Error(`the lead names a delegate no file declares: ${id}`);
    return { id, name: id.split(".").at(-1)!, flow: String(worker.declared.flow) };
  });
  const flowsOfWorkers = [...new Set(workers.map((w) => w.flow))];
  if (flowsOfWorkers.includes(leadFlow)) throw new Error("the run-lab tree puts one of the lead's delegates on the lead's own flow");
  // The worker on a flow no other delegate shares, and the flow the others
  // share. The checked-in tree has both; a tree edited while the Lab is served
  // (one worker moved onto another's flow) may have neither, and still opens.
  const ownWorker = workers.find((w) => workers.filter((o) => o.flow === w.flow).length === 1);
  const sharedFlow = flowsOfWorkers.find((flow) => workers.filter((w) => w.flow === flow).length > 1);

  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => workerFlows as never });

  // The lead's flow carries the session board: its delegates give its
  // conversation the task tools and actions, and the board hands each task
  // to a task session on its worker's flow.
  const board = defineSessionBoard({ installation, flowKind: leadFlow });
  const leadWorkerFlow = defineFlow({
    kind: leadFlow,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { ...hearingDoor, ...board.actions },
    internal: { actions: board.entries(hearingDoor.respond.block, () => "fixed") },
  } as never);
  // Each worker's flow takes tasks through Workforce's task entry; the one on
  // a flow of its own also declares the collections a recording harness writes.
  const workerFlowName = (flow: string, records: boolean) =>
    defineFlow({
      kind: flow,
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: {
        ...installation.resources,
        ...(records ? {
              [OBSERVED_PLAN]: observedPlanCollection,
              [OBSERVED_PLAN_LIST]: observedPlanListCollection,
              [OBSERVED_FILE_OPS]: observedFileOpsCollection,
            } : {}),
        ...workerMessagesResources,
      },
      actions: { ...hearingDoor },
      internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: flow }) } },
      task: { actions: { work: workerTaskEntry({ name: `run-lab-${flow}-task`, turn: scriptedRun }) } },
    } as never);
  const coordinator = defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL });

  workerFlows = {
    [leadFlow]: { flow: leadWorkerFlow, roles: ["manager"] },
    [COORDINATOR_FLOW]: coordinator,
    ...Object.fromEntries(
      flowsOfWorkers.map((flow) => [flow, { flow: workerFlowName(flow, flow === ownWorker?.flow), roles: ["contributor"] }]),
    ),
  };
  const copies = hireWorkforce(installation);
  // The worker write takes caller-supplied rows, so it is internal only.
  const writer = defineFlow({
    kind: INVENTORY_WRITER_FLOW,
    internal: { actions: { ...inventoryWriterActions() } },
  } as never) as unknown as FlowInstance;
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    [INVENTORY_WRITER_FLOW]: writer,
  };
  const flowState = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
    devtool: { userId: RUN_LAB_USER_ID },
    // An asking run suspends until a user answers, which needs durable execution.
    ...(options.asking === true ? { durable: true } : {}),
  } as never);

  const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://run-lab.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  };

  const runtime = await flowState.getRuntime();
  const act = async (flow: FlowInstance, sessionId: string, actionName: string, input: unknown, source?: string) => {
    const result = (await runAction({
      flow,
      actionName,
      input,
      userId: RUN_LAB_USER_ID,
      orgId,
      sessionId,
      ...(source === undefined ? {} : { source }),
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { output?: unknown; error?: unknown };
    if (result?.error !== undefined) throw new Error(`${actionName}: ${String((result.error as Error).message ?? result.error)}`);
    return result.output;
  };

  const inventory = await openInventory(
    { workers: inventoryWorkers(installation) },
    {
      run: (request: InventoryActionRequest) => act(flows[request.flowKind]!, request.sessionId, request.action, request.input, request.source),
      workerWriter: { flowKind: INVENTORY_WRITER_FLOW },
      userId: RUN_LAB_USER_ID,
      orgId,
    },
  );
  if (inventory.problems.length > 0) throw new Error(inventory.problems.join("; "));

  // ---- the tasks, filed on the lead's conversation ----------------------------
  const opened = await call("POST", [leadFlow, "sessions"], {
    userId: RUN_LAB_USER_ID,
    sessionId: RUN_LAB_LEAD_SESSION,
    state: { [WORKER_ID_STATE_KEY]: lead.id },
  });
  if (opened.status !== 201) throw new Error(`the lead's conversation was not opened: ${opened.status} ${JSON.stringify(opened.body)}`);
  const conversation = RUN_LAB_LEAD_SESSION;
  const file = async (worker: (typeof workers)[number], goal: string, script: RunScript, deps?: string[]) => {
    const out = (await act(flows[leadFlow]!, conversation, "createTask_tasks", {
      goal,
      assignee: worker.id,
      input: script,
      ...(deps === undefined ? {} : { deps }),
    })) as { ok: boolean; taskId?: string; error?: string };
    if (out?.ok !== true) throw new Error(`filing for ${worker.id} was refused: ${JSON.stringify(out)}`);
    return out.taskId!;
  };

  const firsts = flowsOfWorkers.map((flow) => workers.find((w) => w.flow === flow)!);
  const filed: Array<{ taskId: string; workerId: string; kind: "held" | "short" | "waiting" | "asking" }> = [];
  for (const worker of firsts) {
    filed.push({ taskId: await file(worker, `${worker.name}: hold until stopped`, {}), workerId: worker.id, kind: "held" });
  }
  if (options.asking === true) {
    // One more task for the worker on a flow of its own, whose run stops to ask a user.
    if (ownWorker === undefined) throw new Error("asking needs one of the lead's delegates on a flow of its own");
    filed.push({
      taskId: await file(ownWorker, `${ownWorker.name}: ask before writing`, { ask: RUN_LAB_ASK, ...(options.holdAsk === true ? { holdAsk: true } : {}) }),
      workerId: ownWorker.id,
      kind: "asking",
    });
  }
  for (const worker of workers.filter((w) => !firsts.includes(w))) {
    for (const n of [1, 2]) filed.push({ taskId: await file(worker, `${worker.name}: short run ${n}`, { steps: 2 }), workerId: worker.id, kind: "short" });
  }
  // It waits on the first held task, which never finishes on its own, so nothing claims it.
  const firstHeld = filed.find((f) => f.kind === "held")!;
  const firstWorker = workers.find((w) => w.id === firstHeld.workerId)!;
  filed.push({
    taskId: await file(firstWorker, `${firstWorker.name}: waits on the held task`, { steps: 1 }, [firstHeld.taskId]),
    workerId: firstWorker.id,
    kind: "waiting",
  });

  /** Every row of the user's conversation boards, read from the store. */
  const storedRows = async (): Promise<Task[]> =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", `${RUN_LAB_USER_ID}:~org:${orgId}`, "tasks/")).map(
      (value) => value.state as unknown as Task,
    );

  /** Abort every run still holding, through its own flow, so the Lab can close without waiting on them. */
  const stopHeldRuns = async () => {
    for (const row of await storedRows()) {
      if (row.run == null) continue;
      const owner = ((await runtime.stores.session.get(row.run.sessionId)) as { flowId?: string } | undefined)?.flowId;
      if (owner !== undefined) await call("POST", [owner, "requests", row.run.requestId, "abort"]).catch(() => undefined);
    }
  };

  return {
    flowState,
    tree,
    flows,
    lead,
    leadFlow,
    sharedFlow,
    ownWorker,
    conversation,
    workers,
    filed,
    storedRows,
    stopHeldRuns,
    releaseAsk: () => asks.open(),
  };
}
