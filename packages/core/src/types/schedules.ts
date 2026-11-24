/**
 * Per-flow scheduled-action configuration types.
 *
 * The framework owns the configuration model and dispatch contract — the
 * engine's router mounts the scheduled endpoint on every app, validates
 * incoming dispatches, and invokes `runAction`. The engine's one schedule
 * tick fires every static and dynamic schedule through that endpoint; when it
 * runs is `createFlowState({ scheduler })` (the engine's local cron by
 * default). The app owns any storage backing dynamic schedules.
 *
 * `schedules` is a *resolution surface*: a static map (the framework-cron
 * case) plus an optional `resolve(scheduleId, ctx)` hook that returns a
 * schedule on demand. Hosts back the resolver with whatever store fits.
 *
 * V1 ships singleton invocation per dispatch — one tick fires one
 * `runAction` call. Fan-out (one tick → many invocations) is a follow-up.
 */

import { CronExpressionParser } from "cron-parser";
import type { ResolvedPrincipal } from "./auth";
import type { ActionCore, InstanceOwnerPin } from "./flow";

/**
 * Subset of `StoreRegistry` exposed to dynamic resolvers. Defined
 * structurally in core so `defineFlow` can reference the resolver shape
 * without depending on `@flow-state-dev/engine` (which owns the full
 * `StoreRegistry` type). Resolvers receive the host's full `StoreRegistry`
 * at runtime — this type only narrows what the contract guarantees.
 */
export type ScheduleResolutionStores = {
  /**
   * Resource state store — where a resource collection's `create` / `setState`
   * / `patchState` persist each instance's state, so the canonical entry point
   * for resolvers backed by one. Key shape is `(scopeType, scopeId,
   * resourceKey)`; a missing (or deleted) instance reads as `undefined`.
   */
  readonly resourceState: {
    get(
      scopeType: "session" | "user" | "org",
      scopeId: string,
      resourceKey: string
    ): Promise<{ state: Record<string, unknown> } | undefined>;
  };
  /**
   * Content store — an instance's content body (`writeContent`), which is
   * separate from its state. Key shape is `(scopeType, scopeId, resourceKey)`.
   */
  readonly content: {
    get(
      scopeType: "session" | "user" | "org",
      scopeId: string,
      resourceKey: string
    ): Promise<string | undefined>;
  };
};

/**
 * Context passed to `SchedulesConfig.resolve` when the dispatch endpoint
 * needs to look up a schedule that is not in `static`. Carries the raw
 * dispatch URL id, the flow kind, the dispatch caller's gateway principal
 * (typically a system user), the underlying HTTP request, and the host's
 * store registry for resolvers that read directly from a store.
 */
export type ScheduleResolutionContext = {
  flowKind: string;
  /**
   * Principal of the dispatch caller, established by gateway auth (the
   * shared scheduler secret typically yields a system principal).
   * Non-authoritative for the scheduled action itself — that comes from
   * the resolved `ScheduleConfig.principal`. Provided here for resolvers
   * that need to authorize the lookup against the caller.
   */
  gatewayPrincipal: ResolvedPrincipal;
  /** Adapter-provided raw HTTP request (body, headers). */
  request: Request;
  /**
   * The host's store registry. Typed structurally so this contract can
   * live in core; resolvers receive the full `StoreRegistry` at runtime.
   */
  stores: ScheduleResolutionStores;
  /**
   * The storage key of `userId`'s cell in `orgId`, for data no flow isolates:
   * where a user-scoped resource collection that declares no `flowIsolation`
   * (a schedule collection) keeps its rows. Supplied by the dispatch endpoint,
   * which owns the engine's key derivation, so a resolver reads a user's row
   * without depending on the engine.
   */
  userStorageKey(userId: string, orgId: string): string;
  // FIX-1798.
  /**
   * The owner pin of the registered instance this dispatch addresses, when
   * that instance is pinned to an owner; absent for every other flow. Taken
   * from the registry, never from the request. It chooses no storage key:
   * user-scoped storage is keyed by the organization the schedule id names
   * (see `resolveUserStorageKey` in `@flow-state-dev/engine`). A resolver uses
   * it only to refuse an id naming another organization than the pin's, or
   * another user than a user-owned pin's. Removed with owner pins.
   */
  ownerPin?: InstanceOwnerPin;
};

/**
 * Context passed to a `ScheduleInputFn` at dispatch time. Captures the
 * resolved schedule's identity, the nominal fire time supplied by the
 * host scheduler (or `now()` if absent), and the effective principal the
 * action will run as.
 */
export type ScheduleInputContext = {
  scheduleId: string;
  /** Cron expression as configured. */
  cron: string;
  /** ISO-8601 fire time supplied by the host scheduler in the dispatch body, or now() if absent. */
  nominalFireTime: string;
  /** Effective principal for this dispatch (the schedule's `principal`, falling back to the gateway principal). */
  principal: ResolvedPrincipal;
  /** The flow kind. */
  flowKind: string;
  /** "static" or "dynamic" — useful for input functions that branch on origin. */
  origin: "static" | "dynamic";
};

/** Input function called server-side at dispatch time. */
export type ScheduleInputFn = (ctx: ScheduleInputContext) => unknown | Promise<unknown>;

/**
 * Single scheduled-action declaration — an action in scheduled form. It
 * extends the shared `ActionCore` (the handler `block` plus execution policy
 * like `durable` and `tokenBudget`) with the schedule-specific cron mapping.
 * Because it carries the core inline, the handler needs no entry in
 * `flow.actions`: a fired schedule reaches it only through the dispatch
 * endpoint, never the public action surface or MCP.
 *
 * Static entries live in `SchedulesConfig.static` and are validated at
 * registration time; the dispatch resolves them through `resolveActionCore`
 * via the `metadata.schedule.scheduleId` coordinate. Dynamic entries are
 * produced by the resolver hook and validated at dispatch time (failures map
 * to `400 invalid_schedule`); their core is carried inline on the dispatch
 * envelope because no static coordinate can reach it — so durable dynamic
 * schedules are not crash-recoverable (a documented non-goal).
 */
export type ScheduleConfig = ActionCore & {
  /**
   * POSIX 5-field cron expression: `minute hour dom month dow`. Validated
   * via `cron-parser`. Display-only — the framework does not run the
   * schedule; the host's scheduler does.
   */
  cron: string;

  /**
   * Input passed to the handler. Either a static value (validated against
   * the binding's effective input schema at registration for static
   * schedules; deferred to runtime for dynamic) or a function called
   * server-side at dispatch time.
   */
  input?: unknown | ScheduleInputFn;

  // FIX-1442; BR-19.
  /**
   * The principal the action runs as — the *target*, not the dispatch
   * caller. For static framework-level schedules this is typically a
   * system principal (`{ userId: "system" }`). For dynamic per-user
   * schedules this is the owning user's principal (the resolver pulls
   * it from the persisted schedule record).
   *
   * If omitted, the adapter falls back to the gateway principal
   * established by the dispatch endpoint's `host.resolvePrincipal` call.
   * Static schedules typically rely on the fallback; dynamic schedules
   * almost always set this explicitly.
   *
   * The organization may be omitted while the user is named, and then it
   * alone falls back to the gateway's. That is for a STATIC
   * schedule, whose principal is trusted config written in the flow
   * definition. A dynamic schedule must not reach that fallback — a stored
   * schedule fires into the organization that created it, not into whichever
   * one happens to be firing the beat — so its resolver refuses to build a
   * config without the stored organization.
   */
  principal?: { userId: string; orgId?: string };

  /**
   * Optional IANA timezone identifier (e.g., `"America/New_York"`).
   * Opaque metadata — the host's scheduler does the time-zone math.
   * Default: `"UTC"`.
   */
  timezone?: string;

  /**
   * Behavior when a previous invocation of *this schedule id* is still
   * in flight.
   *
   * - `"skip"` (default): adapter responds 200 with `{ status: "skipped" }`,
   *   no `runAction` call.
   * - `"allow"`: dispatch proceeds; concurrent invocations are permitted.
   *
   * `"queue"` is reserved as a future enum value but not implemented in v1
   * (it requires durable queueing).
   */
  onOverlap?: "skip" | "allow";

  // FIX-2886 D1.
  /**
   * Where this schedule's fires run.
   *
   * - `"per-fire"` (default): each fire is a one-off run in a session of its
   *   own.
   * - `"per-schedule"`: every fire runs in one session, kept for this
   *   schedule. The framework derives its id from the org and user the fire
   *   runs as, the flow instance and the schedule id, and reserves its
   *   prefix: only a scheduled dispatch may create the session or run in it,
   *   while its owner can still list and read it. The flow's
   *   `session.retention` caps its history.
   *
   * A preset, not an id: a schedule can't name the session it fires into.
   */
  session?: "per-fire" | "per-schedule";

  /**
   * Optional human description, surfaced in DevTool and the listing
   * endpoint. Free text.
   */
  description?: string;

  /**
   * Whether the schedule is enabled. Default `true`. Disabled schedules
   * appear in the listing endpoint (so operators can see them) but the
   * dispatch endpoint short-circuits with 404. Mostly useful for static;
   * dynamic resolvers can simply return `null` for disabled records.
   */
  enabled?: boolean;
};

/**
 * Per-flow scheduled-actions configuration. `static` covers the framework
 * cron-job case; `resolve` is the dynamic case (per-user, per-record,
 * agent-created). The dispatch handler tries `static[id]` first and falls
 * back to `resolve(id, ctx)`.
 */
export type SchedulesConfig = {
  /** Statically declared schedules, looked up by id first. */
  static?: Record<string, ScheduleConfig>;

  /**
   * Dynamic resolver. Called when `static[id]` is absent. Receives the
   * raw schedule id from the dispatch URL plus context (flow kind, the
   * adapter's resolved gateway principal, request, and host stores).
   * Return `null` to 404 the dispatch.
   *
   * Implementations typically read from a host-owned store keyed by
   * schedule id and return the persisted schedule definition.
   */
  resolve?: (
    scheduleId: string,
    ctx: ScheduleResolutionContext
  ) => Promise<ScheduleConfig | null> | ScheduleConfig | null;

  // FIX-2536.
  /**
   * The schedule index this flow's dynamic schedules are mirrored into
   * (`@flow-state-dev/scheduled`'s `ScheduleIndex`). The app's schedule tick
   * claims due entries from it and dispatches them to this flow, so the
   * flow's schedules fire with no cron of the host's own. One index serves
   * one flow. Typed structurally so this contract can live in core.
   */
  index?: ScheduleDueSource;
};

/**
 * One due entry a schedule index hands back: who it runs as, in which org, its
 * key, the time it was due, and the cron and time zone it runs on (so a tick
 * that comes late fires it for its latest due time, not the first it missed).
 */
export type ScheduleDueEntry = {
  userId: string;
  orgId?: string;
  key: string;
  cron: string;
  /** IANA time zone the cron is read in. Default `"UTC"`. */
  timezone?: string;
  nextFireAt: number;
};

// FIX-2752.
/**
 * The dispatch id of a dynamic schedule: `<orgId>/<userId>/<key>`, each part
 * URL-encoded so an org or user id containing `/` round-trips. The engine's
 * schedule tick dispatches by it, and `@flow-state-dev/scheduled`'s
 * `defaultParseScheduleId` reads it back.
 *
 * Put it on a dispatch URL as one more encoded path segment, since the router
 * decodes each segment once:
 * `/api/flows/<kind>/schedules/${encodeURIComponent(formatScheduleId(...))}/dispatch`.
 */
export function formatScheduleId(orgId: string, userId: string, key: string): string {
  return [orgId, userId, key].map(encodeURIComponent).join("/");
}

// FIX-2752.
/**
 * The latest scheduled time of `cron` in `timezone` at or before `at` (ms), or
 * `null` when the cron has none (or does not parse). Shared by the engine's
 * schedule tick, which fires each schedule for its latest due time, and the
 * scheduled endpoint, which checks the time a fire carries.
 */
export function latestScheduledTime(cron: string, timezone: string, at: number): number | null {
  try {
    // `prev()` is strictly before its current date, so start a millisecond on.
    return CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date(at + 1) })
      .prev()
      .toDate()
      .getTime();
  } catch {
    return null;
  }
}

// FIX-2753.
/**
 * The first scheduled time of `cron` in `timezone` strictly after `at` (ms), or
 * `null` when the cron has none (or does not parse). The scheduled endpoint
 * reads it beside {@link latestScheduledTime} to find the scheduled time a
 * fire's carried time is nearest.
 */
export function nextScheduledTime(cron: string, timezone: string, at: number): number | null {
  try {
    return CronExpressionParser.parse(cron, { tz: timezone, currentDate: new Date(at) })
      .next()
      .toDate()
      .getTime();
  } catch {
    return null;
  }
}

// FIX-2753.
/**
 * Where the scheduled endpoint keeps each schedule's fired record: the latest
 * scheduled time it fired, one row per schedule, in the user cell of the
 * principal the schedule runs as. A flow that deletes a schedule deletes its
 * record with it, through a collection over this pattern, at user scope. A
 * key holds `/`, so any depth.
 */
export const FIRED_RECORDS_PATTERN = "scheduled-fires/**";

/** {@link FIRED_RECORDS_PATTERN}'s prefix, without its wildcard. */
const FIRED_RECORDS_PREFIX = "scheduled-fires/";

/**
 * A schedule's fired-record key within {@link FIRED_RECORDS_PATTERN}: the
 * flow the schedule is dispatched on, then its dispatch id.
 */
export function firedRecordCollectionKey(flowKind: string, scheduleId: string): string {
  return `${flowKind}/${scheduleId}`;
}

/** A schedule's fired-record resource key, prefix included. */
export function firedRecordKey(flowKind: string, scheduleId: string): string {
  return `${FIRED_RECORDS_PREFIX}${firedRecordCollectionKey(flowKind, scheduleId)}`;
}

/** What a host's tick needs of a schedule index: claim the entries due by `now`, advancing them. */
export type ScheduleDueSource = {
  claimDue(now: number, limit?: number): Promise<readonly ScheduleDueEntry[]>;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Schedule id pattern for the static map. Lowercase alphanumeric + dashes,
 * max 64 characters. Tighter than the dispatch URL pattern; intentionally
 * conservative for source-declared ids.
 */
const STATIC_SCHEDULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Whether `cron` is exactly five whitespace-separated fields (minute hour
 * day-of-month month day-of-week). `cron-parser` reads a sixth field as
 * seconds and fills missing ones, so parsing alone admits a schedule that
 * fires every second, or one that means something other than it says.
 */
export function isFiveFieldCron(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}

/**
 * Whether `timezone` is an IANA time zone this runtime knows: the check
 * `validateScheduleConfig` runs, for a write path to run before it saves one.
 */
export function isKnownTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone.length > 0;
  } catch {
    return false;
  }
}

/**
 * Per-entry validator. Used at registration time for the static map and
 * at dispatch time by the adapter for resolved dynamic schedules. Throws
 * on malformed input — adapter callers translate the throw into a 400.
 *
 * Static-origin ids must match the strict pattern; dynamic ids are
 * validated separately by the dispatch route and skip the id format
 * check here (they may legitimately contain `:` and `/`).
 */
export function validateScheduleConfig(args: {
  kind: string;
  id: string;
  schedule: ScheduleConfig;
  origin: "static" | "dynamic";
}): void {
  const { kind, id, schedule, origin } = args;

  if (origin === "static" && !STATIC_SCHEDULE_ID_RE.test(id)) {
    throw new Error(
      `Flow "${kind}" schedule "${id}" has an invalid id. ` +
        `Use lowercase alphanumeric characters and dashes (max 64).`
    );
  }

  if (!isFiveFieldCron(schedule.cron)) {
    throw new Error(
      `Flow "${kind}" schedule "${id}" has an invalid cron expression ${JSON.stringify(schedule.cron)}: it is not exactly five fields. ` +
        `Use POSIX 5-field syntax (minute hour day-of-month month day-of-week): a sixth field would be read as seconds.`
    );
  }

  // The zone is validated with the cron: an unknown one would otherwise leave
  // a schedule that resolves on every fire and never names a scheduled time.
  if (schedule.timezone !== undefined && !isKnownTimeZone(schedule.timezone)) {
    throw new Error(
      `Flow "${kind}" schedule "${id}" has an unknown time zone ${JSON.stringify(schedule.timezone)}. ` +
        `Use an IANA time zone such as "Europe/London", or omit it for UTC.`
    );
  }

  try {
    CronExpressionParser.parse(schedule.cron, schedule.timezone === undefined ? {} : { tz: schedule.timezone });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Flow "${kind}" schedule "${id}" has an invalid cron expression ${JSON.stringify(schedule.cron)}: ${message}. ` +
        `Expected POSIX 5-field syntax (minute hour day-of-month month day-of-week).`
    );
  }

  if (schedule.block === null || typeof schedule.block !== "object") {
    throw new Error(
      `Flow "${kind}" schedule "${id}" must declare a \`block\` ` +
        `(the handler — any block kind) to run when the schedule fires.`
    );
  }

  if (schedule.input !== undefined && typeof schedule.input !== "function") {
    const inputSchema = schedule.inputSchema ?? schedule.block?.inputSchema;
    if (inputSchema && typeof inputSchema.safeParse === "function") {
      const result = inputSchema.safeParse(schedule.input);
      if (!result.success) {
        throw new Error(
          `Flow "${kind}" schedule "${id}" has input that does not match its ` +
            `handler block's inputSchema: ${result.error.message}.`
        );
      }
    }
  }

  if (
    schedule.onOverlap !== undefined &&
    schedule.onOverlap !== "skip" &&
    schedule.onOverlap !== "allow"
  ) {
    throw new Error(
      `Flow "${kind}" schedule "${id}" has unsupported onOverlap value ${JSON.stringify(schedule.onOverlap)}. ` +
        `Use "skip" (default) or "allow". "queue" is reserved for a future durable-queue release.`
    );
  }

  if (
    schedule.session !== undefined &&
    schedule.session !== "per-fire" &&
    schedule.session !== "per-schedule"
  ) {
    throw new Error(
      `Flow "${kind}" schedule "${id}" has unsupported session value ${JSON.stringify(schedule.session)}. ` +
        `Use "per-fire" (default) or "per-schedule". A schedule can't name its session: the framework derives it.`
    );
  }

  if (schedule.principal !== undefined) {
    if (
      typeof schedule.principal.userId !== "string" ||
      schedule.principal.userId.length === 0
    ) {
      throw new Error(
        `Flow "${kind}" schedule "${id}" has an invalid principal: userId must be a non-empty string.`
      );
    }
  }
}

/**
 * Iterate `schedules.static` and validate every entry. Called from
 * `createFlowInstance` at registration time. Dynamic entries are not
 * validated here — the adapter validates each one at dispatch time.
 */
export function validateSchedulesConfig(
  flowKind: string,
  schedules: SchedulesConfig | undefined
): void {
  if (!schedules?.static) return;

  for (const [id, schedule] of Object.entries(schedules.static)) {
    validateScheduleConfig({ kind: flowKind, id, schedule, origin: "static" });
  }
}

/**
 * Construct a `ScheduleConfig` — the schedule sibling of `defineWebhookBinding`.
 * The schedule binding carries the shared `ActionCore`
 * (handler `block` plus execution policy) inline alongside the cron mapping.
 * Compile-time convenience only: the runtime is a single passthrough. Use it
 * for inline static entries (`schedules.static[id] = defineScheduleBinding({…})`)
 * or the value a dynamic `resolve()` returns.
 */
export function defineScheduleBinding(binding: ScheduleConfig): ScheduleConfig {
  return binding;
}
