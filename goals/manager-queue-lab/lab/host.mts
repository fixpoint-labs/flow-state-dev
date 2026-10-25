/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed routing check drive the *same* tree, hire and
 * wiring, and differ by who files.
 *
 * What `openLab` does, in order, and nothing else: read the tree, build the
 * installation and its two worker flows, hire one copy of each, open the
 * manager's conversation, hand back handles. Every file it reads is found by
 * walking from one root; no file is named in this code.
 *
 * ## The manager runs on Workforce's coordinator flow
 *
 * The manager's `WORKER.md` says `flow: coordinator`, and this host registers
 * Workforce's own coordinator flow (`defineCoordinatorFlow`) under that name.
 * The lab no longer ships a flow of its own called `coordinator`: since
 * FIX-1791 that name is the framework's coordinator, and a lab kind
 * registered under it would make this the one tree where `flow: coordinator`
 * means something else. The line in the file is unchanged; what it names is
 * the coordinator every other tree's file names. Its judgment turn carries
 * Orchestration's task tools because the manager's `delegates:` names workers
 * that take tasks (FIX-1802), and its public actions carry the same tools as
 * `<tool>_tasks`. Nothing in the lab composes them.
 *
 * ## Where the work goes
 *
 * On the manager's own conversation's board (FIX-1794): a row filed there is
 * stored in that conversation's partition, at its user's scope, names its
 * delegate by worker id, and is handed over at once to a task session of its
 * own on the delegate's flow. There is no board file, no board id, no drain,
 * and no map from a routing key to a worker: the row's assignee is the worker.
 *
 * ## What is the lab's rather than the framework's
 *
 * 1. **The builder flow.** A stub that writes one line per task to a file
 *    outside the board, and takes tasks through `workerTaskEntry`.
 * 2. **The worker records the installation is handed.** Read off the tree,
 *    and the one thing the `repointed-map` control moves: it swaps two
 *    builders' files under their ids, so the tree on disk and what each
 *    worker runs with come apart.
 * 3. **The refusal policy.** `readDeclaredRoster` collects rather than throws,
 *    which is right for a library and wrong here: a worker that failed to load
 *    is a worker this lab does not have.
 */

import { createModelResolver, type GeneratorTool } from "@flow-state-dev/core";
import { encodeUserSegment, type FlowInstance, type GeneratorModel } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  COORDINATOR_JUDGMENT,
  COORDINATOR_FLOW,
  ROSTER_FLOW,
  createWorkerInstallation,
  defineCoordinatorFlow,
  hireWorkforce,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { actingAs, untilIdle } from "../../lib/index.mts";
import { BUILDER_KIND, defineBuilderWorkerFlow, workLineSchema, type WorkLine } from "./workforce/flows/workers/builder.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the lab runs as, and the org every session and row is bound to. */
export const LAB_USER_ID = "u_manager_queue_lab";
export const LAB_ORG_ID = "org_manager_queue_lab";

/** The one catalog tool this lab offers, so the tools leg's fence has something to take away. */
export const NOTE_TOOL = "note";

/** What the model-free turn says: it reads what woke it and does nothing else. */
const QUIET_TURN = "Noted.";

/**
 * Read a workforce tree into records, refusing a tree that did not load
 * cleanly, naming every problem in one pass.
 */
async function loadTree(root: string): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((problem) =>
      problem.worker === undefined
        ? `${problem.layer} ${problem.path}: ${problem.error.message}`
        : `${problem.layer} ${problem.path} (worker ${problem.worker}): ${problem.error.message}`,
    );
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  return roster;
}

/** The lab's one catalog tool. It does nothing; it is a tool a `tools:` fence can take away. */
function noteTool(): GeneratorTool {
  return {
    name: NOTE_TOOL,
    description: "Leave a short note for the team. Does nothing else.",
    inputSchema: z.object({ note: z.string() }),
    execute: async (input: { note: string }) => ({ noted: input.note }),
  } as unknown as GeneratorTool;
}

/** One model call of the manager's judgment turn: the tool names it was handed. */
export interface JudgmentCall {
  tools: string[];
  /** The probe's answer, when this call ran it. */
  probed?: unknown;
}

/** A task row as the store holds it, with the partition it was filed in. */
export type StoredRow = Task & { partition: string };

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` for both checks. */
  stores: unknown;
  /** Where finished work leaves its lines. */
  outbox: string;
  /**
   * The real model the manager's turn runs on. Omitted, every model call is
   * answered by a quiet stub that files nothing — the model-free path.
   */
  model?: string;
  /** Silence the engine's own logging. */
  logger?: unknown;

  // ---- arms and controls, each perturbing the wiring and never the tree ---

  /**
   * Rewrite one worker's `flow:` before the hire. Pointed at a flow nobody
   * registered, the WHOLE roster refuses and names the worker.
   */
  kindOverrides?: Record<string, string>;
  /** Rewrite the manager's `tools:` before the hire, for the fence's other arm. */
  managerTools?: string[];
  /**
   * Build the builder flow with a `work` entry that takes no conversation's
   * task — the tools leg's twin, whose manager has no task-taking delegate.
   */
  builderTakesTasks?: boolean;
  /**
   * Swap the first two builders' files under their ids — the `repointed-map`
   * control. `roster` stays the tree; only the copies the installation hires
   * move, so a check reads the oracle off `roster` after open.
   */
  swapBuilders?: boolean;
  /**
   * Run `tool` once, on the first non-streamed judgment call that holds it,
   * with `input(builderIds)`. The answer is that call's `probed`.
   */
  probe?: { tool: string; input: (builderIds: string[]) => unknown };
}

/** Everything a check needs to drive and observe one lab. */
export interface Lab {
  roster: DeclaredRoster;
  /** The workers as hired, by id, with the flow each runs on. */
  hired: Record<string, string>;
  /** The manager's id, read off the tree rather than named. */
  managerId: string;
  /** The builder ids, in tree order. */
  builderIds: string[];
  /** The manager's conversation, opened as the lab's user. */
  conversation: string;
  /** Every model call the manager's judgment turn made, in order. */
  judgmentCalls: JudgmentCall[];

  /** Say something to the manager, as its user does: one turn of its conversation. */
  say(message: string): Promise<{ error?: string }>;
  /** Run one of the conversation's public actions (`createTask_tasks`, `listTasks_tasks`, ...). */
  act(actionName: string, input: unknown): Promise<{ output?: any; error?: string }>;
  /** The partition the conversation's board files in, as its `listDelegates` answers it. */
  filingSessionId(): Promise<string>;
  /** Every task row at the lab user's scope, read from the store, never through the board. */
  rows(): Promise<StoredRow[]>;
  /** The lines finished work left behind, outside the board entirely. */
  workLines(): WorkLine[];
  /** One session record, straight out of the store. */
  session(sessionId: string): Promise<Record<string, any> | undefined>;
  /** Every request a session ran, oldest first, with its items. */
  requestsOf(sessionId: string): Promise<Array<Record<string, any>>>;
  /** Wait until no request is running. */
  settled(): Promise<void>;
  /** Hold every builder turn before it writes its line, until `release`. */
  hold(): void;
  /** Let held turns go on. */
  release(): void;
  /** How many builder turns are waiting on the hold right now. */
  heldTurns(): number;
  dispose(): Promise<void>;
}

/**
 * A model resolver that records the tool names each judgment call is handed,
 * runs `probe` once when one is set, and otherwise defers to `base`.
 */
function observing(
  base: (modelId: string, blockName?: string, options?: unknown) => GeneratorModel,
  calls: JudgmentCall[],
  probe?: { tool: string; args: unknown },
): (modelId: string, blockName?: string, options?: unknown) => GeneratorModel {
  let ran = false;
  return (modelId, blockName, options) => {
    const model = base(modelId, blockName, options) as GeneratorModel & Record<string, any>;
    if (blockName !== COORDINATOR_JUDGMENT) return model;
    const record = (opts: { tools?: unknown }): JudgmentCall => {
      const tools = opts.tools;
      const names = Array.isArray(tools)
        ? tools.map((tool) => String((tool as { name?: unknown }).name))
        : Object.keys((tools ?? {}) as object);
      const call: JudgmentCall = { tools: names };
      calls.push(call);
      return call;
    };
    const runProbe = async (armed: { tool: string; args: unknown }, tools: unknown, recorded: JudgmentCall) => {
      if (ran || !Array.isArray(tools)) return;
      const execute = (tools as Array<{ name?: unknown; execute?: (args: unknown) => Promise<unknown> }>).find(
        (entry) => entry.name === armed.tool,
      )?.execute;
      if (execute === undefined) return;
      ran = true;
      recorded.probed = await execute(armed.args);
    };
    const wrapped: Record<string, unknown> = { ...model };
    // Every way a generator calls a model: the loop it runs itself, and the
    // framework-owned steps, streamed or not. A probe runs on the non-streamed
    // calls; a streamed call only records, so its return stays synchronous.
    for (const method of ["generate", "stream", "generateStep", "streamStep"] as const) {
      const invoke = model[method];
      if (typeof invoke !== "function") continue;
      wrapped[method] = (opts: any) => {
        const recorded = record(opts);
        if (probe === undefined || method === "stream" || method === "streamStep") return invoke.call(model, opts);
        return runProbe(probe, opts.tools, recorded).then(() => invoke.call(model, opts));
      };
    }
    return wrapped as unknown as GeneratorModel;
  };
}

/** The model-free path's model: every call answers {@link QUIET_TURN} and calls no tool. */
function quietModel(modelId: string): GeneratorModel {
  return {
    modelId,
    generate: async () => ({ text: QUIET_TURN, finishReason: "stop" }),
  } as unknown as GeneratorModel;
}

/**
 * Read the tree, build the flows, hire, and open the manager's conversation.
 *
 * @param options The stores, the outbox, the model, and any arm or control.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any record refuses at the hire —
 *   both deliberately fatal: nothing is hired and nothing is registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const roster = await loadTree(LAB_TREE);

  // The records the installation is handed. Every arm and control mutates a
  // COPY here, before the hire, so the tree on disk stays the oracle.
  const kindOverrides = options.kindOverrides ?? {};
  let workers: WorkerManifest[] = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(kindOverrides, worker.id)) declared.flow = kindOverrides[worker.id];
    if (options.managerTools !== undefined && declared.flow === COORDINATOR_FLOW) {
      declared.tools = options.managerTools;
    }
    return { ...worker, declared };
  });
  const builderIds = roster.workers
    .filter((worker) => worker.declared.flow === BUILDER_KIND)
    .map((worker) => worker.id);
  if (options.swapBuilders === true) {
    const [first, second] = builderIds;
    const a = workers.find((worker) => worker.id === first);
    const b = workers.find((worker) => worker.id === second);
    if (a === undefined || b === undefined) throw new Error(`cannot swap ${first} and ${second}: not both hired`);
    workers = workers.map((worker) =>
      worker.id === first
        ? { ...b, id: first }
        : worker.id === second
          ? { ...a, id: second }
          : worker,
    );
  }

  const managerRecord = workers.find((worker) => worker.declared.flow === COORDINATOR_FLOW);
  if (managerRecord === undefined) {
    throw new Error(`the tree at ${LAB_TREE} hired no worker onto the "${COORDINATOR_FLOW}" flow`);
  }

  // The hold: a turn waits while it is set.
  let gateOpen: Promise<void> = Promise.resolve();
  let openGate: () => void = () => undefined;
  let waiting = 0;
  const gate = async () => {
    waiting += 1;
    try {
      await gateOpen;
    } finally {
      waiting -= 1;
    }
  };

  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers,
    workerFlows: () => workerFlows as never,
  });
  const model = options.model ?? "lab/quiet";
  const builder = defineBuilderWorkerFlow({
    installation,
    outbox: options.outbox,
    gate,
    ...(options.builderTakesTasks === false ? { takesTasks: false } : {}),
  });
  const coordinator = defineCoordinatorFlow({
    installation,
    routeModel: model,
    agent: { catalog: { [NOTE_TOOL]: noteTool() } as never, model },
  });
  // The twin's `work` is gated elsewhere and takes no task, so it declares no role.
  workerFlows = {
    [COORDINATOR_FLOW]: coordinator,
    [BUILDER_KIND]: options.builderTakesTasks === false ? builder : { flow: builder, roles: ["contributor"] },
  };

  // Refuses the WHOLE roster when any worker would be refused on its turn,
  // naming the worker. Nothing is registered partially.
  const copies = hireWorkforce(installation);
  const instances: Record<string, FlowInstance> = Object.fromEntries(
    copies.map((copy) => [copy.id === ROSTER_FLOW ? "roster" : copy.id, copy]),
  );
  const hired = Object.fromEntries(workers.map((worker) => [worker.id, String(worker.declared.flow)]));

  const judgmentCalls: JudgmentCall[] = [];
  // One resolver: wrapped to observe judgment calls, keeping its own properties.
  const live = options.model === undefined ? undefined : createModelResolver();
  const base = live === undefined ? (modelId: string) => quietModel(modelId) : (live as unknown as (m: string, b?: string, o?: unknown) => GeneratorModel);
  const probe =
    options.probe === undefined ? undefined : { tool: options.probe.tool, args: options.probe.input(builderIds) };
  const resolver = Object.assign(observing(base, judgmentCalls, probe), live ?? {});

  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: options.stores } },
    modelResolver: resolver,
    // The verified caller, as an app's auth would supply it.
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: LAB_ORG_ID } : null;
    },
  } as never);
  const runtime = await state.getRuntime();
  if (options.logger !== undefined) {
    (runtime.runtimeConfig as { logger?: unknown }).logger = options.logger;
  }

  // The manager's conversation, opened through the session route as its user
  // opens one: the installation's create check runs and names the worker.
  // Every action after goes through the same router, as the user's app sends
  // it (`actingAs`), and its answer is read back from the ended request.
  const http = actingAs(await state.getRouter(), LAB_USER_ID);
  const conversation = await http.open(COORDINATOR_FLOW, { workerId: managerRecord.id });

  const act = async (actionName: string, input: unknown): Promise<{ output?: any; error?: string }> => {
    try {
      return { output: await http.act(COORDINATOR_FLOW, conversation, actionName, input) };
    } catch (error) {
      return { error: messageOf(error) };
    }
  };

  return {
    roster,
    hired,
    managerId: managerRecord.id,
    builderIds,
    conversation,
    judgmentCalls,

    say: async (message: string) => {
      // Sent and left to run: a model's turn may outlast `act`'s wait, so the
      // caller waits for the host to go idle instead.
      const sent = await http.call("POST", [COORDINATOR_FLOW, conversation, "actions", "respond"], {
        userId: LAB_USER_ID,
        input: { message },
      });
      return sent.status === 202 ? {} : { error: `run was refused (${sent.status}): ${sent.text}` };
    },

    act,

    filingSessionId: async () => {
      const listed = await act("listDelegates", {});
      if (listed.error !== undefined) throw new Error(`listDelegates: ${listed.error}`);
      return String(listed.output?.filingSessionId);
    },

    rows: async () => {
      const entries = await runtime.stores.resourceState.getByPrefix(
        "user",
        `${LAB_USER_ID}:~org:${LAB_ORG_ID}`,
        "tasks/",
      );
      return Object.entries(entries).map(([key, value]) => ({
        ...((value as unknown as { state: Task }).state),
        partition: key.split("/")[1]!,
      }));
    },

    workLines: () => readWorkLines(options.outbox),

    session: async (sessionId: string) =>
      (await runtime.stores.session.get(sessionId)) as Record<string, any> | undefined,

    requestsOf: async (sessionId: string) =>
      ((await runtime.stores.request.list({ sessionId, withItems: true } as never)) as Array<Record<string, any>>).sort(
        (a, b) => a.createdAt - b.createdAt,
      ),

    settled: () => untilIdle(runtime.stores as never),

    hold: () => {
      gateOpen = new Promise((resolve) => {
        openGate = resolve;
      });
    },
    release: () => {
      openGate();
      gateOpen = Promise.resolve();
    },
    heldTurns: () => waiting,

    dispose: () => state.dispose(),
  };
}

/** A stored row's partition, as the board encodes the filing session into it. */
export function partitionOf(filingSessionId: string): string {
  return encodeUserSegment(filingSessionId);
}

/** Read the outbox back, one JSON line per finished task. */
function readWorkLines(outbox: string): WorkLine[] {
  if (!existsSync(outbox)) return [];
  return readFileSync(outbox, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => workLineSchema.parse(JSON.parse(line)));
}

/** One wording for whatever a refusal turns out to be. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
