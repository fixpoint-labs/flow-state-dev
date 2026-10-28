/**
 * A worker's delegates on the flow it runs on (FIX-1802 S3): the four
 * actions that read and change a session's list, the same four as tools, and
 * the list as a task sees it.
 *
 * Any worker whose file lists `delegates:` has them, on any flow that carries
 * this module: the built-in `agent` flow, the coordinator, and an app's own
 * worker flow through `defineSessionBoard`. A coordinator routes its users'
 * messages to them as tasks (FIX-2083); any worker files tasks for the ones
 * that take one, and for no one else (FIX-2081). Every add and every use runs the one check
 * (`./delegate-check`).
 *
 * The list is server-written session state (`./delegate-list`): copied from
 * the worker's `delegates:` the first time it is read or changed, changed
 * only by these actions and tools, and never seeded by a session create.
 * `delegates: all` is the user's roster as it stands, read on every call and
 * never copied by a read (D2).
 *
 * **Who changes the list** (FIX-2081, rule 13): the user, through the
 * actions. A model gets `listDelegates` on every worker with a board, and
 * `addDelegate`, `removeDelegate` and `setFallback` only on a coordinator
 * whose file sets `editsOwnDelegates: true` ({@link
 * WorkerDelegates.toolsCapability}). Those three refuse at the call too.
 */
import { defineCapability, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { DELEGATES_STATE } from "./delegate-keys";
import { z } from "zod";
import { filingSessionIdOf } from "../conversation-board/filing-session";
import { turnConfigOf, verifiedWorkerOf, workerConfigOf } from "../workers/verified-worker";
import { WORKER_ID_STATE_KEY } from "../workers/keys";
import type { WorkerInstallation } from "../workers/installation";
import { DELEGATE_TAKES, createDelegateCheck, flowTakes, type DelegateTakes } from "./delegate-check";
import { ADD_DELEGATE, ALL_DELEGATES, LIST_DELEGATES, MAX_DELEGATES, REMOVE_DELEGATE, SET_FALLBACK } from "./delegate-keys";
import {
  changeDelegates,
  currentDelegates,
  delegateRecordSchema,
  delegateSessionStateSchema,
  delegateRefSchema,
  readDelegates,
  type DelegateChange,
  type DelegateDefaults,
  type DelegateList,
  type DelegateRecord
} from "./delegate-list";

/** The running session's delegates as a task sees them: who takes one now, and why the rest can't. */
export interface TaskDelegates {
  /** Each delegate that takes a task now, by worker id, with the flow it runs on. */
  readonly available: ReadonlyMap<string, string>;
  /** Each delegate on the list that can't take a task now, by worker id, with why. */
  readonly unavailable: ReadonlyMap<string, string>;
  /**
   * The list's records, as read now: a worker with a target on its record
   * leads that workstream here, and a task for that record names it
   * (`target`, FIX-2083).
   */
  readonly records: readonly DelegateRecord[];
}

/**
 * The one delegate a task filed with no assignee goes to: the only one that
 * takes a task now. `undefined` with none or several, so the task waits
 * unassigned (or a scheduled fire is refused) until one is named.
 */
export function soleTaskDelegate(delegates: Pick<TaskDelegates, "available">): string | undefined {
  return delegates.available.size === 1 ? [...delegates.available.keys()][0] : undefined;
}

/** What a worker's delegates are built from. */
export interface WorkerDelegatesOptions {
  /** The worker installation the session's worker, and its delegates, belong to. */
  readonly installation: WorkerInstallation;
  /** The worker flow the session runs on: its worker is loaded on it. */
  readonly flowKind: string;
  /**
   * The records a session starts with beside its worker's defaults, read the
   * first time its delegates are read or changed and copied in then, never
   * after. A project coordinator's are one per workstream its user has open
   * in its project. Answer `undefined` for a session that takes none.
   */
  readonly seed?: (ctx: BlockContext) => Promise<readonly DelegateRecord[] | undefined>;
}

const delegateListOutputSchema = z.object({
  delegates: z.array(delegateRecordSchema),
  fallback: delegateRefSchema.nullable(),
  max: z.number(),
  /**
   * This session's `filingSessionId`: what each of its delegates' sessions
   * carries, and what `findWorkerSession({ worker, filingSessionId })` takes.
   */
  filingSessionId: z.string()
});

/**
 * What `listDelegates` answers: the list, each delegate with what it does (its
 * worker's description, or null) and what it takes now, read and never stored.
 */
const delegateReadOutputSchema = delegateListOutputSchema.extend({
  delegates: z.array(
    delegateRecordSchema.extend({ description: z.string().nullable(), takes: z.enum(DELEGATE_TAKES) })
  )
});

/** A session's delegates, and the session's `filingSessionId`. */
type Listed = { list: DelegateList; filingSessionId: string };

/** A delegate list as the actions and tools answer it. */
function listOutput(listed: Listed) {
  return {
    delegates: listed.list.delegates,
    fallback: listed.list.fallback,
    max: MAX_DELEGATES,
    filingSessionId: listed.filingSessionId
  };
}

/**
 * The defaults a worker's configuration names: its `delegates:`, and a
 * coordinator's `fallback:`. `delegates: all` comes back `all: true` with no
 * names; {@link withRoster} fills them from the roster for one call.
 */
export function delegateDefaultsOf(config: Readonly<Record<string, unknown>>): DelegateDefaults {
  const all = config.delegates === ALL_DELEGATES;
  const delegates = Array.isArray(config.delegates) ? (config.delegates as string[]) : [];
  return {
    delegates,
    ...(all ? { all: true } : {}),
    ...(typeof config.fallback === "string" ? { fallback: config.fallback } : {})
  };
}

/** Whether the running turn's worker may change its own delegates: a coordinator set so at hire (FIX-2081). */
function editsOwnDelegates(config: Readonly<Record<string, unknown>>): boolean {
  return config.editsOwnDelegates === true;
}

/**
 * `defaults` with `delegates: all` read as the user's roster now, the worker
 * itself included (FIX-2081 D2): read per call, never memoized, so a hire
 * counts on the next call and a fired worker drops off it.
 */
export async function withRoster(
  installation: WorkerInstallation,
  ctx: BlockContext,
  defaults: DelegateDefaults
): Promise<DelegateDefaults> {
  if (defaults.all !== true) return defaults;
  const roster = await installation.roster(ctx as never);
  return { ...defaults, delegates: roster.map((worker) => worker.id) };
}

/**
 * Build a worker's delegates for the flow it runs on.
 *
 * @param options The installation, the flow's name, and the session's seed.
 */
export function defineWorkerDelegates(options: WorkerDelegatesOptions) {
  const { installation, flowKind } = options;
  const check = createDelegateCheck(installation);
  const resources = { ...installation.resources };

  /**
   * `defaults` with the flow's seed beside them, while the session's list
   * has never been written: once it has, the seed is never read again.
   */
  const seeded = async (ctx: BlockContext, defaults: DelegateDefaults): Promise<DelegateDefaults> => {
    if (options.seed === undefined) return defaults;
    const stored = (ctx.session.state as Record<string, unknown> | undefined)?.[DELEGATES_STATE];
    if (stored !== null && stored !== undefined) return defaults;
    const records = await options.seed(ctx);
    return records === undefined ? defaults : { ...defaults, records };
  };

  /** The session's worker's defaults, loaded now, with the seed. Refuses a session that names no worker. */
  const ownerDefaults = async (ctx: BlockContext): Promise<DelegateDefaults> =>
    withRoster(installation, ctx, await seeded(ctx, delegateDefaultsOf((await installation.resolveWorker(ctx, flowKind)).config)));

  /**
   * The defaults of the worker this turn runs as: the one its request loaded;
   * on a flow that loads none before this is read, the session's worker,
   * loaded now; and on a block run outside any worker's session, the flow
   * copy's own settings, as the turn reads them (`turnConfigOf`).
   */
  const turnDefaults = async (ctx: BlockContext): Promise<DelegateDefaults> => {
    if (verifiedWorkerOf(ctx.session) !== undefined) {
      return withRoster(installation, ctx, await seeded(ctx, delegateDefaultsOf(workerConfigOf(ctx))));
    }
    const named = (ctx.session.state as Record<string, unknown> | undefined)?.[WORKER_ID_STATE_KEY];
    return typeof named === "string" ? ownerDefaults(ctx) : withRoster(installation, ctx, delegateDefaultsOf(turnConfigOf(ctx)));
  };

  /** Whether this turn's worker was set at hire to change its own delegates (FIX-2081, rule 13). */
  const turnEditsOwn = (ctx: BlockContext): boolean =>
    editsOwnDelegates(verifiedWorkerOf(ctx.session) !== undefined ? workerConfigOf(ctx) : turnConfigOf(ctx));

  /** The refusal a delegate-changing tool answers on a worker not set to change its own. */
  const notOwnToChange = {
    refused:
      "This worker's delegates are changed by its user, not by this worker: it wasn't set at hire to change " +
      "its own (editsOwnDelegates). Ask the user, or message whoever filed your task. Nothing was changed."
  };

  type Changed = ({ ok: true } & Listed) | { ok: false; message: string };

  /** A change's outcome, with the session's `filingSessionId` beside a list that landed. */
  const withFiling = async (ctx: BlockContext, outcome: Awaited<ReturnType<typeof changeDelegates>>): Promise<Changed> =>
    outcome.ok ? { ok: true, list: outcome.list, filingSessionId: await filingSessionIdOf(ctx.session) } : outcome;

  const addInputSchema = z.object({ worker: z.string().min(1), note: z.string().min(1).optional() }).strict();
  const nameInputSchema = z.object({ worker: z.string().min(1) }).strict();
  const fallbackInputSchema = z.object({ worker: z.string().min(1).nullable() }).strict();

  const add = async (ctx: BlockContext, input: z.infer<typeof addInputSchema>): Promise<Changed> => {
    const defaults = await ownerDefaults(ctx);
    const checked = await check(ctx, input.worker, "add");
    if (!checked.ok) return checked;
    const record: DelegateRecord = { worker: input.worker, ...(input.note === undefined ? {} : { note: input.note }) };
    return withFiling(ctx, await changeDelegates(ctx.session, defaults, { add: record }));
  };
  const change = async (ctx: BlockContext, delegateChange: DelegateChange): Promise<Changed> => {
    const defaults = await ownerDefaults(ctx);
    return withFiling(ctx, await changeDelegates(ctx.session, defaults, delegateChange));
  };
  const list = async (ctx: BlockContext): Promise<Listed> => {
    const defaults = await ownerDefaults(ctx);
    return { list: await readDelegates(ctx.session, defaults), filingSessionId: await filingSessionIdOf(ctx.session) };
  };
  /**
   * The list as `listDelegates` answers it, each delegate with what it does and
   * what it takes now, from the roster row the check reads: its worker's
   * description and what its flow takes. One that fails the check for an add
   * (fired, or on a flow that takes no task) takes nothing, with no description.
   */
  const read = async (ctx: BlockContext) => {
    const listed = listOutput(await list(ctx));
    const delegates: Array<DelegateRecord & { description: string | null; takes: DelegateTakes }> = [];
    for (const record of listed.delegates) {
      const checked = await check(ctx as never, record.worker, "add");
      delegates.push(
        checked.ok
          ? { ...record, description: checked.worker.description, takes: flowTakes(installation, checked.worker.flow) }
          : { ...record, description: null, takes: "nothing" }
      );
    }
    return { ...listed, delegates };
  };

  /** Throw a refusal, for the actions. */
  const orRefuse = (changed: Changed) => {
    if (!changed.ok) throw new Error(changed.message);
    return listOutput(changed);
  };
  /** Hand a refusal back as a value, for the tools: a model can read it and recover. */
  const orTell = (changed: Changed) => (changed.ok ? listOutput(changed) : { refused: changed.message });

  const toolOutputSchema = z.union([delegateListOutputSchema, z.object({ refused: z.string() })]);
  const blockBase = { resources, sessionStateSchema: delegateSessionStateSchema };

  const addDelegateAction = handler({
    name: "delegates-add",
    inputSchema: addInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orRefuse(await add(ctx as never, input))
  });
  const removeDelegateAction = handler({
    name: "delegates-remove",
    inputSchema: nameInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => orRefuse(await change(ctx as never, { remove: { worker: input.worker } }))
  });
  const setFallbackAction = handler({
    name: "delegates-set-fallback",
    inputSchema: fallbackInputSchema,
    outputSchema: delegateListOutputSchema,
    ...blockBase,
    execute: async (input, ctx) =>
      orRefuse(await change(ctx as never, { fallback: input.worker === null ? null : { worker: input.worker } }))
  });
  const listDelegatesAction = handler({
    name: "delegates-list",
    inputSchema: z.object({}).strict(),
    outputSchema: delegateReadOutputSchema,
    ...blockBase,
    execute: async (_input, ctx) => read(ctx as never)
  });

  const addDelegateTool = handler({
    name: ADD_DELEGATE,
    description:
      "Add a worker on this user's roster to this conversation's delegates, by its id, with an optional note on what it's good at.",
    inputSchema: addInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) => (turnEditsOwn(ctx as never) ? orTell(await add(ctx as never, input)) : notOwnToChange)
  });
  const removeDelegateTool = handler({
    name: REMOVE_DELEGATE,
    description: "Remove a delegate from this conversation, by its worker id.",
    inputSchema: nameInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) =>
      turnEditsOwn(ctx as never) ? orTell(await change(ctx as never, { remove: { worker: input.worker } })) : notOwnToChange
  });
  const setFallbackTool = handler({
    name: SET_FALLBACK,
    description:
      "Set the delegate that takes a post best fit can't place, by its worker id, or clear it with null.",
    inputSchema: fallbackInputSchema,
    outputSchema: toolOutputSchema,
    ...blockBase,
    execute: async (input, ctx) =>
      turnEditsOwn(ctx as never)
        ? orTell(await change(ctx as never, { fallback: input.worker === null ? null : { worker: input.worker } }))
        : notOwnToChange
  });
  const listDelegatesTool = handler({
    name: LIST_DELEGATES,
    description:
      "Read who this conversation's delegates are: every one, with its note, what it does (`description`), what it takes (`tasks`, or `nothing`), the workstream it leads here when its record names one (`target`), and the fallback. Answer who your delegates are from this, never from memory.",
    inputSchema: z.object({}).strict(),
    outputSchema: delegateReadOutputSchema,
    ...blockBase,
    execute: async (_input, ctx) => read(ctx as never)
  });

  /**
   * The session's delegates as a task sees them, read now: each that takes a
   * task, with its flow, and why each other one can't, beside the records
   * themselves. A record with a target is a workstream its worker leads: a
   * task for it names that target (FIX-2083), which the board checks. Read
   * per call, from the list the session holds now, so an add or a remove
   * counts on the next one.
   */
  const taskDelegates = async (ctx: BlockContext): Promise<TaskDelegates> => {
    const listed = currentDelegates(ctx.session.state, await turnDefaults(ctx));
    const available = new Map<string, string>();
    const unavailable = new Map<string, string>();
    for (const record of listed.delegates) {
      if (available.has(record.worker) || unavailable.has(record.worker)) continue;
      const checked = await check(ctx as never, record.worker, "task");
      if (checked.ok) available.set(record.worker, checked.worker.flow);
      else unavailable.set(record.worker, checked.message);
    }
    return { available, unavailable, records: listed.delegates };
  };

  /**
   * The delegate tools on a model's turn (FIX-2081, rule 13): `listDelegates`
   * on every turn, and `addDelegate`, `removeDelegate` and `setFallback` only
   * on a coordinator set at hire to change its own (`editsOwnDelegates`),
   * read per call. `controlTools`, so a worker's `tools:` line doesn't fence
   * them out. Compose it once per turn.
   */
  const toolsCapability = defineCapability({
    name: "delegateTools",
    presets: {
      tools: {
        controlTools: async (ctx) =>
          turnEditsOwn(ctx as never)
            ? [listDelegatesTool, addDelegateTool, removeDelegateTool, setFallbackTool]
            : [listDelegatesTool]
      },
      default: ["tools"]
    }
  });

  return {
    /** The one check, for an add or a task. */
    check,
    /** The session's worker's defaults, with the flow's seed while its list was never written. */
    defaults: ownerDefaults,
    /** The session's delegates as a task sees them, read now. */
    taskDelegates,
    /** The four delegate actions, for the flow's `actions`. */
    actions: {
      [ADD_DELEGATE]: {
        inputSchema: addInputSchema,
        block: addDelegateAction,
        description: "Add a worker on your roster to this conversation's delegates."
      },
      [REMOVE_DELEGATE]: {
        inputSchema: nameInputSchema,
        block: removeDelegateAction,
        description: "Remove a delegate from this conversation."
      },
      [SET_FALLBACK]: {
        inputSchema: fallbackInputSchema,
        block: setFallbackAction,
        description: "Set or clear this conversation's fallback delegate."
      },
      [LIST_DELEGATES]: {
        inputSchema: z.object({}).strict(),
        block: listDelegatesAction,
        description: "Read this conversation's delegates and its fallback."
      }
    },
    /** The same four as tools: `listDelegates`, `addDelegate`, `removeDelegate`, `setFallback`. The three that change refuse unless the worker manages its own. */
    tools: [listDelegatesTool, addDelegateTool, removeDelegateTool, setFallbackTool] as const,
    /** The delegate tools a model's turn is offered, per call: `listDelegates`, and the three that change only where the worker manages its own. */
    toolsCapability
  };
}

export type WorkerDelegates = ReturnType<typeof defineWorkerDelegates>;
