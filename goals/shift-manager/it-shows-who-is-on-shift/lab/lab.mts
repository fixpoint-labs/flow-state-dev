/**
 * The shift-lab: a Lab of two teams and one org-level seat, whose workers are
 * put into each shift status on purpose at boot. The input for
 * `goals/shift-manager/it-shows-who-is-on-shift`.
 *
 * The tree (`workforce/`) is two teams. `eng.desk` holds the one board, and
 * every worker of both teams is a member it hands rows to; its lead drains it.
 * `ops.desk` keeps no board. One org-level seat, `chief-of-staff`, has no team:
 * the tree has no place for one yet, so it is registered in the seat inventory
 * beside the hired seats, as an org seat's row will be.
 *
 * What each worker is doing is the **spread**: per worker name, the states to
 * build. Read from `SHIFT_LAB_SPREAD` (JSON), so a check can boot the same
 * tree under another spread; {@link DEFAULT_SPREAD} otherwise.
 *
 * - `held`: a row its run is working, narrating a step a second, until it is
 *   aborted;
 * - `parked`: a row its run parks for a person (`awaitReview`), then returns;
 * - `queued`: a row filed after the only drain, so nothing ever claims it;
 * - `ask`: a pending approval in a session of its own, on its own flow.
 *
 * Every row is filed through the mailbox's own `fileTask`, assigned by the
 * worker's name. No model: the runs are scripted.
 */
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { getOrCreateTaskCollection, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  MAILBOX_KIND,
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  defineMailboxFlow,
  hireWorkforce,
  openMailboxes,
  openInventory,
  workerConfigSchema,
  type InventoryActionRequest,
  type OpenMailboxesOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { workerDoor } from "../../../lib/worker-door.mts";

/** The tree this Lab reads. */
const SHIFT_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");
/** The one person this Lab runs as. */
export const SHIFT_LAB_USER_ID = "u_shift_lab";
/** The conversation the board is drained from. */
const DRAIN_SESSION = "s_shift_lab_drain";
/** The org-level seat, registered with no team. */
export const ORG_SEAT = { id: "chief-of-staff", kind: "chief-of-staff", actions: {} } as const;

/** The task entry every seat's hand-off addresses. */
const ENTRY = "work";
/** The kind every worker but the lead is hired into. */
const SEAT_KIND = "seat";
/** How often a held run narrates a step. */
const STEP_MS = 1_000;

/** One state to build for a worker. */
export type ShiftState = "held" | "parked" | "queued" | "ask";
/** Per worker name, the states to build. */
export type Spread = Record<string, ShiftState[]>;

/** The spread when `SHIFT_LAB_SPREAD` names none: one worker in each state, and one with nothing. */
export const DEFAULT_SPREAD: Spread = { coder: ["held"], reviewer: ["parked"], asker: ["ask"], waiter: ["queued"] };

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

/** Read the tree, refusing it whole if anything did not load. */
async function readTree() {
  const roster = await readDeclaredRoster(SHIFT_LAB_TREE);
  if (roster.problems.length > 0) {
    throw new Error(`the shift-lab tree did not load: ${roster.problems.map((p) => `${p.path}: ${p.error.message}`).join("; ")}`);
  }
  return roster;
}

/** The spread from `SHIFT_LAB_SPREAD`, or the default. */
function spreadFromEnv(): Spread {
  const raw = process.env.SHIFT_LAB_SPREAD;
  return raw === undefined || raw === "" ? DEFAULT_SPREAD : (JSON.parse(raw) as Spread);
}

/** Build, open and hand back the Lab, with every worker in its spread's states. */
export async function openShiftLab(spread: Spread = spreadFromEnv()) {
  const orgId = DEFAULT_ORG_ID;
  const tree = await readTree();
  const mailbox = tree.mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (mailbox === undefined) throw new Error("the shift-lab tree declares no mailbox holding a board");
  const boardName = (mailbox.declared.boards as string[])[0]!;
  const ledger = mailboxBoard(mailbox.id, boardName);

  const byId = new Map(tree.workers.map((w) => [w.id, w]));
  const members = ((mailbox.declared.members as string[] | undefined) ?? []).map((id) => byId.get(id)!);
  const drainer = members.find((w) => w.declared.handoff === undefined);
  const seats = members.filter((w) => w.declared.handoff !== undefined).map((w) => ({ id: w.id, name: w.id.split(".").at(-1)! }));
  if (drainer === undefined || seats.length === 0) throw new Error("the shift-lab tree declares no drainer or no seats");
  const unknown = Object.keys(spread).filter((name) => !seats.some((s) => s.name === name));
  if (unknown.length > 0) throw new Error(`the spread names workers the tree doesn't have: ${unknown.join(", ")}`);

  /** A row's run: park it for a person, or hold until aborted. */
  const scriptedRun = handler({
    name: "shift-lab-scripted-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ steps: z.number() }),
    execute: async (input: TaskWorkerInput, ctx: BlockContext) => {
      const script = (input.input ?? {}) as { park?: boolean };
      if (script.park === true) {
        const tasks = await getOrCreateTaskCollection({
          ctx,
          backing: "resource",
          collectionId: ledger.id,
          collection: ctx.resources[ledger.id] as ResourceCollectionRef<JsonObject>,
        });
        await tasks.awaitReview(input.taskId, "Needs a look before it goes further.");
        return { steps: 0 };
      }
      let step = 0;
      for (;;) {
        await sleep(STEP_MS, ctx.signal);
        step += 1;
        ctx.emit.message(`Step ${step}`);
      }
    },
  });

  /** Suspend on a stock approval naming `what`. */
  const gate = handler({
    name: "shift-lab-gate",
    inputSchema: z.object({ what: z.string() }),
    outputSchema: z.object({ approved: z.boolean() }),
    execute: async (input, ctx) => {
      try {
        await ctx.suspend!({ reason: "human_approval", message: `Approve: ${input.what}` });
        return { approved: true };
      } catch (error) {
        if (error instanceof SuspensionRejectedError) return { approved: false };
        throw error;
      }
    },
  });

  const leadBoard = taskBoard({
    name: "shift-lab-lead",
    boardId: `${ledger.id}-board`,
    collection: ledger,
    workers: Object.fromEntries(
      seats.map((seat) => [seat.name, dispatcher<TaskWorkerInput>({ name: `shift-lab-hand-${seat.name}`, action: ENTRY, session: "per-task" })]),
    ),
  });
  const leadKind = defineFlow({
    kind: drainer.declared.flow as string,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources: { [ledger.id]: ledger },
    actions: { drain: { block: leadBoard.drain }, ...workerDoor },
    task: { actions: { [ENTRY]: { block: scriptedRun } } },
  } as never);
  const seatKind = defineFlow({
    kind: SEAT_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ handoff: z.enum(["per-task", "per-worker"]).optional() }),
    actions: { ...workerDoor, ask: { block: sequencer({ name: "shift-lab-ask", inputSchema: z.object({ what: z.string() }) }).step(gate), durable: true } },
  } as never);

  const hired = hireWorkforce(tree.workers, {
    workerFlows: { [drainer.declared.flow as string]: leadKind as never, [SEAT_KIND]: seatKind as never },
    mailboxBoards: mailboxBoardIds(tree.mailboxes),
  });
  const instances = mailboxInstances(tree.mailboxes, { kinds: { [MAILBOX_KIND]: defineMailboxFlow({ inventory: true }) as never } });
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(instances.map((i) => [i.kind, i])),
    ...Object.fromEntries(hired.map((seat) => [seat.id, seat])),
  };
  const flowState = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
    durable: true,
    devtool: { userId: SHIFT_LAB_USER_ID },
  } as never);

  const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://shift-lab.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  };
  const client: OpenMailboxesOptions["client"] = {
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
  await openMailboxes(tree.mailboxes, { client, userId: SHIFT_LAB_USER_ID });

  const runtime = await flowState.getRuntime();
  const act = async (flow: FlowInstance, sessionId: string, actionName: string, input: unknown, source?: string) => {
    const result = (await runAction({
      flow,
      actionName,
      input,
      userId: SHIFT_LAB_USER_ID,
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
    { seats: [...hired, ORG_SEAT], mailboxes: tree.mailboxes },
    {
      run: (request: InventoryActionRequest) => act(flows[request.flowKind]!, request.sessionId, request.action, request.input, request.source),
      seatWriter: { flowKind: MAILBOX_KIND },
      userId: SHIFT_LAB_USER_ID,
      orgId,
    },
  );
  if (inventory.problems.length > 0) throw new Error(inventory.problems.join("; "));

  // ---- the spread: rows filed through the mailbox, one drain, then the rest --
  const mailboxInstance = instances.find((i) => i.kind === MAILBOX_KIND)!;
  const file = async (name: string, goal: string, script: { park?: boolean }) =>
    act(mailboxInstance, mailbox.id, "fileTask", { board: boardName, goal, assignee: name, input: script });
  const states = (wanted: ShiftState) => Object.entries(spread).flatMap(([name, list]) => list.filter((s) => s === wanted).map(() => name));

  for (const name of states("held")) await file(name, `${name}: hold until stopped`, {});
  for (const name of states("parked")) await file(name, `${name}: park for a person`, { park: true });
  await act(hired.find((seat) => seat.id === drainer.id)! as FlowInstance, DRAIN_SESSION, "drain", {});
  // Filed after the only drain, so nothing ever claims them.
  for (const name of states("queued")) await file(name, `${name}: filed after the drain`, {});
  for (const [i, name] of states("ask").entries()) {
    const seat = seats.find((s) => s.name === name)!;
    const posted = await call("POST", [seat.id, `s_shift_lab_ask_${name}_${i}`, "actions", "ask"], {
      userId: SHIFT_LAB_USER_ID,
      input: { what: `${name} wants to go ahead` },
    });
    if (posted.status !== 202) throw new Error(`ask for ${name}: ${posted.status} ${JSON.stringify(posted.body)}`);
  }

  return { flowState, tree, spread };
}
