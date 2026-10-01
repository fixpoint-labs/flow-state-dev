/**
 * The run-lab: a Lab whose channel-attached board hands rows to scripted
 * coding runs that hold until they are stopped. The input tree for
 * `goals/shift-manager/it-shows-and-stops-a-task-run`, and the Lab Shift Manager's task
 * screen tests open in CI.
 *
 * The tree is FIX-1668's goal tree: one channel with one board, a member that
 * drains it (a flow of its own, no hand-off policy), and three seats it hands
 * rows to, read off each `WORKER.md`: a per-task seat on the drainer's flow,
 * a per-worker seat on the drainer's flow, and a per-task seat on a flow of
 * its own. No seat, channel or board is named in this file.
 *
 * At boot, after the inventory, the Lab files its rows through the channel's
 * own `fileTask` and drains the board once from a conversation of its own:
 *
 * - one **held** row per per-task seat: its run narrates a step about every
 *   second and holds until it is aborted (or `holdMs` passes);
 * - two **short** rows for the per-worker seat, which run two steps each in
 *   the one session that seat keeps, so that session is shared;
 * - one **waiting** row, filed after the drain, so nothing ever claims it.
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
 * The seat on a flow of its own records a plan and one file operation under
 * its own request id, in the collections a recording harness declares. The
 * drainer's flow declares none, so its runs record none.
 *
 * No model. The "harness" is the scripted run below, in the worker slot the
 * board hands rows to.
 */
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import {
  OBSERVED_FILE_OPS,
  OBSERVED_PLAN,
  observedFileOpsCollection,
  observedPlanCollection,
} from "@flow-state-dev/claude-code/sdk";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  openInventory,
  workerConfigSchema,
  type InventoryActionRequest,
  type OpenChannelsOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The tree this Lab reads. */
const RUN_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");
/** The one person this Lab runs as. */
export const RUN_LAB_USER_ID = "u_run_lab";
/** The conversation the board is drained from. */
const RUN_LAB_DRAIN_SESSION = "s_run_lab_drain";

/** The task entry every seat's hand-off addresses. */
const ENTRY = "work";
/** A seat whose file names this kind runs on the drainer's flow. */
const PASSIVE_KIND = "seat";
/** How often a held run narrates a step. */
const STEP_MS = 1_000;
/** The keyed progress snapshot every run emits as it starts and again as it finishes. */
const PROGRESS_COMPONENT = "run-lab-progress";
const PROGRESS_KEY = "progress";

/** What a row asks its scripted run to do. */
export type RunScript = { steps?: number; holdMs?: number };

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
 * The scripted run: narrate, record what a recording harness records when the
 * flow declares it, then one step per {@link STEP_MS} until the script's steps
 * run out, the hold passes, or the request is aborted.
 */
const scriptedRun = handler({
  name: "run-lab-scripted-run",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ steps: z.number() }),
  execute: async (input: TaskWorkerInput, ctx) => {
    const script = (input.input ?? {}) as RunScript;
    ctx.emit.message(`Reading the task: ${input.goal ?? input.taskId}`);
    await emitHarnessOpening(ctx);

    const resources = (ctx as { resources?: Record<string, unknown> }).resources ?? {};
    const plan = resources[OBSERVED_PLAN] as Upsertable | undefined;
    const files = resources[OBSERVED_FILE_OPS] as Upsertable | undefined;
    const run = `${ctx.request.identity.id}/0#0`;
    if (plan !== undefined && files !== undefined) {
      const now = Date.now();
      await plan.upsert(`${run}/1`, { title: "Read the task", status: "completed", previousStatus: "in_progress", lastOutcome: "applied", lastTouchedAt: now });
      await plan.upsert(`${run}/2`, { title: "Write the audit note", status: "in_progress", previousStatus: "pending", lastOutcome: "applied", lastTouchedAt: now });
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

/** Build, open and hand back the Lab, with its rows filed and drained. */
export async function openRunLab() {
  const orgId = DEFAULT_ORG_ID;
  const tree = await readTree();
  const channel = tree.channels.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (channel === undefined) throw new Error("the run-lab tree declares no channel holding a board");
  const boardName = (channel.declared.boards as string[])[0]!;
  const ledger = channelBoard(channel.id, boardName);

  // Members, off the channel file: the one that drains, and the seats it hands rows to.
  const byId = new Map(tree.workers.map((w) => [w.id, w]));
  const members = ((channel.declared.members as string[] | undefined) ?? []).map((id) => byId.get(id)!);
  const drainer = members.find((w) => w.declared.flow !== undefined && w.declared.handoff === undefined);
  const seats = members
    .filter((w) => typeof w.declared.handoff === "string")
    .map((w) => ({
      id: w.id,
      name: w.id.split(".").at(-1)!,
      policy: w.declared.handoff as "per-task" | "per-worker",
      flow: w.declared.flow === PASSIVE_KIND ? undefined : (w.declared.flow as string | undefined),
    }));
  if (drainer === undefined || seats.length === 0) throw new Error("the run-lab tree declares no drainer or no seats");

  const seatConfig = workerConfigSchema().extend({ handoff: z.enum(["per-task", "per-worker"]).optional() });
  const address = (seat: (typeof seats)[number]) =>
    dispatcher<TaskWorkerInput>({
      name: `run-lab-hand-${seat.name}`,
      action: ENTRY,
      session: seat.policy,
      ...(seat.flow !== undefined ? { flowKind: seat.id } : {}),
    });
  const BOARD_ID = `${ledger.id}-board`;
  const leadBoard = taskBoard({
    name: "run-lab-lead",
    boardId: BOARD_ID,
    collection: ledger,
    workers: Object.fromEntries(seats.map((seat) => [seat.name, address(seat)])),
  });
  const leadKind = defineFlow({
    kind: drainer.declared.flow as string,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { [ledger.id]: ledger },
    actions: { drain: { block: leadBoard.drain } },
    task: { actions: { [ENTRY]: { block: scriptedRun } } },
  } as never);
  // A seat on a flow of its own gates its entry with the same logical board,
  // and declares the collections a recording harness writes.
  const ownKinds = Object.fromEntries(
    seats
      .filter((seat) => seat.flow !== undefined)
      .map((seat) => {
        const board = taskBoard({
          name: `run-lab-${seat.flow}`,
          boardId: BOARD_ID,
          collection: ledger,
          workers: { [seat.name]: address({ ...seat, flow: undefined }) },
        });
        return [
          seat.flow!,
          defineFlow({
            kind: seat.flow!,
            cardinality: "collection",
            configSchema: seatConfig,
            resources: { [ledger.id]: ledger, [OBSERVED_PLAN]: observedPlanCollection, [OBSERVED_FILE_OPS]: observedFileOpsCollection },
            actions: { drain: { block: board.drain } },
            task: { actions: { [ENTRY]: { block: scriptedRun } } },
          } as never),
        ];
      }),
  );
  const passiveKind = defineFlow({ kind: PASSIVE_KIND, cardinality: "collection", configSchema: seatConfig, actions: {} } as never);

  const hired = hireWorkforce(tree.workers, {
    kinds: {
      [drainer.declared.flow as string]: leadKind as never,
      [PASSIVE_KIND]: passiveKind as never,
      ...(ownKinds as Record<string, never>),
    },
    channelBoards: channelBoardIds(tree.channels),
  });
  const channelKind = defineChannelFlow({ inventory: true });
  const instances = channelInstances(tree.channels, { kinds: { [CHANNEL_KIND]: channelKind as never } });
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(instances.map((i) => [i.kind, i])),
    ...Object.fromEntries(hired.map((seat) => [seat.id, seat])),
  };
  const flowState = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
    devtool: { userId: RUN_LAB_USER_ID },
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
  const client: OpenChannelsOptions["client"] = {
    createSession: async (create) => {
      const { status, body } = await call("POST", [create.flowKind, "sessions"], create);
      if (status >= 400) throw Object.assign(new Error(`create session: ${status}`), { status });
      return body;
    },
    getSession: async (sessionId) => {
      const { status, body } = await call("GET", ["sessions", sessionId]);
      if (status >= 400) throw new Error(`read session ${sessionId}: ${status}`);
      return body?.session ?? body;
    },
    deleteSession: async (sessionId) => {
      await call("DELETE", ["sessions", sessionId]);
    },
  };
  await openChannels(tree.channels, { client, userId: RUN_LAB_USER_ID });

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
    { seats: hired, channels: tree.channels },
    {
      run: (request: InventoryActionRequest) => act(flows[request.flowKind]!, request.sessionId, request.action, request.input, request.source),
      seatWriter: { flowKind: CHANNEL_KIND },
      userId: RUN_LAB_USER_ID,
      orgId,
    },
  );
  if (inventory.problems.length > 0) throw new Error(inventory.problems.join("; "));

  // ---- the rows, filed through the channel, then one drain ------------------
  const channelInstance = instances.find((i) => i.kind === CHANNEL_KIND)!;
  const file = async (seat: (typeof seats)[number], goal: string, script: RunScript) =>
    ((await act(channelInstance, channel.id, "fileTask", { board: boardName, goal, assignee: seat.name, input: script })) as {
      taskId: string;
    }).taskId;

  const filed: Array<{ taskId: string; seatId: string; kind: "held" | "short" | "waiting" }> = [];
  for (const seat of seats.filter((s) => s.policy === "per-task")) {
    filed.push({ taskId: await file(seat, `${seat.name}: hold until stopped`, {}), seatId: seat.id, kind: "held" });
  }
  for (const seat of seats.filter((s) => s.policy === "per-worker")) {
    for (const n of [1, 2]) filed.push({ taskId: await file(seat, `${seat.name}: short run ${n}`, { steps: 2 }), seatId: seat.id, kind: "short" });
  }
  const lead = hired.find((seat) => seat.id === drainer.id)!;
  await act(lead as FlowInstance, RUN_LAB_DRAIN_SESSION, "drain", {});

  // Filed after the only drain, so nothing ever claims it.
  const firstSeat = seats.find((s) => s.policy === "per-task")!;
  filed.push({ taskId: await file(firstSeat, `${firstSeat.name}: filed after the drain`, { steps: 1 }), seatId: firstSeat.id, kind: "waiting" });

  /** Abort every run still holding, through its own flow, so the Lab can close without waiting on them. */
  const stopHeldRuns = async () => {
    for (const f of filed) {
      const row = (await runtime.stores.resourceState.get("org", orgId, `${ledger.id}/${f.taskId}`))?.state as
        | { run?: { sessionId: string; requestId: string } }
        | undefined;
      if (row?.run == null) continue;
      const owner = ((await runtime.stores.session.get(row.run.sessionId)) as { flowId?: string } | undefined)?.flowId;
      if (owner !== undefined) await call("POST", [owner, "requests", row.run.requestId, "abort"]).catch(() => undefined);
    }
  };

  return { flowState, tree, flows, channel, boardName, ledger, drainerId: drainer.id, seats, filed, stopHeldRuns };
}
