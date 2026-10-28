/**
 * The shift-lab: a Lab of two teams and one org-level seat, whose workers are
 * put into each shift status on purpose at boot. The input for
 * `goals/shift-manager/it-shows-who-is-on-shift`.
 *
 * The tree (`workforce/`) is two teams. `eng.lead` files the work: its
 * `delegates:` names every worker of both teams that takes a task, which
 * gives its conversation the task tools, and it files each task on that
 * conversation's own board, at the Lab user's scope. `eng.desk` and
 * `ops.desk` are coordinators on Workforce's `coordinator` flow that nothing
 * posts to. One org-level seat, `chief-of-staff`, has no team: the tree has
 * no place for one yet, so it is registered in the seat inventory beside the
 * hired workers, as an org seat's row will be.
 *
 * What each worker is doing is the **spread**: per worker name, the states to
 * build. Read from `SHIFT_LAB_SPREAD` (JSON), so a check can boot the same
 * tree under another spread; {@link DEFAULT_SPREAD} otherwise.
 *
 * - `held`: a task its run is working, narrating a step a second, until it
 *   is aborted;
 * - `asked`: a task its run holds on a question for a person
 *   (`askQuestion`), then ends its turn;
 * - `queued`: a task that waits on another task the spread holds or asks on,
 *   so nothing ever starts it;
 * - `ask`: a pending approval in a session of its own, on the flow it runs on,
 *   naming it.
 *
 * Every worker runs on one copy of the flow its file names (`lead`, `seat` or
 * `coordinator`), and each of its sessions names it in its state
 * (`workerId`). A task runs in a task session the board opens for it.
 *
 * Every task is filed through the lead's conversation's `createTask_tasks`, over
 * the Lab's own router, assigned by the worker's id. No model: the runs are
 * scripted.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, GeneratorModel } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  COORDINATOR_FLOW,
  WORKER_ID_STATE_KEY,
  defineCoordinatorFlow,
  defineSessionBoard,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type InventoryActionRequest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { actingAs } from "../../../lib/client-actions.mts";
import { hearsMessages, workerDoor } from "../../../lib/worker-door.mts";
import { installWorkers } from "../../../lib/workers.mts";

/** The tree this Lab reads. */
const SHIFT_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");
/** The one person this Lab runs as. */
export const SHIFT_LAB_USER_ID = "u_shift_lab";
/** The org-level seat, registered with no team. */
export const ORG_SEAT = { id: "chief-of-staff", kind: "chief-of-staff", actions: {} } as const;

/** The kind the filing worker is hired into. */
const LEAD_KIND = "lead";
/** The kind every worker the lead files for is hired into. */
const SEAT_KIND = "seat";
/** The flow the inventory's seat rows are written from: the Lab's own, carrying the writer. */
const INVENTORY_WRITER_FLOW = "inventory-writer";
/**
 * The model best fit's one evaluator call would run on. The desks route to
 * everyone and nothing posts to them, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:openai/gpt-5.4-mini";
/** What an asked task's goal says, so its run asks instead of holding it. */
const PARK = "ask a person";
/** The question an asked task waits on. */
const QUESTION = "Needs a look before it goes further.";
/** How often a held run narrates a step. */
const STEP_MS = 1_000;

/** One state to build for a worker. */
export type ShiftState = "held" | "asked" | "queued" | "ask";
/** Per worker name, the states to build. */
export type Spread = Record<string, ShiftState[]>;

/** The spread when `SHIFT_LAB_SPREAD` names none: one worker in each state, and one with nothing. */
export const DEFAULT_SPREAD: Spread = { coder: ["held"], reviewer: ["asked"], asker: ["ask"], waiter: ["queued"] };

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

/**
 * The asked task's model, one step at a time: it asks its question, which
 * holds the task it runs on, and once the tool has answered, ends the turn.
 */
const parkingModel: GeneratorModel = {
  modelId: "shift-lab/asking",
  generate: async () => {
    throw new Error("the shift-lab's asking model runs one step at a time (generateStep)");
  },
  generateStep: async ({ messages, tools }) => {
    if ((messages.at(-1) as { role?: string } | undefined)?.role === "tool") return { text: "Waiting on your answer.", finishReason: "stop" };
    if (!(tools ?? []).some((tool) => tool.name === "askQuestion")) {
      throw new Error("the asked task's turn was not offered askQuestion");
    }
    return { toolCalls: [{ toolCallId: "ask", toolName: "askQuestion", args: { question: QUESTION } }], finishReason: "tool-calls" };
  },
};

/** Build, open and hand back the Lab, with every worker in its spread's states. */
export async function openShiftLab(spread: Spread = spreadFromEnv()) {
  const orgId = DEFAULT_ORG_ID;
  const tree = await readTree();

  // The filer is the worker off the coordinator flow whose file names delegates.
  const lead = tree.workers.find((w) => w.declared.flow !== COORDINATOR_FLOW && ((w.declared.delegates as string[] | undefined) ?? []).length > 0);
  if (lead === undefined) throw new Error("the shift-lab tree declares no worker that files for delegates");
  const seats = (lead.declared.delegates as string[]).map((id) => ({ id, name: id.split(".").at(-1)! }));
  const unknown = Object.keys(spread).filter((name) => !seats.some((s) => s.name === name));
  if (unknown.length > 0) throw new Error(`the spread names workers the tree doesn't have: ${unknown.join(", ")}`);

  const door = z.object({ message: z.string() });

  /** A held task's run: narrate a step a second until aborted. */
  const holdRun = handler({
    name: "shift-lab-hold",
    inputSchema: door,
    execute: async (_input, ctx: BlockContext) => {
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
        await ctx.suspend!({ reason: "user_approval", message: `Approve: ${input.what}` });
        return { approved: true };
      } catch (error) {
        if (error instanceof SuspensionRejectedError) return { approved: false };
        throw error;
      }
    },
  });

  const { installation, copies } = installWorkers(tree.workers, (installation) => {
    const leadBoard = defineSessionBoard({ installation, flowKind: LEAD_KIND });
    const leadTurn = handler({ name: "shift-lab-lead-turn", inputSchema: door, execute: async () => "Noted." });
    // A seat's own session board is never filed on; it is built for its
    // question park, which a task turn composes.
    const { questions } = defineSessionBoard({ installation, flowKind: SEAT_KIND });
    const parkTurn = generator({
      name: "shift-lab-park",
      model: parkingModel as never,
      inputSchema: door,
      uses: [questions],
      prompt: "Park the task you are handed on its question for a person, then stop.",
      user: (input: { message: string }) => input.message,
    });
    // A task's run: park it when its goal says so, or hold until stopped.
    const taskTurn = sequencer({ name: "shift-lab-task-turn", inputSchema: door }).branch({
      park: [(input: { message: string }) => input, (input: { message: string }) => input.message.includes(PARK), parkTurn],
      hold: [(input: { message: string }) => input, (input: { message: string }) => !input.message.includes(PARK), holdRun],
    });
    return {
      [LEAD_KIND]: { roles: ["manager"], flow: defineFlow({
        kind: LEAD_KIND,
        cardinality: "collection",
        configSchema: workerConfigSchema(),
        session: { ...installation.session(leadBoard.sessionStateShape), serverOwned: [...leadBoard.serverOwned] },
        resources: { ...installation.resources, ...leadBoard.resources },
        actions: { ...workerDoor, ...leadBoard.actions },
        // A task's notice lands as a line; it wakes no turn.
        internal: { actions: leadBoard.entries(leadTurn, () => "fixed") },
      } as never) },
      [SEAT_KIND]: { roles: ["contributor"], flow: defineFlow({
        kind: SEAT_KIND,
        cardinality: "collection",
        configSchema: workerConfigSchema(),
        session: installation.session(),
        resources: { ...installation.resources, ...workerMessagesResources },
        internal: { actions: hearsMessages(installation, SEAT_KIND) },
        actions: { ...workerDoor, ask: { block: sequencer({ name: "shift-lab-ask", inputSchema: z.object({ what: z.string() }) }).step(gate), durable: true } },
        task: { actions: { work: workerTaskEntry({ name: "shift-lab-task", turn: taskTurn }) } },
      } as never) },
      [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL }),
    };
  });
  // The seat write takes caller-supplied rows, so it is internal only.
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
    durable: true,
    devtool: { userId: SHIFT_LAB_USER_ID },
  } as never);

  const runtime = await flowState.getRuntime();
  const inventory = await openInventory(
    { workers: [...inventoryWorkers(installation), ORG_SEAT] },
    {
      run: async (request: InventoryActionRequest) => {
        const result = (await runAction({
          flow: flows[request.flowKind],
          actionName: request.action,
          input: request.input,
          userId: request.userId,
          orgId: request.orgId,
          sessionId: request.sessionId,
          source: request.source,
          stores: runtime.stores,
          runtimeConfig: runtime.runtimeConfig,
        } as never)) as { output?: unknown; error?: unknown };
        if (result?.error !== undefined) throw new Error(`${request.action}: ${String((result.error as Error).message ?? result.error)}`);
        return result;
      },
      workerWriter: { flowKind: INVENTORY_WRITER_FLOW },
      userId: SHIFT_LAB_USER_ID,
      orgId,
    },
  );
  if (inventory.problems.length > 0) throw new Error(inventory.problems.join("; "));

  // ---- the spread: filed on the lead's conversation's board -----------------
  const http = actingAs((await flowState.getRouter()), SHIFT_LAB_USER_ID);
  const conversation = await http.open(LEAD_KIND, { [WORKER_ID_STATE_KEY]: lead.id });
  const states = (wanted: ShiftState) => Object.entries(spread).flatMap(([name, list]) => list.filter((s) => s === wanted).map(() => name));
  const idOf = (name: string) => seats.find((s) => s.name === name)!.id;
  const file = async (name: string, goal: string, deps?: string[]): Promise<string> => {
    const filed = await http.act(LEAD_KIND, conversation, "createTask_tasks", { goal, assignee: idOf(name), ...(deps === undefined ? {} : { deps }) });
    if (filed?.ok !== true) throw new Error(`filing "${goal}" for ${idOf(name)}: ${JSON.stringify(filed)}`);
    return String(filed.taskId);
  };

  const started: string[] = [];
  for (const name of states("held")) started.push(await file(name, `${name}: hold until stopped`));
  for (const name of states("asked")) started.push(await file(name, `${name}: ${PARK}`));
  // A queued task waits on one that never finishes, so nothing starts it.
  if (states("queued").length > 0 && started.length === 0) throw new Error("a queued task waits on a held or asked one, and the spread has none");
  for (const name of states("queued")) await file(name, `${name}: waits on ${started[0]}`, [started[0]!]);

  for (const name of states("ask")) {
    const sessionId = await http.open(SEAT_KIND, { [WORKER_ID_STATE_KEY]: idOf(name) });
    const posted = await http.call("POST", [SEAT_KIND, sessionId, "actions", "ask"], {
      userId: SHIFT_LAB_USER_ID,
      input: { what: `${name} wants to go ahead` },
    });
    if (posted.status !== 202) throw new Error(`ask for ${name}: ${posted.status} ${posted.text}`);
  }

  return { flowState, tree, spread };
}
