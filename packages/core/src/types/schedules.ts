/**
 * Per-flow scheduled-action configuration types.
 *
 * The framework owns the configuration model and dispatch contract — the
 * `@flow-state-dev/scheduled` adapter mounts a route per flow, validates
 * incoming dispatches, and invokes `runAction`. The host owns the actual
 * scheduler (Vercel Cron, Cloud Scheduler, EventBridge, GitHub Actions,
 * `node-cron`) and any storage backing dynamic schedules.
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
import type { ActionCore } from "./flow";

/**
 * Subset of `StoreRegistry` exposed to dynamic resolvers. Defined
 * structurally in core so `defineFlow` can reference the resolver shape
 * without depending on `@flow-state-dev/engine` (which owns the full
 * `StoreRegistry` type). Resolvers receive the host's full `StoreRegistry`
 * at runtime — this type only narrows what the contract guarantees.
 */
export type ScheduleResolutionStores = {
  /**
   * Content store — the canonical entry point for resolvers backed by a
   * resource collection. Key shape is `(scopeType, scopeId, resourceKey)`.
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
   */
  principal?: ResolvedPrincipal;

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

  try {
    CronExpressionParser.parse(schedule.cron);
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
        `(the handler — handler/generator/sequencer/router) to run when the schedule fires.`
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
 * Construct a `ScheduleConfig` — the schedule sibling of `defineWebhookBinding`
 * / `defineChatBinding`. The schedule binding carries the shared `ActionCore`
 * (handler `block` plus execution policy) inline alongside the cron mapping.
 * Compile-time convenience only: the runtime is a single passthrough. Use it
 * for inline static entries (`schedules.static[id] = defineScheduleBinding({…})`)
 * or the value a dynamic `resolve()` returns.
 */
export function defineScheduleBinding(binding: ScheduleConfig): ScheduleConfig {
  return binding;
}
