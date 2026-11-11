// FIX-2085; BP-031; FIX-2614.
/**
 * A clock routine: a schedule that files an ordinary task.
 *
 * - **The row.** One per schedule in the user's schedule collection
 *   ({@link SCHEDULES_PATTERN}, at user scope in their organization):
 *   `{ cron, timezone, kind: "task", input: { filer, goal, assignee, ... } }`.
 *   `input.filer` names the worker whose board the task lands on; the rest of
 *   `input` is the task, as the board's filing takes it. `metadata.madeBy`
 *   names who made it, when the schedule says.
 * - **The fire.** The roster flow resolves a dispatch id to its row
 *   (`createResourceCollectionScheduleResolver`), and the endpoint fires each
 *   scheduled time at most once. The `task` handler runs as the
 *   row's user: it finds the filer on their roster, then dispatches the
 *   filer's flow's {@link FILE_SCHEDULED_TASK_ENTRY} into the user's own
 *   conversation with the filer, the address their own message reaches
 *   (derived on the server), opening it when absent. That entry files
 *   through the board's own filing. No model turn decides what lands (D1).
 * - **The verbs.** The routine verbs (`../routines`) list, save, pause and
 *   delete these schedules; a paused one is `enabled: false`. A schedule's next run is
 *   worked out from its cron and time zone at read (D3), so the list needs no
 *   schedule index.
 * - **The index.** Optional. Given one, the collection mirrors every write
 *   into it, for a polling tick or BullMQ to find due rows; without one, the
 *   host's own cron POSTs per schedule.
 *
 * A fire whose filing is refused (a filer not on the roster, an assignee that
 * is the filer itself or not among its delegates, no assignee where the filer
 * has more than one delegate) fails, naming why, and is dropped. The write isn't checked against the roster: a roster changes after
 * a row is written.
 */
import { defineResourceCollection, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { isKnownTimeZone, type SchedulesConfig } from "@flow-state-dev/core/types";
import { dispatchThroughSeam, isFiveFieldCron } from "@flow-state-dev/core/internal";
import {
  FIRED_RECORDS_PATTERN,
  createResourceCollectionScheduleResolver,
  defineScheduleCollection,
  firedRecordCollectionKey,
  formatScheduleId,
  parseNextFireAt,
  type ScheduleIndex
} from "@flow-state-dev/scheduled/collection";
import { z } from "zod";
import { deriveWorkerSessionId, criteriaState } from "../workers/derive-session-id";
import type { WorkerInstallation } from "../workers/installation";
import { ROSTER_FLOW } from "../workers/keys";
import { FILE_SCHEDULED_TASK_ENTRY, SCHEDULES_PATTERN, SCHEDULES_RESOURCE, TASK_SCHEDULE_HANDLER } from "./keys";

/** The accessor a flow declares the dispatch endpoint's fired records under. */
const FIRED_RECORDS_RESOURCE = "workforceScheduledFires";

/**
 * The task a fire files: the worker whose board it lands on, and the task as
 * the board's filing takes it. Fields that would make the filing anything but
 * a new task (a recorded task's id, a wait, a post) are refused by name.
 */
export const scheduledTaskInputSchema = z
  .object({
    /** The worker whose board the task lands on, in the user's conversation with it. */
    filer: z.string().min(1),
    /** What the task is for. */
    goal: z.string().min(1),
    /** Who works it: one of the filer's delegates. Omitted, the filer's only one. */
    assignee: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    priority: z.number().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ScheduledTaskInput = z.infer<typeof scheduledTaskInputSchema>;

/** A schedule as the collection stores it. */
export type StoredSchedule = {
  cron: string;
  kind: string;
  timezone?: string;
  input?: unknown;
  description?: string;
  enabled?: boolean;
  orgId?: string;
  metadata?: Record<string, unknown>;
};

/** When `schedule` is next due, worked out from its cron and zone now; `null` while it is off or its cron doesn't parse. */
export function nextRunOf(schedule: StoredSchedule): string | null {
  if (schedule.enabled === false) return null;
  const next = parseNextFireAt(schedule.cron, schedule.timezone ?? "UTC");
  return next === null ? null : new Date(next).toISOString();
}

/**
 * Why a clock trigger would fail every fire, or `undefined` when it won't: the
 * zone check dispatch runs (`validateScheduleConfig`), and a cron of exactly
 * five fields that parses.
 */
export function clockProblem(cron: string, timezone: string | undefined): string | undefined {
  if (timezone !== undefined && !isKnownTimeZone(timezone)) {
    return (
      `invalid_schedule: ${JSON.stringify(timezone)} is not a known time zone. ` +
      'Use an IANA time zone such as "Europe/London", or omit it for UTC. Nothing was saved.'
    );
  }
  if (!isFiveFieldCron(cron) || parseNextFireAt(cron, timezone ?? "UTC") === null) {
    return (
      `invalid_schedule: cron ${JSON.stringify(cron)} in ${timezone ?? "UTC"} doesn't parse as five fields. ` +
      "Use exactly five fields (minute hour day-of-month month day-of-week) and an IANA time zone. Nothing was saved."
    );
  }
  return undefined;
}

/**
 * Delete one of the running user's schedules, with the dispatch endpoint's
 * fired record, so the key saved again is a new schedule. The record's
 * dispatch id is the one the endpoint keyed it by: the org and user this run
 * is admitted as, never an input.
 */
export async function removeSchedule(ctx: BlockContext, key: string): Promise<void> {
  const resources = ctx.resources as Record<string, { delete(key: string): Promise<unknown> }>;
  await resources[SCHEDULES_RESOURCE]!.delete(key);
  const identity = ctx.session.identity as { userId?: string; orgId?: string };
  if (identity.userId !== undefined && identity.orgId !== undefined) {
    await resources[FIRED_RECORDS_RESOURCE]!.delete(firedRecordCollectionKey(ROSTER_FLOW, formatScheduleId(identity.orgId, identity.userId, key)));
  }
}

/**
 * The schedule collection and the fired records, for a flow's `resources`: the
 * roster flow's, and a worker flow's routine tools.
 *
 * @param index A schedule index to mirror every write into.
 */
export function scheduleResources(index?: ScheduleIndex) {
  // Shared across flows, as the subscriptions are: a worker flow that isolates its users' state
  // still writes the schedules the roster lists and fires.
  const collection = defineScheduleCollection({ pattern: SCHEDULES_PATTERN, flowIsolation: false, ...(index === undefined ? {} : { index }) });
  // The dispatch endpoint's record of each schedule's last fired time, in the
  // same cell: read by no one here, deleted with its schedule.
  const firedRecords = defineResourceCollection({
    pattern: FIRED_RECORDS_PATTERN,
    scope: "user",
    flowIsolation: false,
    stateSchema: z.object({ lastFiredAt: z.number() }).passthrough()
  });
  return { [SCHEDULES_RESOURCE]: collection, [FIRED_RECORDS_RESOURCE]: firedRecords };
}

/** A schedule's key relative to the collection's pattern. */
export const scheduleKeyOf = (path: string): string => {
  const prefix = SCHEDULES_PATTERN.slice(0, SCHEDULES_PATTERN.indexOf("*"));
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
};

/**
 * The `task` schedule handler: file the row's task on its filer's
 * board, in the user's conversation with the filer, as the user.
 */
function scheduledTaskBlock(installation: WorkerInstallation) {
  return handler({
    name: "workforce-scheduled-task",
    inputSchema: scheduledTaskInputSchema,
    outputSchema: z.object({ sessionId: z.string() }),
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const { filer, ...task } = input;
      // A filing naming the filer itself is a step on its own plan ledger
      // (FIX-2076), which only that worker's own request drains.
      if (task.assignee === filer) {
        throw new Error(`The scheduled task wasn't filed: its assignee is its filer, "${filer}". Name one of "${filer}"'s delegates.`);
      }
      const worker = await installation.rosterWorker(ctx, filer);
      if (worker === undefined) throw new Error(`The scheduled task wasn't filed: no worker "${filer}" on your roster.`);
      if (worker.problem !== undefined) throw new Error(`The scheduled task wasn't filed: worker "${filer}" can't run: ${worker.problem}.`);
      const entries = (installation.workerFlows()[worker.flow]?.flow as { internal?: { actions?: Record<string, unknown> } } | undefined)
        ?.internal?.actions;
      if (entries === undefined || !Object.hasOwn(entries, FILE_SCHEDULED_TASK_ENTRY)) {
        throw new Error(`The scheduled task wasn't filed: worker "${filer}" files no tasks (its flow "${worker.flow}" keeps no board).`);
      }
      // The user's own conversation with the filer: the address their own
      // message reaches, derived here from the run's identity, never the row.
      const identity = ctx.session.identity as { userId?: string; orgId?: string };
      if (identity.userId === undefined || identity.orgId === undefined) {
        throw new Error("The scheduled task wasn't filed: the fire runs as no user in no organization.");
      }
      const criteria = { worker: filer };
      const sessionId = await deriveWorkerSessionId({ userId: identity.userId, orgId: identity.orgId, flow: worker.flow, criteria });
      const outcome = await dispatchThroughSeam(ctx, {
        type: "internal",
        action: FILE_SCHEDULED_TASK_ENTRY,
        flowKind: worker.flow,
        session: { id: sessionId, state: criteriaState(criteria) },
        payload: task,
        from: "workforce-scheduled-task"
      });
      if (!outcome.ok) throw new Error(`The scheduled task wasn't filed: ${outcome.refused}: ${outcome.detail}`);
      return { sessionId: outcome.sessionId };
    }
  });
}

/**
 * Clock routines for one installation: the schedule collection and the
 * resolver the roster flow fires schedules through.
 */
export function defineScheduledWork(installation: WorkerInstallation, index?: ScheduleIndex) {
  const resources = scheduleResources(index);
  const schedules: SchedulesConfig = {
    resolve: createResourceCollectionScheduleResolver({
      collection: resources[SCHEDULES_RESOURCE],
      blocks: { [TASK_SCHEDULE_HANDLER]: scheduledTaskBlock(installation) }
    }),
    ...(index === undefined ? {} : { index })
  };
  return {
    /** The schedule collection and the fired records, for the roster flow's `resources`. */
    resources,
    /** The roster flow's `schedules`: a dispatch id resolves to its row. */
    schedules
  };
}
