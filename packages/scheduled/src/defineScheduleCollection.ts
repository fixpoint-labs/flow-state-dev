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
import { parseNextFireAt } from "./parseNextFireAt";
import type { ScheduleIndex, ScheduleIndexRow } from "./scheduleIndex";

/**
 * Schema for the state stored under each schedule resource. Mirrors the
 * shape consumed by `createResourceCollectionScheduleResolver` /
 * `ScheduleResourceState`.
 *
 * `kind` is a handler discriminator, not a flow-action name (FIX-838): a
 * block cannot be serialized into resource state, so the persisted row stores
 * a string key that the resolver maps to a real block via its host-provided
 * `blocks` map. This replaces the former `action` field — a breaking change to
 * the persisted record shape.
 */
const SCHEDULE_RESOURCE_SCHEMA = z.object({
  /**
   * The organization this schedule fires into (FIX-1442).
   *
   * Must be the organization of the execution that writes the row. It is not a
   * caller's choice: a row naming any other organization is refused from the
   * index below and therefore never fires, and a row naming none is a legacy
   * row, quarantined the same way. Nullable on the schema because both of
   * those states have to be readable to be diagnosed (BP-030).
   */
  orgId: z.string().optional(),
  cron: z.string(),
  kind: z.string(),
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
  const base = {
    pattern: opts.pattern,
    scope: "user" as const,
    stateSchema: SCHEDULE_RESOURCE_SCHEMA
  };

  const { index } = opts;
  if (!index) return defineResourceCollection(base);

  const bareKey = (storageKey: string) => stripPrefix(storageKey, opts.pattern);

  return defineResourceCollection({
    ...base,
    onInstanceCreated: async (key, state, ctx) => {
      const typed = state as ScheduleCollectionState;
      if (typed.enabled === false) return;
      if (!bindingIsTrusted(typed, ctx.orgId, ctx.scopeId, bareKey(key))) return;
      const row = rowFromState(ctx.scopeId, ctx.orgId, bareKey(key), typed);
      if (row !== null) await index.upsert(row);
    },
    onInstanceUpdated: async (key, state, _prev, ctx) => {
      const typed = state as ScheduleCollectionState;
      const k = bareKey(key);
      if (typed.enabled === false) {
        await index.remove(ctx.scopeId, k);
        return;
      }
      // A rewrite that moves the binding is not an update to honour — it is an
      // attempt to point somebody else's standing instruction somewhere new.
      // The row comes OUT of the index rather than being indexed under either
      // organization, so the schedule stops firing until it is written
      // correctly (BR-19).
      if (!bindingIsTrusted(typed, ctx.orgId, ctx.scopeId, k)) {
        await index.remove(ctx.scopeId, k);
        return;
      }
      const row = rowFromState(ctx.scopeId, ctx.orgId, k, typed);
      if (row !== null) {
        await index.upsert(row);
      } else {
        // New cron failed to parse. Remove whatever the index holds
        // (carrying the pre-update, valid cron) so the stale row stops
        // firing — otherwise claimDue would advance the old expression
        // indefinitely.
        await index.remove(ctx.scopeId, k);
      }
    },
    onInstanceDeleted: async (key, ctx) => {
      await index.remove(ctx.scopeId, bareKey(key));
    }
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
/**
 * Whether the row's stored organization is the one the writing execution was
 * admitted under.
 *
 * The hook observes a write rather than transforming it, so the binding is
 * enforced by refusing to index a row that disagrees — an unindexed schedule
 * never fires. That is the same outcome as rejecting the write for FIRING
 * only: the durable row is still overwritten by the disagreeing execution,
 * because a post-write observer has nothing left to reject.
 *
 * The check is a bare equality, and a legacy row with no organization at all
 * falls out of it rather than being named: `undefined` is never an execution's
 * org, so such a row is refused by construction and needs no clause of its own.
 */
function bindingIsTrusted(
  state: ScheduleCollectionState,
  executionOrgId: string,
  userId: string,
  key: string
): boolean {
  if (state.orgId === executionOrgId) return true;
  // eslint-disable-next-line no-console
  console.warn(
    `[flow-state/scheduled] schedule ${userId}/${key} is not indexed: its stored organization ` +
      `does not match the organization of the execution that wrote it. A schedule fires into ` +
      `the organization that created it; write the row from that organization, or attribute a ` +
      `pre-existing row with the upgrade recipe in the persistence guide.`
  );
  return false;
}

function rowFromState(
  userId: string,
  orgId: string,
  key: string,
  state: ScheduleCollectionState
): ScheduleIndexRow | null {
  const nextFireAt = parseNextFireAt(state.cron, state.timezone);
  if (nextFireAt === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-state/scheduled] defineScheduleCollection: failed to parse cron "${state.cron}" for ${userId}/${key} — index row not mirrored`,
    );
    return null;
  }
  return {
    userId,
    orgId,
    key,
    cron: state.cron,
    timezone: state.timezone,
    nextFireAt,
  };
}
