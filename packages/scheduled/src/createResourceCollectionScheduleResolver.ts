/**
 * Reference resolver for resource-collection-backed dynamic schedules.
 *
 * Parses the dispatch id into `(orgId, userId, collectionKey)`, reads the
 * row's state via `stores.resourceState.get("user", <user key>, ...)`, and
 * synthesizes `principal: { userId, orgId }` so the action runs as the
 * schedule's owner in the org that saved it. The user key is the guard: a
 * URL like `acme/evil/key` reads the cell of user `evil` in `acme`, which
 * won't hold a row another user saved.
 *
 * The user key comes from the engine's own derivation, so it is the cell
 * the flow's runs wrote: the user's cell in the org the id names. The id
 * selects a cell and grants nothing: a row there that names another org
 * resolves as missing, as does an id naming no org. On a hired worker the
 * id must also name the pin's org, and on a private one the pin's user.
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

/** The parts a dynamic schedule's dispatch id names. */
export interface ParsedScheduleId {
  /** The org the schedule was saved in, and fires into. */
  orgId: string;
  /** Who the schedule runs as. */
  userId: string;
  /** The row's key inside the schedule collection. */
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
   * Map a dispatch id back to `(orgId, userId, collectionKey)`. Default:
   * {@link defaultParseScheduleId}. Return `null` to 404 the dispatch.
   */
  parseId?: (scheduleId: string) => ParsedScheduleId | null;
}

/**
 * The dispatch id of a dynamic schedule: `<orgId>/<userId>/<key>`, each part
 * URL-encoded so an org or user id containing `/` round-trips. The inverse of
 * {@link defaultParseScheduleId}.
 *
 * Put it on a dispatch URL as one more encoded path segment, since the router
 * decodes each segment once:
 * `/api/flows/<kind>/schedules/${encodeURIComponent(formatScheduleId(...))}/dispatch`.
 */
export function formatScheduleId(orgId: string, userId: string, key: string): string {
  return [orgId, userId, key].map(encodeURIComponent).join("/");
}

/**
 * Default `parseId`: `<orgId>/<userId>/<key>`. Splits on the first two `/`
 * and URL-decodes each part; the key keeps any further `/`, so a hand-built
 * nested key stays whole. All three parts must be non-empty, and an id with
 * fewer parts names no org and parses as `null`.
 */
export function defaultParseScheduleId(
  scheduleId: string
): ParsedScheduleId | null {
  const first = scheduleId.indexOf("/");
  const second = first < 0 ? -1 : scheduleId.indexOf("/", first + 1);
  if (second < 0) return null;
  const parts = [
    scheduleId.slice(0, first),
    scheduleId.slice(first + 1, second),
    scheduleId.slice(second + 1)
  ];
  if (parts.some((part) => part.length === 0)) return null;
  let decoded: string[];
  try {
    decoded = parts.map(decodeURIComponent);
  } catch {
    return null;
  }
  const [orgId, userId, collectionKey] = decoded as [string, string, string];
  return { orgId, userId, collectionKey };
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
    // An id that names no usable org selects no cell, and the cross-org cell
    // is never the answer.
    if (!isValidOrgId(parsed.orgId)) return null;

    // A hired worker serves one org, and a user-owned one serves one person.
    // An id naming anything else answers exactly like a missing row, before
    // any store is read, so the route cannot be used to learn whether another
    // org's or person's row exists.
    if (ctx.ownerPin !== undefined && parsed.orgId !== ctx.ownerPin.orgId) return null;
    if (ctx.ownerPin?.userId !== undefined && parsed.userId !== ctx.ownerPin.userId) {
      return null;
    }

    // The parsed user and org are both the action's principal AND the
    // storage cell, so a URL aimed at another user's data reads a cell that
    // doesn't contain it. Derived the way every other user-scoped read
    // derives it. The schedule collection is shared (it declares no
    // `flowIsolation`), which is the non-isolated key.
    const resourceKey = `${prefix}${parsed.collectionKey}`;
    const scopeId = resolveUserStorageKey(parsed.userId, parsed.orgId, {
      id: ctx.flowKind,
      isolateUserState: false
    });
    // Resource state, where the collection's `create` wrote the row — not the
    // content store, which holds an instance's content body and never a
    // schedule row (FIX-1545).
    const row = await ctx.stores.resourceState.get("user", scopeId, resourceKey);
    if (row === undefined) return null;
    const state = row.state as Partial<ScheduleResourceState>;

    if (state.enabled === false) return null;
    if (typeof state.cron !== "string" || typeof state.kind !== "string") {
      return null;
    }

    // Map the persisted discriminator to a real handler block. An unknown
    // `kind` (host removed the handler, or a stale row) 404s the dispatch.
    const block = blocks[state.kind];
    if (block === undefined) return null;

    // The stored TARGET organization, which must be the one the id names
    // (BR-19, FIX-1442, FIX-1790).
    //
    // Not the organization of the gateway that fired this beat, and not
    // whichever organization the target user is currently acting as: a
    // schedule is a standing instruction from the organization that created
    // it. The id only selected the cell; a row there naming another org, or
    // none, was not written by a run in this org, and does not dispatch.
    if (state.orgId !== parsed.orgId) return null;

    const config: ScheduleConfig = {
      cron: state.cron,
      block,
      principal: { userId: parsed.userId, orgId: parsed.orgId }
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
