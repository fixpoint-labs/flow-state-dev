/**
 * Recurring work (FIX-2085): a schedule that files an ordinary task.
 *
 * - **The row.** One per schedule in the user's schedule collection
 *   ({@link SCHEDULES_PATTERN}, at user scope in their organization):
 *   `{ cron, timezone, kind: "task", input: { filer, goal, assignee, ... } }`.
 *   `input.filer` names the worker whose board the task lands on; the rest of
 *   `input` is the task, as the board's filing takes it.
 * - **The fire.** The roster flow resolves a dispatch id to its row
 *   (`createResourceCollectionScheduleResolver`), and the endpoint fires each
 *   scheduled time at most once. The `task` handler runs as the
 *   row's user: it finds the filer on their roster, then dispatches the
 *   filer's flow's {@link FILE_SCHEDULED_TASK_ENTRY} into the user's own
 *   conversation with the filer, the address their own message reaches
 *   (derived on the server, BP-031), opening it when absent. That entry files
 *   through the board's own filing. No model turn decides what lands (D1).
 * - **The list.** `listSchedules` reads the collection and works each
 *   schedule's next run out from its cron and time zone at read (D3), so it
 *   needs no schedule index. `saveSchedule` and `deleteSchedule` write it.
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
import { dispatchThroughSeam, isFiveFieldCron, isKnownTimeZone, type ActionConfig, type BlockContext, type SchedulesConfig } from "@flow-state-dev/core/types";
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
import { listedScheduleSchema, type ListedSchedule } from "./listed-schedule";
import { FILE_SCHEDULED_TASK_ENTRY, LIST_SCHEDULES_ACTION, SCHEDULES_PATTERN, SCHEDULES_RESOURCE, TASK_SCHEDULE_HANDLER } from "./keys";

/** The accessor the roster flow declares the dispatch endpoint's fired records under. */
const FIRED_RECORDS_RESOURCE = "workforceScheduledFires";

/** What `hireWorkforce` takes for recurring work. */
export interface ScheduledWorkOptions {
  /**
   * A schedule index (a polling or BullMQ one) to mirror every saved schedule
   * into, for a tick to find due rows. Omitted, the host's own cron POSTs to
   * each schedule's dispatch endpoint.
   */
  index?: ScheduleIndex;
}

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

const saveScheduleInputSchema = z
  .object({
    /** The schedule's key in the collection: saving an existing key replaces it. */
    key: z.string().min(1),
    cron: z.string().min(1),
    /** An IANA time zone. Omitted, UTC. */
    timezone: z.string().min(1).optional(),
    kind: z.literal(TASK_SCHEDULE_HANDLER).optional(),
    input: scheduledTaskInputSchema,
    description: z.string().optional(),
    enabled: z.boolean().optional()
  })
  .strict();

const saveScheduleOutputSchema = z.union([
  z.object({ ok: z.literal(true), schedule: listedScheduleSchema }),
  z.object({ ok: z.literal(false), error: z.string() })
]);

type ScheduleRow = {
  cron: string;
  kind: string;
  timezone?: string;
  input?: unknown;
  description?: string;
  enabled?: boolean;
};

/** A schedule row as the list shows it, its next run worked out from `now`. */
function listed(key: string, row: ScheduleRow): ListedSchedule {
  const timezone = row.timezone ?? "UTC";
  const enabled = row.enabled !== false;
  const next = enabled ? parseNextFireAt(row.cron, timezone) : null;
  return {
    key,
    cron: row.cron,
    timezone,
    kind: row.kind,
    enabled,
    ...(row.description === undefined ? {} : { description: row.description }),
    input: row.input,
    nextRunAt: next === null ? null : new Date(next).toISOString()
  };
}

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
      const worker = await installation.rosterWorker(ctx as never, filer);
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
      const outcome = await dispatchThroughSeam(ctx as BlockContext, {
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
 * Recurring work for one installation: the schedule collection, the resolver
 * the roster flow fires schedules through, and the three schedule actions.
 */
export function defineScheduledWork(installation: WorkerInstallation, options: ScheduledWorkOptions = {}) {
  const collection = defineScheduleCollection({
    pattern: SCHEDULES_PATTERN,
    ...(options.index === undefined ? {} : { index: options.index })
  });
  // The dispatch endpoint's record of each schedule's last fired time, in the
  // same cell: read by no one here, deleted with its schedule.
  const firedRecords = defineResourceCollection({
    pattern: FIRED_RECORDS_PATTERN,
    scope: "user",
    stateSchema: z.object({ lastFiredAt: z.number() }).passthrough()
  });
  const resources = { ...installation.resources, [SCHEDULES_RESOURCE]: collection, [FIRED_RECORDS_RESOURCE]: firedRecords };
  const prefix = SCHEDULES_PATTERN.slice(0, SCHEDULES_PATTERN.indexOf("*"));
  const keyOf = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path);

  const schedules: SchedulesConfig = {
    resolve: createResourceCollectionScheduleResolver({
      collection,
      blocks: { [TASK_SCHEDULE_HANDLER]: scheduledTaskBlock(installation) }
    })
  };

  const listSchedules = handler({
    name: "workforce-list-schedules",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ schedules: z.array(listedScheduleSchema) }),
    resources,
    execute: async (_input, ctx) => {
      const rows = await ctx.resources[SCHEDULES_RESOURCE].list();
      // Soonest next run first, a schedule with none last, then by key.
      const due = (s: ListedSchedule) => (s.nextRunAt === null ? Number.POSITIVE_INFINITY : Date.parse(s.nextRunAt));
      return {
        schedules: rows
          .map((ref) => listed(keyOf(ref.path), ref.state as ScheduleRow))
          .sort((a, b) => due(a) - due(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      };
    }
  });

  const saveSchedule = handler({
    name: "workforce-save-schedule",
    inputSchema: saveScheduleInputSchema,
    outputSchema: saveScheduleOutputSchema,
    resources,
    execute: async (input, ctx) => {
      // The zone check dispatch runs (`validateScheduleConfig`), so a row this
      // saves never fails every fire as `invalid_schedule`.
      if (input.timezone !== undefined && !isKnownTimeZone(input.timezone)) {
        return {
          ok: false as const,
          error:
            `invalid_schedule: ${JSON.stringify(input.timezone)} is not a known time zone. ` +
            'Use an IANA time zone such as "Europe/London", or omit it for UTC. Nothing was saved.'
        };
      }
      if (!isFiveFieldCron(input.cron) || parseNextFireAt(input.cron, input.timezone ?? "UTC") === null) {
        return {
          ok: false as const,
          error:
            `invalid_schedule: cron ${JSON.stringify(input.cron)} in ${input.timezone ?? "UTC"} doesn't parse as five fields. ` +
            "Use exactly five fields (minute hour day-of-month month day-of-week) and an IANA time zone. Nothing was saved."
        };
      }
      const row: ScheduleRow = {
        cron: input.cron,
        kind: TASK_SCHEDULE_HANDLER,
        input: input.input,
        enabled: input.enabled ?? true,
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.description === undefined ? {} : { description: input.description })
      };
      await ctx.resources[SCHEDULES_RESOURCE].create(input.key, row, { replace: true });
      return { ok: true as const, schedule: listed(input.key, row) };
    }
  });

  const deleteSchedule = handler({
    name: "workforce-delete-schedule",
    inputSchema: z.object({ key: z.string().min(1) }).strict(),
    outputSchema: z.object({ ok: z.literal(true) }),
    resources,
    execute: async (input, ctx) => {
      await ctx.resources[SCHEDULES_RESOURCE].delete(input.key);
      // The fired record goes with the schedule, so the key saved again is a
      // new schedule. Its dispatch id is the one the endpoint keyed it by: the
      // org and user this run is admitted as, never the input.
      const identity = ctx.session.identity as { userId?: string; orgId?: string };
      if (identity.userId !== undefined && identity.orgId !== undefined) {
        await ctx.resources[FIRED_RECORDS_RESOURCE].delete(firedRecordCollectionKey(ROSTER_FLOW, formatScheduleId(identity.orgId, identity.userId, input.key)));
      }
      return { ok: true as const };
    }
  });

  const actions: Record<string, ActionConfig> = {
    [LIST_SCHEDULES_ACTION]: {
      inputSchema: listSchedules.inputSchema,
      block: listSchedules,
      description: "The user's schedules, each with when it is next due, worked out from its cron and time zone."
    },
    saveSchedule: {
      inputSchema: saveScheduleInputSchema,
      block: saveSchedule,
      description: "Save a schedule that files a task on a worker's board each time it is due. Saving an existing key replaces it."
    },
    deleteSchedule: {
      inputSchema: deleteSchedule.inputSchema,
      block: deleteSchedule,
      description: "Remove a schedule. A fire already dispatched still files."
    }
  };

  return {
    /** The schedule collection and the fired records, for the roster flow's `resources`. */
    resources: { [SCHEDULES_RESOURCE]: collection, [FIRED_RECORDS_RESOURCE]: firedRecords },
    /** The roster flow's `schedules`: a dispatch id resolves to its row. */
    schedules,
    /** `listSchedules`, `saveSchedule` and `deleteSchedule`, for the roster flow's `actions`. */
    actions
  };
}

/** Recurring work for one installation, as {@link defineScheduledWork} builds it. */
export type ScheduledWork = ReturnType<typeof defineScheduledWork>;
