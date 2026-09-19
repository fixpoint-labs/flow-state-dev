/**
 * The lab itself — one module both checks import, so the model-free contract
 * gate and the model-backed goal check drive the *same* tree, hire and wiring
 * and differ by one block.
 *
 * What `openLab` does, in order, and nothing else: read the tree, build the
 * kinds, hire, register, open the channel, hand back handles. Every file it
 * reads is found by walking from one root; no file is named in this code.
 *
 * ## The three things that are the lab's rather than the framework's
 *
 * 1. **The two kinds.** `coordinator` files, `builder` drains. The framework
 *    has no opinion about either, and neither is a convention that is missing.
 * 2. **The assignee-to-seat map.** It is the app's, and this host is the app.
 *    See {@link OpenLabOptions.assignees} — it is the thing under test, and
 *    keeping it here rather than in the tree is what makes it perturbable.
 * 3. **The refusal policy.** `readDeclaredRoster` collects rather than throws,
 *    which is right for a library and wrong here: a seat that failed to load is
 *    a seat this lab does not have, and a short roster that still runs is the
 *    failure BR-1 exists to exclude.
 *
 * ## What is NOT here, and is the point
 *
 * There is no ledger id anywhere in this file, and no `boards:` wiring. The
 * channel's own `CHANNEL.md` declares a board by local name; the framework
 * mints the id from where the folder sits, `channelBoardIds` reads it back, and
 * `channelBoard(channel.id, name)` is how the seats reach the same rows. A
 * check greps every file under this lab for the minted string, and a hit is a
 * failure — including a hit in this comment, which is why the id is not written
 * out here either.
 */

import { createFlowState, runAction } from "@flow-state-dev/engine";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  hireWorkforce,
  openChannels,
  type ChannelBoardCollection,
  type ChannelManifest,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { discoverSeatBlocks } from "@flow-state-dev/workforce/codegen";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUILDER_KIND,
  DRAIN_ENTRY,
  HOLD_ENTRY,
  defineBuilderWorkerFlow,
  workLineSchema,
  type WorkLine,
} from "./workforce/flows/workers/builder.mts";
import {
  BLOCK_ENTRY,
  COORDINATOR_KIND,
  INTAKE_ENTRY,
  QUEUE_ENTRY,
  ROWS_ENTRY,
  SETTLE_ENTRY as COORDINATOR_SETTLE_ENTRY,
  defineCoordinatorWorkerFlow,
} from "./workforce/flows/workers/coordinator.mts";
import type { HiredSeat, QueueView } from "./queue.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the lab runs as, and the org every channel session and board is bound to. */
export const LAB_USER_ID = "u_manager_queue_lab";
export const LAB_ORG_ID = "org_manager_queue_lab";

/**
 * The drain width the lab runs at, and the whole of the switch.
 *
 * **One knob, no edit to the tree and none to the checks** (BR-17). At `1` a
 * second row for a busy desk queues behind the first; above `1` the seat takes
 * a second copy.
 *
 * **The epic ruled `1`** (2026-09-19): a busy seat never takes a second row
 * concurrently, and the lab is pinned to it. A seat is a roster slot that mints
 * a flow instance, and one running two rows at once is a pool rather than a
 * seat; the seat is also what carries a `WORKER.md`, a persona and memory, so
 * interleaving two rows inside one breaks the coherence the seat exists to
 * hold. The live inventory asks *which seats are busy*, which means nothing
 * unless busy excludes.
 *
 * The knob stays because the ruling is reversible and because it is how the
 * negative case stays reachable — the "extra one waits" leg has no evidence at
 * all above width 1.
 *
 *     MANAGER_QUEUE_DRAIN_WIDTH=2 pnpm tsx goals/manager-queue-lab/<goal>/run.mts
 */
export const DRAIN_WIDTH_ENV = "MANAGER_QUEUE_DRAIN_WIDTH";

/** Read the switch. Anything unparseable is the default rather than a throw. */
export function drainWidthFromEnv(fallback = 1): number {
  const parsed = Number(process.env[DRAIN_WIDTH_ENV] ?? fallback);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * Read a workforce tree into records, refusing a tree that did not load
 * cleanly.
 *
 * The refusal is this lab's own policy, which is why it lives here and not
 * behind the shared reader — and it names every problem in one pass, because a
 * lab that boots short proves something other than what it claims.
 */
async function loadTree(root: string): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((problem) =>
      problem.worker === undefined
        ? `${problem.layer} ${problem.path}: ${problem.error.message}`
        : `${problem.layer} ${problem.path} (seat ${problem.worker}): ${problem.error.message}`,
    );
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  return roster;
}

/**
 * Register the blocks a seat's own folders hold, by walking the tree and
 * importing what it finds.
 *
 * `fsdev gen` renders this map at build time from the same walk; a lab that ran
 * the generator would be testing the generator. This does the last hop itself —
 * discover, then import — so BR-3's refusal is reached by a real tree with a
 * real block in a real seat folder, rather than by a hand-built map asserting
 * what such a tree would have produced.
 */
async function loadSeatBlocks(
  root: string,
): Promise<Record<string, Record<string, BlockDefinition<any, any>>>> {
  const discovery = await discoverSeatBlocks(root);
  if (discovery.problems.length > 0) {
    throw new Error(`the tree at ${root} holds a bad blocks folder:\n  - ${discovery.problems.join("\n  - ")}`);
  }
  const registry: Record<string, Record<string, BlockDefinition<any, any>>> = {};
  for (const found of discovery.seatBlocks) {
    const module = (await import(pathToFileURL(join(root, found.path)).href)) as Record<
      string,
      unknown
    >;
    const block = (module.default ?? Object.values(module)[0]) as BlockDefinition<any, any>;
    (registry[found.seat] ??= {})[found.name] = block;
  }
  return registry;
}

export interface OpenLabOptions {
  /** The store adapter this lab runs over — `inMemoryStores()` for both checks. */
  stores: unknown;
  /**
   * Seat id -> desk key. **The implementation under test.**
   *
   * Defaults to each builder seat's own declared `answersFor`, which is the
   * correct wiring; VG's negative control passes a map with one entry pointed
   * at a different declared seat. The tree is untouched either way, so the
   * oracle does not move with it — which is the only reason the control can go
   * red at the leg that grades identity.
   */
  assignees?: Record<string, string>;
  /**
   * The model resolver. Omitted by the contract gate, which never runs the
   * generator at all; supplied by the goal check.
   */
  modelResolver?: unknown;
  /** The model a seat that names none runs on. */
  defaultModel?: string;
  /** The tree to read. Defaults to the lab's own — a refusal tree overrides it. */
  root?: string;
  /** How many rows one seat runs at once. Defaults to the env switch. */
  drainWidth?: number;
  /** Where finished work leaves its lines. */
  outbox: string;
  /** Silence the engine's own logging. */
  logger?: unknown;

  // ---- controls, each the red state of one claim -------------------------

  /**
   * Rewrite one seat's `flow:` line before the mint — BR-1's negative control.
   *
   * Pointed at a kind nobody registered, the WHOLE roster refuses and names the
   * seat. Nothing is returned partially, which is what stops a refusal leaving
   * a short roster running — the failure a lab that boots three seats out of
   * four proves nothing about.
   */
  kindOverrides?: Record<string, string>;
  /**
   * Build the coordinator kind with the board capability left out — BR-2's
   * twin.
   *
   * It hires just as cleanly, holds none of the eight, and never writes the
   * ledger. A missing grant is in no failure class at all, which is why the
   * twin is graded on a tool set and an unwritten ledger rather than on a
   * refusal.
   */
  composeBoard?: boolean;
  /**
   * Which door the eight tools arrive through — BR-2's red state.
   *
   * `"catalog"` routes them through the fenced `tools` bucket instead of
   * composing the capability. The tree is untouched; only the wiring moves, and
   * the `tools: []` arm goes red because that is what the other door costs.
   */
  door?: "capability" | "catalog";
}

/** Everything a check needs to drive and observe one lab. */
export interface Lab {
  roster: DeclaredRoster;
  /** The hired seats, by id. */
  seats: Record<string, FlowInstance>;
  /** The coordinator seat's id, read off the tree rather than named. */
  coordinatorId: string;
  /** The builder seat ids, in tree order. */
  builderIds: string[];
  /** The channel's id, as the tree minted it. */
  channelId: string;
  /** The board's LOCAL name, as the `CHANNEL.md` wrote it. */
  boardName: string;
  /** The MINTED ledger id. Appears in no file — a check greps for it. */
  boardId: string;
  /** The seat map this lab was actually wired with. */
  assignees: Record<string, string>;
  /** The desk keys the board has a body for, read off the tree. */
  desks: string[];
  /** The drain width this lab is running at. */
  drainWidth: number;
  /** The generator the coordinator files through, for reading its tool names. */
  intake: BlockDefinition<any, any>;

  /** Hand the coordinator a list of work and let it file. Runs the model. */
  intakeWork(work: string[]): Promise<{ error?: string }>;
  /** File one row through the CHANNEL's own action — the other door (BR-8, BR-9). */
  fileThroughChannel(input: Record<string, unknown>): Promise<{ output?: unknown; error?: string }>;
  /** Make every builder seat work its share, at once. They share one board. */
  drainAll(): Promise<Array<{ seat: string; error?: string }>>;
  /** Read the queue through the coordinator's own action. Writes nothing. */
  queue(): Promise<QueueView>;
  /** Every row on the ledger, whole — the unredacted rows the view is derived from. */
  rows(): Promise<Task[]>;
  /** The lines finished work left behind, outside the board entirely. */
  workLines(): WorkLine[];
  /** One session record, straight out of the store — for reading parentage. */
  session(sessionId: string): Promise<Record<string, unknown> | undefined>;
  /** The session each seat's drain runs in. */
  drainSession(seatId: string): string;
  /** The hired seats as the queue view addresses them. */
  hiredSeats(): HiredSeat[];
  /**
   * Have a seat claim one of its rows on the minimum lease and walk away.
   *
   * The real path to a lapsed lease: nothing renews a claim made by hand, so
   * after `leaseMs` the row is one whose worker died — which is the state BR-10
   * reads as queued and BR-11 reads as an idle seat.
   */
  hold(seatId: string): Promise<{ taskId: string | null; leaseMs: number }>;
  /** Have the COORDINATOR settle a row it never claimed (BR-9). */
  coordinatorSettle(taskId: string): Promise<{ settled: boolean; refusal?: string }>;
  /** Block a row with a reason, so the *waiting on you* column has something to show. */
  blockRow(taskId: string, reason: string): Promise<{ blocked: boolean; refusal?: string }>;
  dispose(): Promise<void>;
}

/** What the drain session for a seat is called. One spelling, used everywhere. */
const drainSessionId = (seatId: string): string => `s_${seatId}`;

/**
 * Read the tree, build the kinds, hire, and open the channel.
 *
 * @param options The stores, the seat map, the drain width, and any controls.
 * @returns The live lab. Call `dispose()` when done.
 * @throws If the tree does not load, or if any record refuses at the mint — both
 *   deliberately fatal: nothing is hired and nothing is registered.
 */
export async function openLab(options: OpenLabOptions): Promise<Lab> {
  const root = options.root ?? LAB_TREE;
  const roster = await loadTree(root);
  const seatBlocks = await loadSeatBlocks(root);

  const channels: ChannelManifest[] = roster.channels;
  const channel = channels[0];
  if (channel === undefined) throw new Error(`the tree at ${root} declared no channel`);

  // Read off the FILE, never hardcoded. Rename the team folder, the channel
  // folder or the board and a correct implementation still passes.
  const boardName = (channel.declared.boards as string[] | undefined)?.[0];
  if (boardName === undefined) throw new Error(`channel "${channel.id}" declares no board`);
  const board: ChannelBoardCollection = channelBoard(channel.id, boardName);
  const boardId = board.id;

  // The control mutates the RECORD, before the mint, so a seat with a rewritten
  // fence genuinely hires with it rather than being graded as if it had.
  const kindOverrides = options.kindOverrides ?? {};
  const workers: WorkerManifest[] = roster.workers.map((worker) => {
    const declared = { ...worker.declared };
    if (Object.hasOwn(kindOverrides, worker.id)) declared.flow = kindOverrides[worker.id];
    return { ...worker, declared };
  });

  // Every builder record that declares a desk, in tree order. A record whose
  // `answersFor` is missing is left out here rather than coerced: it would
  // refuse at the mint anyway (the kind's schema requires the key), and
  // inventing a desk for it would hide that refusal behind a routing failure.
  const builderRecords = workers.filter(
    (worker) =>
      worker.declared.flow === BUILDER_KIND && typeof worker.declared.answersFor === "string",
  );

  // The board's desk vocabulary, read off the tree: which keys have a body.
  // Distinct from the seat map below — one stub runs every desk, so this
  // associates no key with any seat and is not the thing under test.
  const desks = builderRecords.map((worker) => String(worker.declared.answersFor));

  // THE MAP UNDER TEST. Its default agrees with the tree, which is what a
  // correct app would wire; the control passes one that does not.
  const assignees =
    options.assignees ??
    Object.fromEntries(
      builderRecords.map((worker) => [worker.id, String(worker.declared.answersFor)]),
    );

  const drainWidth = options.drainWidth ?? drainWidthFromEnv();

  const builderKind = defineBuilderWorkerFlow({
    board,
    desks,
    assignees,
    drainWidth,
    outbox: options.outbox,
  });

  const builderIds = workers
    .filter((worker) => worker.declared.flow === BUILDER_KIND)
    .map((worker) => worker.id);
  // Every other missing piece in `openLab` throws; this one used to fall back to
  // "" and then index `seats[""]`, which is undefined and fails somewhere else
  // entirely. Refuse where the fact is missing.
  const coordinatorRecord = workers.find((worker) => worker.declared.flow === COORDINATOR_KIND);
  if (coordinatorRecord === undefined) {
    throw new Error(`the tree at ${root} hired no seat onto the "${COORDINATOR_KIND}" kind`);
  }
  const coordinatorId = coordinatorRecord.id;

  const hiredSeats: HiredSeat[] = builderIds.map((id) => ({
    id,
    sessionId: drainSessionId(id),
  }));

  const coordinator = defineCoordinatorWorkerFlow({
    board,
    composeBoard: options.composeBoard ?? true,
    ...(options.door === undefined ? {} : { door: options.door }),
    ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
    seats: hiredSeats,
  });

  // Refuses the WHOLE roster when any record cannot be hired, naming the
  // worker. Nothing is returned partially, so a refusal cannot leave a short
  // roster running — which is where BR-3's seat-folder board lands.
  const hired = hireWorkforce(workers, {
    kinds: {
      [COORDINATOR_KIND]: coordinator.kind as never,
      [BUILDER_KIND]: builderKind as never,
    },
    seatBlocks,
    // Every minted id is declared by a hired seat, so this says nothing. A
    // warning on stderr here would mean a builder's declaration missed.
    channelBoards: channelBoardIds(channels),
  });
  const seats: Record<string, FlowInstance> = Object.fromEntries(
    hired.map((seat) => [seat.id, seat]),
  );

  const instances = channelInstances(channels);

  const state = createFlowState({
    flows: {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...Object.fromEntries(hired.map((seat) => [seat.id, seat])),
    },
    stores: { default: { primary: options.stores } },
    ...(options.modelResolver === undefined ? {} : { modelResolver: options.modelResolver }),
  } as never);

  const runtime = await state.getRuntime();
  if (options.logger !== undefined) {
    (runtime.runtimeConfig as { logger?: unknown }).logger = options.logger;
  }

  /**
   * The session client `openChannels` is handed.
   *
   * Direct store writes rather than the HTTP router: the route is
   * fire-and-forget and this needs the session to exist before the next line.
   * `orgId` is threaded through natively — a channel board is org-scoped
   * storage, so a channel opened without one holds a board nothing can read.
   */
  const client = {
    createSession: async (create: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      orgId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }) => {
      const id = String(create.sessionId);
      if ((await runtime.stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" exists`), { status: 409 });
      }
      const now = Date.now();
      await runtime.stores.session.set(
        id,
        {
          id,
          flowKind: create.flowKind,
          flowId: create.flowKind,
          userId: create.userId,
          orgId: create.orgId,
          description: create.description,
          state: create.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: [],
        } as never,
        "absent",
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = (await runtime.stores.session.get(sessionId)) as
        | {
            flowKind: string;
            flowId?: string;
            userId: string;
            orgId?: string;
            state?: Record<string, unknown>;
          }
        | undefined;
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: found?.orgId,
        state: found?.state,
      };
    },
    deleteSession: async (sessionId: string) => {
      await runtime.stores.session.delete(sessionId);
    },
  };

  await openChannels(channels, { client, userId: LAB_USER_ID, orgId: LAB_ORG_ID });

  const channelInstance = instances.find((instance) => instance.kind === CHANNEL_KIND);
  if (channelInstance === undefined) {
    throw new Error(`the tree at ${root} produced no "${CHANNEL_KIND}" instance to act on`);
  }

  /**
   * Run one action and hand back what it returned.
   *
   * `runAction` rather than the HTTP route: the route is fire-and-forget (202
   * plus a request id) and carries no output, so reading an action's result off
   * it is not a thing that works. This is the same entry the route dispatches
   * into.
   */
  const act = async (
    flow: unknown,
    sessionId: string,
    actionName: string,
    input: unknown,
  ): Promise<{ output?: unknown; error?: unknown }> => {
    try {
      return (await runAction({
        flow,
        actionName,
        input,
        userId: LAB_USER_ID,
        orgId: LAB_ORG_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: unknown; error?: unknown };
    } catch (error) {
      // A refusal the substrate throws rather than returns. Returned like any
      // other refusal so a check can grade its wording instead of dying on it.
      return { error };
    }
  };

  return {
    roster,
    seats,
    coordinatorId,
    builderIds,
    channelId: channel.id,
    boardName,
    boardId,
    assignees,
    desks,
    drainWidth,
    intake: coordinator.intake as unknown as BlockDefinition<any, any>,

    intakeWork: async (work: string[]) => {
      const result = await act(
        seats[coordinatorId],
        drainSessionId(coordinatorId),
        INTAKE_ENTRY,
        { work },
      );
      return result.error === undefined ? {} : { error: messageOf(result.error) };
    },

    fileThroughChannel: async (input: Record<string, unknown>) => {
      const result = await act(channelInstance, channel.id, "fileTask", input);
      return result.error === undefined
        ? { output: result.output }
        : { error: messageOf(result.error) };
    },

    drainAll: async () => {
      // All three at once, and that is not a convenience. Each seat's drain
      // exits when nothing on the board is claimable AT ALL — the substrate's
      // idle probe reads the whole ledger, not one desk's slice — so draining
      // them one after another would have the first seat idle-poll until its
      // own iteration bound while another desk's rows sat waiting for a seat
      // that had not started. Three seats watching one board is also the
      // picture this lab is a proof of.
      const results = await Promise.all(
        builderIds.map(async (seatId) => {
          const result = await act(seats[seatId], drainSessionId(seatId), DRAIN_ENTRY, {});
          return result.error === undefined
            ? { seat: seatId }
            : { seat: seatId, error: messageOf(result.error) };
        }),
      );
      return results;
    },

    queue: async () => {
      const result = await act(
        seats[coordinatorId],
        drainSessionId(coordinatorId),
        QUEUE_ENTRY,
        {},
      );
      if (result.error !== undefined) throw new Error(`queue read: ${messageOf(result.error)}`);
      return result.output as QueueView;
    },

    rows: async () => {
      // Through the coordinator's own read, which resolves the same ledger the
      // seats drain — not through the channel's `readBoard`, whose published
      // allowlist deliberately drops `claimedBy` and `leaseUntil`, the two
      // fields the queue's running/queued split is computed from.
      const result = await act(
        seats[coordinatorId],
        drainSessionId(coordinatorId),
        ROWS_ENTRY,
        {},
      );
      if (result.error !== undefined) throw new Error(`rows read: ${messageOf(result.error)}`);
      return result.output as Task[];
    },

    hold: async (seatId: string) => {
      const result = await act(seats[seatId], drainSessionId(seatId), HOLD_ENTRY, {});
      if (result.error !== undefined) throw new Error(`hold: ${messageOf(result.error)}`);
      return result.output as { taskId: string | null; leaseMs: number };
    },

    coordinatorSettle: async (taskId: string) => {
      const result = await act(
        seats[coordinatorId],
        drainSessionId(coordinatorId),
        COORDINATOR_SETTLE_ENTRY,
        { taskId },
      );
      if (result.error !== undefined)
        throw new Error(`coordinator settle: ${messageOf(result.error)}`);
      return result.output as { settled: boolean; refusal?: string };
    },

    blockRow: async (taskId: string, reason: string) => {
      const result = await act(
        seats[coordinatorId],
        drainSessionId(coordinatorId),
        BLOCK_ENTRY,
        { taskId, reason },
      );
      if (result.error !== undefined) throw new Error(`block: ${messageOf(result.error)}`);
      return result.output as { blocked: boolean; refusal?: string };
    },

    workLines: () => readWorkLines(options.outbox),

    session: async (sessionId: string) =>
      (await runtime.stores.session.get(sessionId)) as Record<string, unknown> | undefined,

    drainSession: drainSessionId,

    hiredSeats: () => hiredSeats,

    dispose: () => state.dispose(),
  };
}

/** Read the outbox back, one JSON line per finished row. */
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
