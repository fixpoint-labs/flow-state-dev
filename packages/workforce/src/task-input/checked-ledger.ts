// FIX-2894.
/**
 * Every write that puts input on a task, or moves it to another worker, goes
 * through the one filing check (`./filing-check`): the board's own guarded
 * writes, and the raw ledger handles a task session is handed
 * (`filingConversationBoard()`, `conversationLedgers()`), whose
 * `createTask`, `createTasks`, `patchSettings` and `setAssignee` are routed
 * here.
 *
 * - **An edit or a move** ({@link checkedPatch}) is decided on one revision of
 *   the row and written only while the row is still there (a compare-and-set
 *   on `revision`). A conflict re-reads the row and runs the whole check
 *   again, at most three times, then refuses `input_conflict`. An edit within
 *   a flow keeps the stored server-owned values when the row's stamp
 *   matches; a move onto a declared flow, an assign, or an edit of a row
 *   stamped for another declaration, is a filing for that flow (D2).
 * - **Where a worker's flow and declaration come from**: a
 *   {@link TaskInputSource}, one per installation, keyed by the objects that
 *   name it and nothing else: the installation, and each of its flows' `work`
 *   doors ({@link registerTaskDoor}), in weak maps, so a dropped installation
 *   is never kept. The claim finds its source by its own door; a raw handle,
 *   by the source its session's request was noted with (when it resolved its
 *   worker or claimed its task). A handle with no source noted refuses a
 *   write it can't check, `input_unchecked`.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { TaskWriteRefusedError, type Task, type TaskCollectionRef, type TaskInit, type TaskSettingsPatch, type TaskWriteOutcome } from "@flow-state-dev/orchestration/tasks";
import type { TaskInputDeclaration, TaskInputRecord, TaskInputWorker } from "./declaration";
import { checkFiling, FILLED_FOR, filledForOf, stampMatches, type CheckedInput } from "./filing-check";

/** What the check reads about workers and flows, bound to one request. */
export interface InputLookup {
  /** The flow `assignee` runs on now, or `undefined` when it names no worker this filer reaches. */
  flowOf(assignee: string): Promise<string | undefined>;
  /** The declaration flow `flow`'s `work` entry carries, or `undefined` for a flow that declares none. */
  declarationOf(flow: string): TaskInputDeclaration | undefined;
  /** The worker, as the hooks are handed it. */
  workerOf(assignee: string): Promise<TaskInputWorker | undefined>;
  /** Whether a task with `input` has a project to work in, for a declaration that requires one. */
  hasProject(input: TaskInputRecord): Promise<boolean>;
  /** The `no_project` refusal for `assignee`. */
  noProject(assignee: string): string;
  /** The board's own rewrite of an input before the parse; none leaves it. */
  rewrite?(input: TaskInputRecord): TaskInputRecord;
}

/**
 * The filing check for a task for `assignee` with `sent` as its input, on a
 * filing (no kept values), or `undefined` when its flow declares nothing.
 */
export async function checkFiledInput(lookup: InputLookup, ctx: BlockContext, assignee: string, sent: unknown, flowOverride?: string): Promise<CheckedInput | undefined> {
  const flow = flowOverride ?? (await lookup.flowOf(assignee));
  // A worker whose flow can't be read now is no open flow: what it takes is unknown, so nothing is filed.
  if (flow === undefined) throw unresolved(assignee);
  const declaration = lookup.declarationOf(flow);
  if (declaration === undefined) return undefined;
  return checkFiling({
    ctx,
    declaration,
    flow,
    assignee,
    worker: await workerFor(lookup, assignee),
    sent,
    ...(lookup.rewrite === undefined ? {} : { rewrite: (input: TaskInputRecord) => lookup.rewrite!(input) }),
    hasProject: (input) => lookup.hasProject(input),
    noProject: () => lookup.noProject(assignee)
  });
}

/** The refusal for a write that names a worker whose flow can't be read now. */
function unresolved(assignee: string): TaskWriteRefusedError {
  return new TaskWriteRefusedError(
    "input_unchecked",
    `"${assignee}" isn't a worker this task can be checked against now, so what its tasks take can't be read. Nothing was filed.`
  );
}

/** `init` with its checked input and stamp, or as given on a flow that declares nothing. */
function withChecked<T extends TaskInit>(init: T, checked: CheckedInput | undefined): T {
  if (checked === undefined) return init;
  return { ...init, input: checked.input, metadata: { ...(init.metadata ?? {}), [FILLED_FOR]: checked.filledFor } };
}

/** How many conflicts an edit takes before it is refused. */
const MAX_CONFLICTS = 3;

/**
 * An edit of a row's input or assignee, checked on one revision of the row
 * and written with a compare-and-set on it. A patch that touches neither is
 * written as given.
 *
 * @param write The write itself: `patchSettings` on the ledger.
 * @throws TaskWriteRefusedError from the check, or `input_conflict` after three conflicts.
 */
export async function checkedPatch(
  lookup: InputLookup,
  ctx: BlockContext,
  ref: TaskCollectionRef,
  id: string,
  patch: TaskSettingsPatch,
  write: (id: string, patch: TaskSettingsPatch) => Promise<TaskWriteOutcome>
): Promise<TaskWriteOutcome> {
  if (patch.input === undefined && patch.assignee === undefined) return write(id, patch);
  for (let conflicts = 0; ; ) {
    await ref.refresh?.(id);
    const task = ref.get(id);
    // The write answers a task that isn't there, by its own rule.
    if (task === undefined) return write(id, patch);
    const outcome = await write(id, await decidedPatch(lookup, ctx, task, patch));
    if (outcome.outcome !== "declined" || outcome.reason !== "revision-moved") return outcome;
    conflicts += 1;
    if (conflicts >= MAX_CONFLICTS) {
      throw new TaskWriteRefusedError(
        "input_conflict",
        `task "${id}" changed while this edit was checked, three times. Read it again with getTask and send the edit again. Nothing was filed.`,
        id
      );
    }
  }
}

/** The patch to write on `row` as read: checked when its worker's flow declares an input, and fenced on its revision. */
async function decidedPatch(lookup: InputLookup, ctx: BlockContext, task: Task, patch: TaskSettingsPatch): Promise<TaskSettingsPatch> {
  const ifRevision = task.revision ?? 0;
  const assignee = patch.assignee ?? task.assignee;
  const flow = assignee === undefined ? undefined : await lookup.flowOf(assignee);
  // A worker whose flow can't be read now (removed, fired) is no open flow: the edit can't be checked, so it is refused.
  if (assignee !== undefined && flow === undefined) throw unresolved(assignee);
  const declaration = flow === undefined ? undefined : lookup.declarationOf(flow);
  if (assignee === undefined || flow === undefined || declaration === undefined) {
    // An unassigned task, or one on a flow that declares nothing: unchecked, as
    // before, and nothing it carries counts (spec, "updateTask"): an unchecked
    // write clears the stamp, so the next move onto a declared flow, or its
    // claim, fills the server-owned values again.
    const unstamp = filledForOf(task) !== undefined;
    return { ...patch, ...(unstamp ? { metadata: { ...(patch.metadata ?? {}), [FILLED_FOR]: null } } : {}), ifRevision };
  }
  // An edit within the flow the task was filled for keeps its server-owned
  // values, read through `stored`; anything else is a filing for this flow (D2).
  const priorFlow = task.assignee === undefined ? undefined : task.assignee === assignee ? flow : await lookup.flowOf(task.assignee);
  const edit = priorFlow === flow && stampMatches(task, flow, declaration);
  const kept = edit ? keptValues(declaration, task.input) : undefined;
  const checked = await checkFiling({
    ctx,
    declaration,
    flow,
    assignee,
    worker: await workerFor(lookup, assignee),
    sent: patch.input ?? task.input,
    ...(kept === undefined ? {} : { kept }),
    ...(lookup.rewrite === undefined ? {} : { rewrite: (input: TaskInputRecord) => lookup.rewrite!(input) }),
    hasProject: (input) => lookup.hasProject(input),
    noProject: () => lookup.noProject(assignee)
  });
  return { ...patch, input: checked.input, metadata: { ...(patch.metadata ?? {}), [FILLED_FOR]: checked.filledFor }, ifRevision };
}

/** The stored row's server-owned values, read through the declaration's `stored`. */
function keptValues(declaration: TaskInputDeclaration, stored: unknown): TaskInputRecord {
  const raw = stored !== null && typeof stored === "object" && !Array.isArray(stored) ? (stored as TaskInputRecord) : {};
  const read = declaration.stored === undefined ? raw : declaration.stored(raw);
  return Object.fromEntries(declaration.serverOwned.filter((name) => Object.hasOwn(read, name)).map((name) => [name, read[name]]));
}

async function workerFor(lookup: InputLookup, assignee: string): Promise<TaskInputWorker> {
  return (await lookup.workerOf(assignee)) ?? { id: assignee, config: {} };
}

/**
 * Where a raw handle reads workers and declarations: one per installation,
 * registered when it is created.
 */
export interface TaskInputSource {
  /** The declaration flow `flow`'s `work` entry carries. */
  declarationOf(flow: string): TaskInputDeclaration | undefined;
  /** The flow and declared configuration of a worker on the session user's roster. */
  workerOf(ctx: BlockContext, id: string): Promise<{ readonly flow: string; readonly config: Readonly<Record<string, unknown>> } | undefined>;
}

const bySession = new WeakMap<object, TaskInputSource>();
const byInstallation = new WeakMap<object, TaskInputSource>();
/** Each door's installations: one names it; two or more (a prebuilt flow given to both) name none on their own. */
const byDoor = new WeakMap<object, Set<TaskInputSource>>();

/** Register an installation's source, for the installation's own board to read. */
export function registerTaskInputSource(source: TaskInputSource, installation: object): void {
  byInstallation.set(installation, source);
}

/** Register `door`, the `from` of one of an installation's flows' `work` entries, as that installation's. */
export function registerTaskDoor(door: object, source: TaskInputSource): void {
  const known = byDoor.get(door);
  if (known === undefined) byDoor.set(door, new Set([source]));
  else known.add(source);
}

/** The source `installation` registered. */
export function taskInputSourceOf(installation: object): TaskInputSource | undefined {
  return byInstallation.get(installation);
}

/** Note the source the running request's session runs on: its worker was resolved there, or its task claimed. */
export function noteTaskInputSource(session: object, source: TaskInputSource): void {
  bySession.set(session, source);
}

/** The installation `door` names, noted on the session: its one registrant, or, for a shared door, the one the session is already pinned to; else none. */
export function noteSourceOfDoor(session: object, door: object): TaskInputSource | undefined {
  const sources = byDoor.get(door);
  if (sources === undefined) return undefined;
  if (sources.size === 1) {
    const [source] = sources;
    bySession.set(session, source!);
    return source;
  }
  // A door two installations share names neither: only the one this request's `resolveWorker`
  // already noted, server-side and by installation, and only if it registered this door.
  const pinned = bySession.get(session);
  return pinned !== undefined && sources.has(pinned) ? pinned : undefined;
}

/** The source the running request's session was noted with; none when it was noted with none. */
export function sourceOfSession(session: object): TaskInputSource | undefined {
  return bySession.get(session);
}

/** The source the running request's session runs on, as noted. */
function sourceFor(ctx: BlockContext): TaskInputSource | undefined {
  return sourceOfSession(ctx.session as object);
}

/** A lookup over `source`, bound to `ctx`, with the project rule the raw handles read. */
function sourceLookup(ctx: BlockContext, source: TaskInputSource, project: { has: (input: TaskInputRecord) => Promise<boolean>; refusal: (assignee: string) => string }): InputLookup {
  return {
    flowOf: async (assignee) => (await source.workerOf(ctx, assignee))?.flow,
    declarationOf: (flow) => source.declarationOf(flow),
    workerOf: async (assignee) => {
      const worker = await source.workerOf(ctx, assignee);
      return worker === undefined ? undefined : { id: assignee, config: worker.config };
    },
    hasProject: project.has,
    noProject: project.refusal
  };
}

/**
 * `ref` with every write that puts input on a task, or moves it, routed
 * through the filing check. A write the check can't be run for (no
 * installation this request ran on) is refused, never let through.
 */
export function checkedLedger(
  ctx: BlockContext,
  ref: TaskCollectionRef,
  project: { has: (input: TaskInputRecord) => Promise<boolean>; refusal: (assignee: string) => string }
): TaskCollectionRef {
  const lookup = (): InputLookup => {
    const source = sourceFor(ctx);
    if (source === undefined) {
      throw new TaskWriteRefusedError(
        "input_unchecked",
        "this handle files only in a request that resolved its worker, so the task's input can be checked against its flow. Nothing was filed."
      );
    }
    return sourceLookup(ctx, source, project);
  };
  // A caller never writes the stamp: a forged one would let a later edit keep server-owned values no filler wrote.
  const unstamped = <T extends { metadata?: Record<string, unknown> }>(write: T): T => {
    if (write.metadata === undefined || !Object.hasOwn(write.metadata, FILLED_FOR)) return write;
    const { [FILLED_FOR]: _stamp, ...metadata } = write.metadata;
    return { ...write, metadata };
  };
  const checkInit = async (given: TaskInit): Promise<TaskInit> => {
    const init = unstamped(given);
    return init.assignee === undefined ? init : withChecked(init, await checkFiledInput(lookup(), ctx, init.assignee, init.input));
  };
  return {
    ...ref,
    createTask: async (init) => ref.createTask(await checkInit(init)),
    createTasks: async (inits) => {
      // Refused whole: every row is checked before the first is filed.
      const checked: TaskInit[] = [];
      for (const init of inits) checked.push(await checkInit(init));
      return ref.createTasks(checked);
    },
    patchMetadata: (id, patch) => ref.patchMetadata(id, unstamped({ metadata: patch }).metadata ?? {}),
    patchSettings: async (id, given) => {
      const patch = unstamped(given);
      return patch.input === undefined && patch.assignee === undefined
        ? ref.patchSettings(id, patch)
        : checkedPatch(lookup(), ctx, ref, id, patch, (i, p) => ref.patchSettings(i, p));
    },
    // Every move of a task on the board is the checked edit, onto an open flow too: its stamp is cleared there.
    setAssignee: async (id, assignee) =>
      ref.get(id) === undefined ? ref.setAssignee(id, assignee) : checkedPatch(lookup(), ctx, ref, id, { assignee }, (i, p) => ref.patchSettings(i, p))
  };
}
