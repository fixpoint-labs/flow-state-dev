/**
 * Reference resolver for resource-collection-backed dynamic schedules.
 *
 * Parses the dispatch URL id into `(userId, collectionKey)`, reads the
 * resource via `stores.content.get("user", userId, ...)`, and
 * synthesizes `principal: { userId }` so the action runs as the
 * schedule's owner. The user-scoped storage key acts as the
 * impersonation guard: a URL like `evil/key` looks up
 * `("user", "evil", ...)` which won't find a resource owned by another
 * user.
 */
import type {
  ScheduleConfig,
  ScheduleResolutionContext
} from "@flow-state-dev/core/types";

export interface ScheduleResourceState {
  cron: string;
  action: string;
  input?: unknown;
  timezone?: string;
  onOverlap?: "skip" | "allow";
  description?: string;
  enabled?: boolean;
}

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

  return async (scheduleId, ctx) => {
    const parsed = parseId(scheduleId);
    if (parsed === null) return null;

    // The parsed userId is both the action's principal AND the storage
    // scope, so a URL aimed at another user's data reads from a scope
    // that doesn't contain it. No separate ownership check is needed.
    const resourceKey = `${prefix}${parsed.collectionKey}`;
    const raw = await ctx.stores.content.get("user", parsed.userId, resourceKey);
    if (raw === undefined) return null;

    let state: ScheduleResourceState;
    try {
      state = JSON.parse(raw) as ScheduleResourceState;
    } catch {
      return null;
    }

    if (state.enabled === false) return null;
    if (typeof state.cron !== "string" || typeof state.action !== "string") {
      return null;
    }

    const config: ScheduleConfig = {
      cron: state.cron,
      action: state.action,
      principal: { userId: parsed.userId }
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
