/**
 * Reference resolver for resource-collection-backed dynamic schedules.
 *
 * Parses the dispatch URL id into `(userId, collectionKey)`, reads the
 * resource via `stores.content.get("user", <user key>, ...)`, and
 * synthesizes `principal: { userId }` so the action runs as the
 * schedule's owner. The user-scoped storage key acts as the
 * impersonation guard: a URL like `evil/key` looks up the cell of user
 * `evil`, which won't find a resource owned by another user.
 *
 * The user key comes from the engine's own derivation, so it is the cell
 * the flow's runs wrote: the person's cross-org cell for an ordinary flow,
 * and the (org, person) cell for a hired seat, whose pin the dispatch route
 * passes in (FIX-1538). A seat's schedule therefore never resolves from the
 * person's cross-org cell, and a row in its cell that names another
 * organization than the pin resolves as missing.
 */
import { isValidOrgId } from "@flow-state-dev/core";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import type {
  BlockDefinition,
  ScheduleConfig,
  ScheduleResolutionContext
} from "@flow-state-dev/core/types";
import type { ScheduleCollectionState } from "./defineScheduleCollection";

/**
 * Shape persisted under each schedule resource. The single source of
 * truth is the zod schema in `defineScheduleCollection.ts`; this is
 * its inferred type, re-exported under the historical name for hosts
 * that wire the resolver without using `defineScheduleCollection`.
 */
export type ScheduleResourceState = ScheduleCollectionState;

export interface ParsedScheduleId {
  userId: string;
  collectionKey: string;
}

export interface CreateResourceCollectionScheduleResolverOptions {
  /**
   * The resource collection that holds schedule rows. Pass either a
   * `defineResourceCollection(...)` result or any value with a
   * `pattern` string. The helper extracts the literal prefix (everything
   * before `*`) to build the storage key.
   */
  collection: { pattern: string };
  /**
   * Handler registry keyed by the persisted row's `kind` discriminator
   * (FIX-838). A schedule binding carries its handler block inline, but a
   * block cannot be serialized into resource state — so the row stores a
   * `kind` string and the resolver maps it to a real block here. A row whose
   * `kind` is absent from this map resolves to `null` (404), exactly like an
   * unknown schedule id.
   */
  blocks: Record<string, BlockDefinition>;
  /**
   * Map a dispatch URL id back to `(userId, collectionKey)`. Default:
   * split on the first `/`. Return `null` to 404 the dispatch.
   */
  parseId?: (scheduleId: string) => ParsedScheduleId | null;
}

/** Default `parseId`. Splits on the first `/`; both halves must be non-empty. */
export function defaultParseScheduleId(
  scheduleId: string
): ParsedScheduleId | null {
  const slash = scheduleId.indexOf("/");
  if (slash <= 0) return null;
  const userId = scheduleId.slice(0, slash);
  const collectionKey = scheduleId.slice(slash + 1);
  if (userId.length === 0 || collectionKey.length === 0) return null;
  return { userId, collectionKey };
}

export function createResourceCollectionScheduleResolver(
  options: CreateResourceCollectionScheduleResolverOptions
): (
  scheduleId: string,
  ctx: ScheduleResolutionContext
) => Promise<ScheduleConfig | null> {
  const parseId = options.parseId ?? defaultParseScheduleId;
  const prefix = collectionPrefix(options.collection.pattern);
  const blocks = options.blocks;

  return async (scheduleId, ctx) => {
    const parsed = parseId(scheduleId);
    if (parsed === null) return null;

    // The parsed userId is both the action's principal AND the storage
    // scope, so a URL aimed at another user's data reads from a scope
    // that doesn't contain it. No separate ownership check is needed.
    // Derived the way every other user-scoped read derives it, so a hired
    // seat reads its (org, person) cell and never the person's cross-org
    // one. The schedule collection is shared (it declares no
    // `flowIsolation`), which is the non-isolated key.
    // A user-owned seat serves one person. A schedule id naming anyone else
    // answers exactly like a missing row, before any store is read, so the
    // route cannot be used to learn whether another person's row exists.
    if (ctx.ownerPin?.userId !== undefined && parsed.userId !== ctx.ownerPin.userId) {
      return null;
    }
    const resourceKey = `${prefix}${parsed.collectionKey}`;
    const scopeId = resolveUserStorageKey(parsed.userId, {
      id: ctx.flowKind,
      isolateUserState: false,
      ownerPin: ctx.ownerPin
    });
    const raw = await ctx.stores.content.get("user", scopeId, resourceKey);
    if (raw === undefined) return null;

    let state: ScheduleResourceState;
    try {
      state = JSON.parse(raw) as ScheduleResourceState;
    } catch {
      return null;
    }

    if (state.enabled === false) return null;
    if (typeof state.cron !== "string" || typeof state.kind !== "string") {
      return null;
    }

    // Map the persisted discriminator to a real handler block. An unknown
    // `kind` (host removed the handler, or a stale row) 404s the dispatch.
    const block = blocks[state.kind];
    if (block === undefined) return null;

    // The stored TARGET organization, and nothing else (BR-19, FIX-1442).
    //
    // Not the organization of the gateway that fired this beat, and not
    // whichever organization the target user is currently acting as: a
    // schedule is a standing instruction from the organization that created
    // it, and both of those alternatives would let a fire land somewhere the
    // creator never chose. A row written before schedules carried one has no
    // target to validate, so it does not dispatch at all — it is quarantined
    // until an operator attributes it, exactly like any other legacy record.
    if (!isValidOrgId(state.orgId)) return null;
    // A seat's schedule fires only into the seat's own organization. The cell
    // is already the pin's, so a row naming another one was not written by
    // this seat's runs, and does not dispatch (FIX-1538).
    if (ctx.ownerPin !== undefined && state.orgId !== ctx.ownerPin.orgId) return null;

    const config: ScheduleConfig = {
      cron: state.cron,
      block,
      principal: { userId: parsed.userId, orgId: state.orgId }
    };
    if (state.input !== undefined) config.input = state.input;
    if (typeof state.timezone === "string") config.timezone = state.timezone;
    if (state.onOverlap === "skip" || state.onOverlap === "allow") {
      config.onOverlap = state.onOverlap;
    }
    if (typeof state.description === "string") {
      config.description = state.description;
    }

    return config;
  };
}

function collectionPrefix(pattern: string): string {
  const idx = pattern.search(/[*[]/);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}
