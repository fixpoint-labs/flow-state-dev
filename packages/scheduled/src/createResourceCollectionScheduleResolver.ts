/**
 * Reference dynamic-store resolver.
 *
 * Wires `schedules.resolve` to a flow-state resource collection in one
 * line. The dispatch URL id is parsed into `(userId, collectionKey)`,
 * the resource is read via `stores.content.get`, and a `ScheduleConfig`
 * is synthesized with `principal: { userId }` so the action runs as the
 * schedule's owner — not as the gateway's system principal.
 *
 * Hosts that prefer their own storage (DB table, external service)
 * implement `schedules.resolve` directly. The contract this helper
 * satisfies — `(scheduleId, ctx) → ScheduleConfig | null` — is the only
 * thing the dispatch handler depends on.
 *
 * The default id format is `<userId>/<collectionKey>`. Custom
 * `parseId` / `formatId` hooks support richer compositions.
 */
import type {
  ScheduleConfig,
  ScheduleResolutionContext
} from "@flow-state-dev/core/types";

/**
 * Persisted state shape for a schedule resource. Mirrors `ScheduleConfig`
 * minus the synthesized `principal` (the helper assigns this from the
 * resource's owning userId at resolution time).
 */
export interface ScheduleResourceState {
  cron: string;
  action: string;
  input?: unknown;
  timezone?: string;
  onOverlap?: "skip" | "allow";
  description?: string;
  enabled?: boolean;
}

/**
 * Minimal collection-shape required by the helper. Keeps the helper
 * decoupled from the full `ResourceCollectionRef` type so consumers can
 * pass either a `defineResourceCollection` result or a structurally
 * compatible value (a stub in tests).
 */
export interface ScheduleResolverCollection {
  /** Glob-style pattern, e.g., `"schedules/*"`. The helper extracts the prefix to build the resource key. */
  pattern: string;
}

export interface ParsedScheduleId {
  userId: string;
  collectionKey: string;
}

export interface CreateResourceCollectionScheduleResolverOptions {
  /** The resource collection that holds schedule rows. */
  collection: ScheduleResolverCollection;
  /**
   * Map a dispatch URL id back to `(userId, collectionKey)`. Default:
   * split on the first `/`. Return `null` to 404 the dispatch.
   */
  parseId?: (scheduleId: string) => ParsedScheduleId | null;
  /**
   * Compose a dispatch URL id from a `(userId, collectionKey)` pair. Not
   * used by the helper itself but provided to callers so they can build
   * dispatch URLs without re-implementing the convention. Default mirrors
   * `parseId`.
   */
  formatId?: (parsed: ParsedScheduleId) => string;
}

/**
 * Default `parseId`. Splits on the first `/`. Both halves must be
 * non-empty.
 */
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

export function defaultFormatScheduleId(parsed: ParsedScheduleId): string {
  return `${parsed.userId}/${parsed.collectionKey}`;
}

/**
 * Build a `schedules.resolve` function that reads from the given
 * resource collection. The collection's pattern must end with `/*` (or
 * be `*`), and the resolver concatenates the parsed key onto the
 * collection's prefix to form the storage key.
 */
export function createResourceCollectionScheduleResolver(
  options: CreateResourceCollectionScheduleResolverOptions
): (
  scheduleId: string,
  ctx: ScheduleResolutionContext
) => Promise<ScheduleConfig | null> {
  const { collection } = options;
  const parseId = options.parseId ?? defaultParseScheduleId;
  const prefix = extractCollectionPrefix(collection.pattern);

  return async (scheduleId, ctx) => {
    const parsed = parseId(scheduleId);
    if (parsed === null) return null;

    const resourceKey = `${prefix}${parsed.collectionKey}`;
    const raw = await ctx.stores.content.get("user", parsed.userId, resourceKey);
    if (raw === undefined) return null;

    let state: ScheduleResourceState;
    try {
      state = JSON.parse(raw) as ScheduleResourceState;
    } catch {
      return null;
    }

    if (state === null || typeof state !== "object") return null;
    if (state.enabled === false) return null;
    if (typeof state.cron !== "string" || typeof state.action !== "string") {
      // Helper does not throw — the dispatch route validates and surfaces a
      // 400 only when the schedule has fields the runtime can interpret.
      // Returning null produces a 404 which is the right answer for a row
      // missing required fields.
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
    if (typeof state.description === "string") config.description = state.description;

    return config;
  };
}

/**
 * Extract the literal prefix from a collection pattern. Mirrors the
 * convention used elsewhere in the framework — `"schedules/*"` →
 * `"schedules/"`, `"foo/[topic]/bar"` → `"foo/"`. Patterns that do not
 * start with a literal segment (rare) fall back to an empty prefix and
 * the parsed key becomes the storage key as-is.
 */
function extractCollectionPrefix(pattern: string): string {
  const idx = firstWildcardIndex(pattern);
  if (idx === -1) return pattern;
  return pattern.slice(0, idx);
}

function firstWildcardIndex(pattern: string): number {
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" || ch === "[") return i;
  }
  return -1;
}
