/**
 * `defineScheduleCollection` — opinionated wrapper around
 * `defineResourceCollection` that mirrors every create/update/delete on
 * a user-scoped schedule collection into a `ScheduleIndex`. The index
 * is what the tick handler (`createScheduleTickHandler` in
 * `@flow-state-dev/vercel/schedules`) scans each cron beat for due
 * rows.
 *
 * Behaviour:
 *  - `enabled: false` rows are removed from the index (or skipped on
 *    create), so toggling a schedule off stops it from firing without
 *    deleting the underlying resource.
 *  - Cron parsing happens here (the index never parses); rows hand off
 *    a pre-computed `nextFireAt`.
 *  - When `index` is omitted, the collection behaves exactly like a
 *    plain `defineResourceCollection` — the same schema, no hooks. This
 *    lets test setups skip the index without restructuring code.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import type { ScheduleIndex, ScheduleIndexRow } from "./scheduleIndex";

/**
 * Schema for the state stored under each schedule resource. Mirrors the
 * shape consumed by `createResourceCollectionScheduleResolver` /
 * `ScheduleResourceState`.
 */
const SCHEDULE_RESOURCE_SCHEMA = z.object({
  cron: z.string(),
  action: z.string(),
  input: z.unknown().optional(),
  timezone: z.string().optional(),
  onOverlap: z.enum(["skip", "allow"]).optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true)
});

/** Inferred state shape for a schedule resource instance. */
export type ScheduleCollectionState = z.infer<typeof SCHEDULE_RESOURCE_SCHEMA>;

export interface DefineScheduleCollectionOptions {
  /**
   * Collection pattern. Must be user-scoped at the framework level;
   * `scope:"user"` is forced internally. Typically `"schedules/*"`.
   */
  pattern: string;
  /**
   * Optional schedule index. When provided, lifecycle hooks mirror
   * every create/update/delete into the index using `cron-parser` to
   * compute `nextFireAt`. When omitted, no hooks fire and the
   * collection is a plain `defineResourceCollection` over the schedule
   * schema.
   */
  index?: ScheduleIndex;
}

/**
 * Define a user-scoped schedule resource collection with optional
 * automatic mirroring into a `ScheduleIndex`. See module doc for
 * behavioural notes.
 */
export function defineScheduleCollection(
  opts: DefineScheduleCollectionOptions
) {
  const { index } = opts;

  return defineResourceCollection({
    pattern: opts.pattern,
    scope: "user",
    stateSchema: SCHEDULE_RESOURCE_SCHEMA,
    onInstanceCreated: index
      ? async (key, state, ctx) => {
          const typed = state as ScheduleCollectionState;
          if (typed.enabled === false) return;
          const row = rowFromState(ctx.scopeId, stripPrefix(key, opts.pattern), typed);
          if (row !== null) await index.upsert(row);
        }
      : undefined,
    onInstanceUpdated: index
      ? async (key, state, _prev, ctx) => {
          const typed = state as ScheduleCollectionState;
          const bareKey = stripPrefix(key, opts.pattern);
          if (typed.enabled === false) {
            await index.remove(ctx.scopeId, bareKey);
            return;
          }
          const row = rowFromState(ctx.scopeId, bareKey, typed);
          if (row !== null) await index.upsert(row);
        }
      : undefined,
    onInstanceDeleted: index
      ? async (key, ctx) => {
          await index.remove(ctx.scopeId, stripPrefix(key, opts.pattern));
        }
      : undefined
  });
}

/**
 * Strip the collection's literal prefix (everything before `*`) from a
 * full storage key, yielding the collection-relative key the
 * `ScheduleIndex` row carries.
 */
function stripPrefix(storageKey: string, pattern: string): string {
  const star = pattern.indexOf("*");
  if (star <= 0) return storageKey;
  const prefix = pattern.slice(0, star);
  return storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : storageKey;
}

/**
 * Compute a `ScheduleIndexRow` from a freshly persisted schedule state.
 * Returns `null` and logs a warning if the cron expression fails to
 * parse — the write succeeds (the resource is durable), but no index
 * row is mirrored, so a broken row never fires.
 */
function rowFromState(
  userId: string,
  key: string,
  state: ScheduleCollectionState
): ScheduleIndexRow | null {
  try {
    const next = CronExpressionParser.parse(state.cron, {
      tz: state.timezone
    })
      .next()
      .toDate()
      .getTime();
    return {
      userId,
      key,
      cron: state.cron,
      timezone: state.timezone,
      nextFireAt: next
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-state/scheduled] defineScheduleCollection: failed to parse cron "${state.cron}" for ${userId}/${key} — index row not mirrored`,
      err
    );
    return null;
  }
}
