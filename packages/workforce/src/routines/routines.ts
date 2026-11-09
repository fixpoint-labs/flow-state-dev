// FIX-2614, epic FIX-2471 D12, ER-5, ER-9.
/**
 * Routines: a standing instruction that fires on its own as its owner, with
 * exactly one trigger, over the two collections that exist (D1).
 *
 * - **A clock routine** is a schedule row (`../schedules`), keyed by its name;
 *   its id is `clock:<key>`. Paused is `enabled: false`.
 * - **An event routine** is a subscription row (`../subscriptions`); its id is
 *   `event:<subscription id>`. It is written only through `subscribe` and
 *   `unsubscribe` (ER-5): a pause is `unsubscribe` with reason `paused`, and a
 *   resume is `subscribe` from the stored row, which checks read access again
 *   (ER-4) and keeps the row's task, so a resumed task routine still ends when
 *   its task fails.
 *
 * Four verbs over both: `listRoutines`, `saveRoutine`, `pauseRoutine` (one
 * `paused` flag) and `deleteRoutine`. The user reaches them on the roster
 * flow, and reaches every routine of theirs; a worker reaches them as tools
 * (`routineTools`), and reaches only the routines that act through it (a clock
 * routine it files, an event routine it hears), else `not_yours`.
 *
 * A routine the app declares (`routines.declared`) is seeded into each user's
 * collections when their roster flow runs a request, keyed
 * `cfg_<hash of the roster flow and the entry id>`, written only when missing
 * or changed. The config owns its settings: the user may pause it, and save and
 * delete refuse naming why. A seed keeps a pause.
 */
import { handler } from "@flow-state-dev/core";
import { deepEqual, updateStateWith, type UpdateStateRunner } from "@flow-state-dev/core/helpers";
import { retryOnConflict } from "../projects/cas-retry";
import type { ActionConfig, BlockContext } from "@flow-state-dev/core/types";
import type { ScheduleIndex } from "@flow-state-dev/scheduled/collection";
import { z } from "zod";
import { deriveWorkerSessionId } from "../workers/derive-session-id";
import type { WorkerInstallation } from "../workers/installation";
import { ROSTER_FLOW, WORKER_ID_STATE_KEY } from "../workers/keys";
import { SCHEDULES_RESOURCE, TASK_SCHEDULE_HANDLER } from "../schedules/keys";
import {
  clockProblem,
  removeSchedule,
  nextRunOf,
  scheduleKeyOf,
  scheduledTaskInputSchema,
  scheduleResources,
  type StoredSchedule
} from "../schedules/scheduled-work";
import { subscriptionResources, subscriptionsOf, type SubscriptionResourceState } from "../subscriptions/rows";
import {
  isPaused,
  resumeSubscription,
  seedSubscription,
  subscribe,
  subscribeInputSchema,
  unsubscribe,
  type SubscribeInput,
  type SubscribeTarget,
  type SubscriptionProvider
} from "../subscriptions/subscribe";
import {
  CLOCK_ROUTINE_PREFIX,
  DECLARED_ROUTINE_KEY_PREFIX,
  EVENT_ROUTINE_PREFIX,
  ROUTINE_CADENCES,
  ROUTINE_VERBS
} from "./keys";
import { listedRoutineSchema, routineMakerSchema, type ListedRoutine, type RoutineMaker } from "./listed-routine";

// ---- inputs ------------------------------------------------------------------

const clockTriggerSchema = z
  .object({
    cron: z.string().min(1).describe('Five fields: minute hour day-of-month month day-of-week, e.g. "0 9 * * 1" for Mondays at 9.'),
    timezone: z.string().min(1).optional().describe('An IANA time zone, e.g. "Europe/London". Omitted, UTC.')
  })
  .strict();

/** An event trigger: `subscribe`'s input whole, and a poll cadence. */
const eventTriggerSchema = subscribeInputSchema
  .extend({
    everyMinutes: z
      .number()
      .int()
      .optional()
      .describe(`How often a polled provider looks, in minutes: one of ${ROUTINE_CADENCES.join(", ")}. A pushed provider ignores it.`)
  })
  .strict();

const triggerSchema = z.union([z.object({ clock: clockTriggerSchema }).strict(), z.object({ event: eventTriggerSchema }).strict()]);

/** The task a clock routine files. Its `filer` may be left out by a worker, which files it itself. */
const routineTaskSchema = scheduledTaskInputSchema.partial({ filer: true });

/** What `saveRoutine` takes. */
const saveRoutineInputSchema = z
  .object({
    name: z.string().min(1).optional().describe("A clock routine's name, its key: saving one that exists replaces it. An event routine takes none."),
    trigger: triggerSchema.describe("Exactly one trigger: { clock: { cron, timezone } } or { event: { provider, thread, kinds, screens, interest } }."),
    task: routineTaskSchema.optional().describe("A clock routine's task: what it files each time it is due, on whose board (filer), for whom (assignee)."),
    worker: z.string().min(1).optional().describe("An event routine's hearer: the worker whose conversation hears its events."),
    description: z.string().optional()
  })
  .strict();

type SaveRoutineInput = z.infer<typeof saveRoutineInputSchema>;

const pauseRoutineInputSchema = z
  .object({
    id: z.string().min(1).describe("The routine's id, as listRoutines gives it."),
    paused: z.boolean().describe("true to pause it, false to resume it.")
  })
  .strict();

const deleteRoutineInputSchema = z.object({ id: z.string().min(1).describe("The routine's id, as listRoutines gives it.") }).strict();

const routineOutcomeSchema = z.union([z.object({ ok: z.literal(true), routine: listedRoutineSchema }), z.object({ ok: z.literal(false), error: z.string() })]);
const deletedSchema = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })]);

type RoutineOutcome = z.infer<typeof routineOutcomeSchema>;
type Deleted = z.infer<typeof deletedSchema>;

const refused = (error: string) => ({ ok: false as const, error });

// ---- declared routines -----------------------------------------------------

/**
 * A routine the app declares in config (`routines.declared`). Seeded for each
 * user when their roster flow runs a request, or for its `owner` only.
 */
export interface DeclaredRoutine {
  /** Stable across deploys: the stored key is derived from it. */
  readonly id: string;
  /** Seed it for this one user only. Omitted, for every user. */
  readonly owner?: { readonly userId: string; readonly orgId: string };
  readonly trigger: z.input<typeof triggerSchema>;
  /** A clock routine's task, its `filer` named. */
  readonly task?: z.input<typeof scheduledTaskInputSchema>;
  /** An event routine's hearer. */
  readonly worker?: string;
  readonly description?: string;
}

/** What `hireWorkforce` takes for routines. */
export interface RoutinesOptions {
  /**
   * A schedule index (a polling or BullMQ one) to mirror every clock routine
   * into, for a tick to find due rows. Omitted, the host's own cron POSTs to
   * each schedule's dispatch endpoint. Give `routineTools` the same one.
   */
  readonly index?: ScheduleIndex;
  /** The providers an event routine may follow a thread on. Omitted, none. */
  readonly providers?: readonly SubscriptionProvider[];
  /** The app's own routines, seeded for each user (or an entry's owner). */
  readonly declared?: readonly DeclaredRoutine[];
}

/** Why a cadence is refused, or `undefined`. */
function cadenceProblem(everyMinutes: number | undefined): string | undefined {
  if (everyMinutes === undefined || (ROUTINE_CADENCES as readonly number[]).includes(everyMinutes)) return undefined;
  return `invalid_cadence: every ${everyMinutes} minutes isn't a cadence. Use one of ${ROUTINE_CADENCES.join(", ")}. Nothing was saved.`;
}

/**
 * Check the app's declared routines before anything registers.
 *
 * @throws Naming every entry that would never fire: a repeated id, a clock
 *   routine with no task or filer or a cron that doesn't parse, an event
 *   routine with no hearer, a task or a cadence it can't take.
 */
export function checkDeclaredRoutines(declared: readonly DeclaredRoutine[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of declared) {
    const name = `routines.declared "${entry.id}"`;
    if (seen.has(entry.id)) problems.push(`${name}: the id is declared twice.`);
    seen.add(entry.id);
    const trigger = triggerSchema.safeParse(entry.trigger);
    if (!trigger.success) {
      problems.push(`${name}: its trigger isn't { clock } or { event }: ${trigger.error.issues.map((i) => i.message).join("; ")}.`);
      continue;
    }
    if ("clock" in trigger.data) {
      const task = scheduledTaskInputSchema.safeParse(entry.task);
      if (!task.success) problems.push(`${name}: a clock routine needs a task naming its filer and goal.`);
      const clock = clockProblem(trigger.data.clock.cron, trigger.data.clock.timezone);
      if (clock !== undefined) problems.push(`${name}: ${clock}`);
    } else {
      if (entry.worker === undefined) problems.push(`${name}: an event routine needs a worker to hear it.`);
      if (entry.task !== undefined) problems.push(`${name}: an event routine files no task.`);
      const cadence = cadenceProblem(trigger.data.event.everyMinutes);
      if (cadence !== undefined) problems.push(`${name}: ${cadence}`);
    }
  }
  if (problems.length > 0) throw new Error(`hireWorkforce: ${problems.length} declared routine problem(s); nothing was registered:\n` + problems.map((p) => `  - ${p}`).join("\n"));
}

/** The stored key of a declared entry: `cfg_<hash of the roster flow kind and the entry id>`. */
export async function declaredRoutineKey(entryId: string): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ROSTER_FLOW}\n${entryId}`)));
  return `${DECLARED_ROUTINE_KEY_PREFIX}${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---- reading -----------------------------------------------------------------

/** The schedule collection, as the verbs use it. */
interface ScheduleCollection {
  list(prefix?: string): Promise<Array<{ path: string; state: StoredSchedule }>>;
  getOptional(key: string): Promise<(UpdateStateRunner<StoredSchedule> & { state: StoredSchedule }) | undefined>;
  create(key: string, state: StoredSchedule, options: { replace: true }): Promise<unknown>;
}
const schedulesOf = (ctx: BlockContext) => (ctx.resources as unknown as Record<string, ScheduleCollection>)[SCHEDULES_RESOURCE]!;

const makerOfSchedule = (row: StoredSchedule): RoutineMaker | undefined => {
  const parsed = routineMakerSchema.safeParse(row.metadata?.madeBy);
  return parsed.success ? parsed.data : undefined;
};

const filerOf = (row: StoredSchedule): string => {
  const filer = (row.input as { filer?: unknown } | undefined)?.filer;
  return typeof filer === "string" ? filer : "";
};

function listedClock(key: string, row: StoredSchedule): ListedRoutine {
  const madeBy = makerOfSchedule(row);
  return {
    id: `${CLOCK_ROUTINE_PREFIX}${key}`,
    name: key,
    worker: filerOf(row),
    paused: row.enabled === false,
    ...(madeBy === undefined ? {} : { madeBy }),
    ...(row.description === undefined ? {} : { description: row.description }),
    trigger: { clock: { cron: row.cron, timezone: row.timezone ?? "UTC", nextRunAt: nextRunOf(row) } },
    task: row.input
  };
}

function listedEvent(row: SubscriptionResourceState): ListedRoutine {
  return {
    id: `${EVENT_ROUTINE_PREFIX}${row.id}`,
    name: row.thread,
    worker: row.worker,
    paused: !row.enabled,
    ...(row.madeBy === undefined ? {} : { madeBy: row.madeBy }),
    trigger: {
      event: {
        provider: row.provider,
        thread: row.thread,
        ...(row.kinds === undefined ? {} : { kinds: row.kinds }),
        screens: row.screens,
        interest: row.interest
      }
    }
  };
}

/** Who runs a verb: the user, or a worker on its own turn. */
type Caller = { readonly by: "user" } | { readonly by: "worker"; readonly worker: string };

/** Whether `caller` reaches a routine acting through `worker`. */
const reaches = (caller: Caller, worker: string) => caller.by === "user" || caller.worker === worker;

const notYours = (id: string) => refused(`not_yours: "${id}" isn't one of your routines; you can change only the ones that act through you.`);
const noRoutine = (id: string) => refused(`no_routine: there is no routine "${id}". listRoutines names each one.`);
const declaredRefusal = (id: string, verb: string) =>
  refused(`declared: "${id}" is the app's own routine, so its settings follow the app's config and it can't be ${verb}. Pause it instead.`);

const isDeclared = (key: string, madeBy: RoutineMaker | undefined) => madeBy?.by === "app" || key.startsWith(DECLARED_ROUTINE_KEY_PREFIX);

/** Every routine of the running user `caller` reaches: clock soonest next run first, then event, each by name. */
async function listRoutinesOf(ctx: BlockContext, caller: Caller): Promise<ListedRoutine[]> {
  const clocks = (await schedulesOf(ctx).list()).map((ref) => listedClock(scheduleKeyOf(ref.path), ref.state));
  // Paused event routines list; ended ones don't.
  const events = (await subscriptionsOf(ctx).list()).map((ref) => ref.state).filter((row) => row.enabled || isPaused(row)).map(listedEvent);
  const due = (r: ListedRoutine) =>
    "clock" in r.trigger ? (r.trigger.clock.nextRunAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(r.trigger.clock.nextRunAt)) : Number.POSITIVE_INFINITY;
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...clocks, ...events].filter((r) => reaches(caller, r.worker)).sort((a, b) => due(a) - due(b) || order(a.name, b.name) || order(a.id, b.id));
}

/** A routine id's trigger and key, or `undefined` when it names neither. */
function parseRoutineId(id: string): { clock: string } | { event: string } | undefined {
  if (id.startsWith(CLOCK_ROUTINE_PREFIX) && id.length > CLOCK_ROUTINE_PREFIX.length) return { clock: id.slice(CLOCK_ROUTINE_PREFIX.length) };
  if (id.startsWith(EVENT_ROUTINE_PREFIX) && id.length > EVENT_ROUTINE_PREFIX.length) return { event: id.slice(EVENT_ROUTINE_PREFIX.length) };
  return undefined;
}

/** An event routine's row, live or paused; an ended one is no routine. */
async function eventRow(ctx: BlockContext, id: string): Promise<SubscriptionResourceState | undefined> {
  const row = (await subscriptionsOf(ctx).getOptional(id))?.state;
  return row !== undefined && (row.enabled || isPaused(row)) ? row : undefined;
}

/** `subscribe`'s input, from a stored row: what a resume writes again. */
const subscribeInputOf = (row: SubscriptionResourceState): SubscribeInput => ({
  provider: row.provider,
  thread: row.thread,
  ...(row.kinds === undefined ? {} : { kinds: row.kinds }),
  screens: row.screens,
  ...(row.outsiders === true ? { outsiders: true as const } : {}),
  interest: row.interest
});

/** The session a stored row hears in, so a resume keeps its session and its task. */
const targetOf = (row: SubscriptionResourceState): SubscribeTarget => ({
  sessionId: row.sessionId,
  flow: row.flow,
  worker: row.worker,
  ...(row.taskId === undefined ? {} : { taskId: row.taskId }),
  ...(row.tenantId === undefined ? {} : { tenantId: row.tenantId })
});

/**
 * The running user's conversation with `worker`: the address their own
 * message reaches, derived on the server, never from the input.
 */
async function conversationWith(ctx: BlockContext, installation: WorkerInstallation, worker: string): Promise<SubscribeTarget | { refused: string }> {
  const found = await installation.rosterWorker(ctx, worker);
  if (found === undefined) return { refused: `no_worker: no worker "${worker}" on your roster.` };
  if (found.problem !== undefined) return { refused: `no_worker: worker "${worker}" can't run: ${found.problem}.` };
  const identity = ctx.session.identity as { userId?: string; orgId?: string };
  if (identity.userId === undefined || identity.orgId === undefined) return { refused: "no_identity: a routine needs a user and an organization." };
  const sessionId = await deriveWorkerSessionId({ userId: identity.userId, orgId: identity.orgId, flow: found.flow, criteria: { worker } });
  // The conversation is in the tenant the user is working in now: the roster session's.
  const tenantId = (identity as { tenantId?: string }).tenantId;
  return { sessionId, flow: found.flow, worker, ...(tenantId === undefined || tenantId.length === 0 ? {} : { tenantId }) };
}

// ---- the verbs -----------------------------------------------------------------

/** What the verbs are built with. */
interface VerbDeps {
  readonly providers: readonly SubscriptionProvider[];
  /** The installation a user's event routine finds its hearer on. A worker's tools need none. */
  readonly installation?: WorkerInstallation;
}

async function saveRoutine(ctx: BlockContext, caller: Caller, deps: VerbDeps, input: SaveRoutineInput): Promise<RoutineOutcome> {
  const madeBy: RoutineMaker = caller.by === "user" ? { by: "user" } : { by: "worker", worker: caller.worker };
  if ("clock" in input.trigger) {
    const { cron, timezone } = input.trigger.clock;
    if (input.name === undefined) return refused("no_name: a clock routine needs a name, its key. Nothing was saved.");
    if (input.worker !== undefined) return refused("no_hearer: a clock routine files a task; name its board in task.filer, not worker. Nothing was saved.");
    if (input.task === undefined) return refused("no_task: a clock routine needs the task it files each time it is due. Nothing was saved.");
    const filer = input.task.filer ?? (caller.by === "worker" ? caller.worker : undefined);
    if (filer === undefined) return refused("no_filer: name the worker whose board the task lands on, in task.filer. Nothing was saved.");
    const id = `${CLOCK_ROUTINE_PREFIX}${input.name}`;
    if (!reaches(caller, filer)) return notYours(id);
    const existing = (await schedulesOf(ctx).getOptional(input.name))?.state;
    if (isDeclared(input.name, existing === undefined ? undefined : makerOfSchedule(existing))) return declaredRefusal(id, "saved over");
    if (existing !== undefined && !reaches(caller, filerOf(existing))) return notYours(id);
    const problem = clockProblem(cron, timezone);
    if (problem !== undefined) return refused(problem);
    // Saving turns it on: a save is the user (or a worker) asking for it now.
    const row: StoredSchedule = {
      cron,
      kind: TASK_SCHEDULE_HANDLER,
      input: { ...input.task, filer },
      enabled: true,
      ...(timezone === undefined ? {} : { timezone }),
      ...(input.description === undefined ? {} : { description: input.description }),
      metadata: { madeBy }
    };
    await schedulesOf(ctx).create(input.name, row, { replace: true });
    return { ok: true, routine: listedClock(input.name, row) };
  }

  const { everyMinutes, ...event } = input.trigger.event;
  if (input.name !== undefined) return refused("no_name: an event routine is named by its thread; leave name out. Nothing was saved.");
  // Event to task is not a routine's (it belongs to the event's hearer).
  if (input.task !== undefined) return refused("no_task: an event routine files no task; its events reach the hearer as messages. Nothing was saved.");
  const cadence = cadenceProblem(everyMinutes);
  if (cadence !== undefined) return refused(cadence);
  // A valid cadence is checked and not yet kept: every provider today pushes,
  // and the poll that would honour it writes its own row (FIX-2536).
  let target: SubscribeTarget | undefined;
  if (caller.by === "user") {
    if (input.worker === undefined) return refused("no_hearer: name the worker whose conversation hears it, in worker. Nothing was saved.");
    if (deps.installation === undefined) return refused("no_hearer: this flow keeps no roster to find the worker on. Nothing was saved.");
    const found = await conversationWith(ctx, deps.installation, input.worker);
    if ("refused" in found) return refused(found.refused);
    target = found;
  } else if (input.worker !== undefined && input.worker !== caller.worker) {
    return refused(`not_yours: you can save only routines that act through you, not through "${input.worker}".`);
  }
  const outcome = await subscribe(ctx, deps.providers, event, target, { madeBy });
  if ("refused" in outcome) return refused(outcome.refused);
  const row = await eventRow(ctx, outcome.id);
  return row === undefined ? refused(`no_routine: "${outcome.id}" wasn't written.`) : { ok: true, routine: listedEvent(row) };
}

async function pauseRoutine(ctx: BlockContext, caller: Caller, deps: VerbDeps, input: { id: string; paused: boolean }): Promise<RoutineOutcome> {
  const parsed = parseRoutineId(input.id);
  if (parsed === undefined) return noRoutine(input.id);
  if ("clock" in parsed) {
    const ref = await schedulesOf(ctx).getOptional(parsed.clock);
    if (ref === undefined) return noRoutine(input.id);
    if (!reaches(caller, filerOf(ref.state))) return notYours(input.id);
    // Only `enabled`, on the row as committed: a row deleted meanwhile stays deleted, and a save
    // that landed meanwhile keeps its cron.
    const row = await retryOnConflict(() =>
      updateStateWith<StoredSchedule, StoredSchedule | undefined>(ref, (current) =>
        current?.cron === undefined ? { state: current, result: undefined } : { state: { ...current, enabled: !input.paused }, result: { ...current, enabled: !input.paused } }
      )
    );
    return row === undefined ? noRoutine(input.id) : { ok: true, routine: listedClock(parsed.clock, row) };
  }
  const row = await eventRow(ctx, parsed.event);
  if (row === undefined) return noRoutine(input.id);
  if (!reaches(caller, row.worker)) return notYours(input.id);
  if (input.paused) {
    await unsubscribe(ctx, row.id, "paused");
  } else if (!row.enabled) {
    // The resume is a subscribe from the stored row: read access checked again,
    // the same session and task, the same id and maker.
    const outcome = await resumeSubscription(ctx, deps.providers, subscribeInputOf(row), targetOf(row), {
      id: row.id,
      ...(row.madeBy === undefined ? {} : { madeBy: row.madeBy })
    });
    if ("refused" in outcome) return refused(`${outcome.refused} It stays paused.`);
  }
  const now = await eventRow(ctx, row.id);
  return now === undefined ? noRoutine(input.id) : { ok: true, routine: listedEvent(now) };
}

async function deleteRoutine(ctx: BlockContext, caller: Caller, input: { id: string }): Promise<Deleted> {
  const parsed = parseRoutineId(input.id);
  if (parsed === undefined) return noRoutine(input.id);
  if ("clock" in parsed) {
    const row = (await schedulesOf(ctx).getOptional(parsed.clock))?.state;
    if (row === undefined) return noRoutine(input.id);
    if (!reaches(caller, filerOf(row))) return notYours(input.id);
    if (isDeclared(parsed.clock, makerOfSchedule(row))) return declaredRefusal(input.id, "deleted");
    await removeSchedule(ctx, parsed.clock);
    return { ok: true };
  }
  const row = await eventRow(ctx, parsed.event);
  if (row === undefined) return noRoutine(input.id);
  if (!reaches(caller, row.worker)) return notYours(input.id);
  if (isDeclared(row.id, row.madeBy)) return declaredRefusal(input.id, "deleted");
  await unsubscribe(ctx, row.id, "unsubscribed");
  return { ok: true };
}

// ---- the seed ------------------------------------------------------------------

/** What one seed pass did, by entry id. */
export interface SeedOutcome {
  readonly written: string[];
  readonly unchanged: string[];
  readonly refused: string[];
}

/**
 * Seed the app's declared routines into the running user's collections: each
 * entry for every user, or only its owner. A row is written only when missing
 * or changed, and a change keeps the row's pause. A clock row whose entry left
 * config is deleted. A refused entry (a hearer not on the roster, a thread the
 * user can't read) writes nothing and is tried again on the next pass.
 */
export async function seedDeclaredRoutines(
  ctx: BlockContext,
  installation: WorkerInstallation,
  options: Pick<RoutinesOptions, "providers" | "declared">
): Promise<SeedOutcome> {
  const outcome: SeedOutcome = { written: [], unchanged: [], refused: [] };
  const identity = ctx.session.identity as { userId?: string; orgId?: string };
  if (identity.userId === undefined || identity.orgId === undefined) return outcome;
  const entries = (options.declared ?? []).filter(
    (entry) => entry.owner === undefined || (entry.owner.userId === identity.userId && entry.owner.orgId === identity.orgId)
  );
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = await declaredRoutineKey(entry.id);
    keys.add(key);
    const madeBy: RoutineMaker = { by: "app", entry: entry.id };
    const trigger = triggerSchema.parse(entry.trigger);
    try {
      if ("clock" in trigger) {
        // An entry that was an event routine under this key: that row ends, as config removed it.
        const was = (await subscriptionsOf(ctx).getOptional(key))?.state;
        if (was !== undefined && (was.enabled || isPaused(was))) await unsubscribe(ctx, key, "config_removed");
        const existing = (await schedulesOf(ctx).getOptional(key))?.state;
        const owned = {
          cron: trigger.clock.cron,
          input: scheduledTaskInputSchema.parse(entry.task),
          ...(trigger.clock.timezone === undefined ? {} : { timezone: trigger.clock.timezone }),
          ...(entry.description === undefined ? {} : { description: entry.description })
        };
        const stored = existing === undefined ? undefined : { cron: existing.cron, input: existing.input, timezone: existing.timezone, description: existing.description };
        if (stored !== undefined && deepEqual(withoutUndefined(stored), owned)) {
          outcome.unchanged.push(entry.id);
          continue;
        }
        // Only the config's fields: a pause the user set stays.
        const row: StoredSchedule = { ...owned, kind: TASK_SCHEDULE_HANDLER, enabled: existing?.enabled ?? true, metadata: { madeBy } };
        await schedulesOf(ctx).create(key, row, { replace: true });
        outcome.written.push(entry.id);
        continue;
      }
      const { everyMinutes: _cadence, ...event } = trigger.event;
      // An entry that was a clock routine under this key: its schedule goes.
      if ((await schedulesOf(ctx).getOptional(key)) !== undefined) await removeSchedule(ctx, key);
      const target = await conversationWith(ctx, installation, entry.worker!);
      if ("refused" in target) {
        outcome.refused.push(entry.id);
        continue;
      }
      const existing = (await subscriptionsOf(ctx).getOptional(key))?.state;
      const wanted = withoutUndefined({
        provider: event.provider,
        thread: event.thread.trim(),
        kinds: event.kinds,
        screens: event.screens ?? [],
        outsiders: event.outsiders,
        interest: event.interest,
        worker: target.worker,
        sessionId: target.sessionId
      });
      // An unchanged entry writes nothing, even over a row its thread ended; one that left config
      // and is back turns on again.
      if (existing !== undefined && existing.endedReason !== "config_removed" && deepEqual(withoutUndefined({ ...subscribeInputOf(existing), worker: existing.worker, sessionId: existing.sessionId }), wanted)) {
        outcome.unchanged.push(entry.id);
        continue;
      }
      // The config's fields over the row's committed state: a pause, or an end, stays.
      const written = await seedSubscription(ctx, options.providers ?? [], event, target, { id: key, madeBy });
      (("refused" in written ? outcome.refused : outcome.written) as string[]).push(entry.id);
    } catch {
      outcome.refused.push(entry.id);
    }
  }
  // A clock row whose entry left config goes with it. An event row's ends at
  // its next poll (FIX-2536), so a pushed one stays until then.
  // Filtered at the source: an app that never declared one reads no rows here.
  for (const ref of await schedulesOf(ctx).list(DECLARED_ROUTINE_KEY_PREFIX)) {
    const key = scheduleKeyOf(ref.path);
    if (key.startsWith(DECLARED_ROUTINE_KEY_PREFIX) && !keys.has(key) && makerOfSchedule(ref.state)?.by === "app") await removeSchedule(ctx, key);
  }
  return outcome;
}

/** `value` without its `undefined` fields, so a stored row and an entry compare by what they hold. */
function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---- the two surfaces ------------------------------------------------------------

/** The resources the verbs reach: both collections, and the subscription cursors and index. */
function verbResources(index: ScheduleIndex | undefined) {
  return { ...scheduleResources(index), ...subscriptionResources };
}

/** The four verbs as handlers, run by `callerOf`. */
function verbBlocks(
  resources: Record<string, unknown>,
  deps: VerbDeps,
  callerOf: (ctx: BlockContext) => Caller | { refused: string },
  describe: { list: string; save: string; pause: string; delete: string }
) {
  const list = handler({
    name: ROUTINE_VERBS.list,
    description: describe.list,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ routines: z.array(listedRoutineSchema) }),
    resources: resources as never,
    execute: async (_input, ctx) => {
      const caller = callerOf(ctx);
      return { routines: "refused" in caller ? [] : await listRoutinesOf(ctx, caller) };
    }
  });
  const save = handler({
    name: ROUTINE_VERBS.save,
    description: describe.save,
    inputSchema: saveRoutineInputSchema,
    outputSchema: routineOutcomeSchema,
    resources: resources as never,
    execute: async (input, ctx) => {
      const caller = callerOf(ctx);
      return "refused" in caller ? refused(caller.refused) : saveRoutine(ctx, caller, deps, input);
    }
  });
  const pause = handler({
    name: ROUTINE_VERBS.pause,
    description: describe.pause,
    inputSchema: pauseRoutineInputSchema,
    outputSchema: routineOutcomeSchema,
    resources: resources as never,
    execute: async (input, ctx) => {
      const caller = callerOf(ctx);
      return "refused" in caller ? refused(caller.refused) : pauseRoutine(ctx, caller, deps, input);
    }
  });
  const remove = handler({
    name: ROUTINE_VERBS.delete,
    description: describe.delete,
    inputSchema: deleteRoutineInputSchema,
    outputSchema: deletedSchema,
    resources: resources as never,
    execute: async (input, ctx) => {
      const caller = callerOf(ctx);
      return "refused" in caller ? refused(caller.refused) : deleteRoutine(ctx, caller, input);
    }
  });
  return { [ROUTINE_VERBS.list]: list, [ROUTINE_VERBS.save]: save, [ROUTINE_VERBS.pause]: pause, [ROUTINE_VERBS.delete]: remove } as {
    listRoutines: typeof list;
    saveRoutine: typeof save;
    pauseRoutine: typeof pause;
    deleteRoutine: typeof remove;
  };
}

/** The worker a turn runs, from its session's server-written state. */
function workerCaller(ctx: BlockContext): Caller | { refused: string } {
  const worker = ((ctx.session.state ?? {}) as Record<string, unknown>)[WORKER_ID_STATE_KEY];
  return typeof worker === "string" && worker.length > 0 ? { by: "worker", worker } : { refused: "not_a_worker: this session runs no worker, so it keeps no routines." };
}

/**
 * The four routine tools, for a worker's turn: list, save, pause and delete
 * the routines that act through this worker. A clock routine it saves files on
 * its own board; an event routine it saves is heard in this conversation, and
 * by this task when it is a task's. Each lists the worker as its maker.
 *
 * @param options.providers The providers an event routine may follow a thread on.
 * @param options.index The schedule index `hireWorkforce`'s `routines` was given, so a clock routine saved here is mirrored into it too.
 */
export function routineTools(options: { readonly providers: readonly SubscriptionProvider[]; readonly index?: ScheduleIndex }) {
  return verbBlocks(verbResources(options.index), { providers: options.providers }, workerCaller, {
    list: "List the routines that act through you, for this user: each with its id, its trigger (a clock or an event), and whether it is paused.",
    save:
      "Save a routine that runs as this user on its own. A clock routine ({ clock: { cron, timezone } }, a name, and a task) files the task on your board each time it is due. " +
      "An event routine ({ event: { provider, thread, kinds, screens, interest } }) follows one thread (a PR, an issue, a repo) so its events reach this conversation as messages from the service, each once. " +
      "Refused for a thread the user can't read.",
    pause: "Pause a routine (paused: true) so it fires nothing, or resume it (paused: false). A resume checks the user can still read its thread.",
    delete: "Delete a routine, by the id listRoutines gives. An app's own routine can only be paused."
  });
}

/**
 * Routines on the roster flow: the four verbs as actions the user runs over
 * all their routines, and the seed of the app's declared ones.
 */
export function defineRoutineActions(installation: WorkerInstallation, options: RoutinesOptions, resources: Record<string, unknown>) {
  const all = { ...installation.resources, ...resources, ...subscriptionResources };
  const blocks = verbBlocks(all, { providers: options.providers ?? [], installation }, () => ({ by: "user" }), {
    list: "The user's routines, clock and event, each with who made it, its trigger, whether it is paused, and a clock routine's next run.",
    save: "Save a routine: a clock trigger that files a task each time it is due, or an event trigger a worker's conversation hears. Saving a clock routine's name again replaces it.",
    pause: "Pause or resume one of the user's routines. A resume checks read access to an event routine's thread again.",
    delete: "Delete one of the user's routines. An app's own routine can only be paused."
  });
  const actions: Record<string, ActionConfig> = Object.fromEntries(
    Object.entries(blocks).map(([verb, block]) => [verb, { inputSchema: block.inputSchema, block, description: block.description }])
  );
  // Installed with no entries too: a clock row seeded by an entry since removed is cleaned up.
  const seed = handler({
    name: "workforce-seed-declared-routines",
    inputSchema: z.unknown(),
    outputSchema: z.object({ written: z.array(z.string()), unchanged: z.array(z.string()), refused: z.array(z.string()) }),
    resources: all as never,
    execute: async (_input, ctx) => seedDeclaredRoutines(ctx, installation, options)
  });
  return { actions, seed, resources: all };
}
