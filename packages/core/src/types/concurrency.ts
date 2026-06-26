/**
 * Session-scoped concurrency policy types for actions.
 *
 * When two requests target the same session (or other derived key) while one
 * is already in flight, the concurrency policy decides what happens: run them
 * in parallel, serialize them in arrival order, or drop the newcomer. This is
 * the framework's generalization of the scheduled-action `onOverlap` idiom
 * (`schedules.ts`) from a schedule-id-keyed check into a flow/action-level
 * policy enforced once at the shared dispatch seam, so every transport (HTTP,
 * chat, webhook, scheduled, MCP) inherits the same behavior.
 *
 * This file owns the *author surface* (the config shape declared on a flow)
 * and its definition-time validation. The runtime that enforces a resolved
 * policy lives in `@flow-state-dev/engine` (the arbiter + keyed async gate).
 *
 * v1 ships `allow` (default), `queue`, and `reject`. `debounce` and `restart`
 * are reserved in the enum so the fast-follow is purely additive, but they are
 * rejected at definition time today (see `validateConcurrencyConfig`).
 */

/**
 * All policy names. `debounce` (collapse-a-burst) and `restart`
 * (cancel-in-flight) are reserved: they parse into the type so the follow-up
 * work is additive, but `validateConcurrencyConfig` rejects them in v1.
 *
 * - `allow` (default): run concurrently. Today's behavior, fully backward
 *   compatible.
 * - `queue`: serialize requests on the key in arrival order (FIFO). One runs
 *   to completion before the next starts.
 * - `reject`: while one request holds the key, drop a competing one (the
 *   caller gets a 409-shaped error naming the in-flight request).
 */
export type ConcurrencyPolicyName = "allow" | "queue" | "reject" | "debounce" | "restart";

/**
 * What the policy keys on. Preset names resolve from the dispatch envelope; a
 * function returns a custom key (or `undefined` to opt this dispatch out of
 * arbitration entirely).
 *
 * - `"session"` (default): the tenant-namespaced session id; resolves to
 *   `undefined` (no arbitration) when the dispatch has no session.
 * - `"user"`: the tenant-namespaced user id.
 * - `"none"`: disable arbitration for this action.
 * - a function: returns a custom key string, or `undefined` for no arbitration
 *   (e.g. a webhook delivery id pulled from `metadata`).
 */
export type ConcurrencyKey =
  | "session"
  | "user"
  | "none"
  | ((ctx: ConcurrencyKeyContext) => string | undefined);

/**
 * Minimal, serializable view of a dispatch passed to a custom
 * `ConcurrencyKey` function. Carries only the request-derived coordinates a
 * key derivation could reasonably need — not the full envelope — so a custom
 * key stays a pure function of dispatch identity.
 */
export interface ConcurrencyKeyContext {
  flowKind: string;
  actionName: string;
  sessionId?: string;
  userId: string;
  tenantId?: string;
  orgId?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Concurrency policy as declared on a flow. The string shorthand uses the
 * default key (`"session"`); the object form overrides the key.
 *
 * The `debounce` object shape (`{ policy: "debounce"; windowMs; maxWaitMs? }`)
 * is reserved for the fast-follow and is rejected by validation in v1.
 */
export type ConcurrencyConfig =
  | "allow"
  | "queue"
  | "reject"
  | { policy: "allow" | "queue" | "reject"; key?: ConcurrencyKey };

/**
 * The v1-implemented policy names. `validateConcurrencyConfig` rejects
 * anything outside this set; the arbiter switches over exactly these.
 */
const V1_POLICIES = new Set<string>(["allow", "queue", "reject"]);

/** Reserved policy names that parse but are not implemented in v1. */
const RESERVED_POLICIES = new Set<string>(["debounce", "restart"]);

/**
 * Validate a flow/action concurrency config at definition time. Mirrors
 * `validateScheduleConfig`'s shape: throws a plain `Error` (callers translate
 * to a build-time failure) when the policy is reserved (`debounce` / `restart`)
 * or unknown. A no-op when `config` is absent — the default `allow` applies.
 *
 * `where` names the offending site (e.g. `flow "x" action "y"` or
 * `flow "x" request default`) so the error points the author at the exact
 * config to fix.
 */
export function validateConcurrencyConfig(
  where: string,
  config: ConcurrencyConfig | undefined
): void {
  if (config === undefined) return;

  const policy = typeof config === "string" ? config : config.policy;

  if (RESERVED_POLICIES.has(policy)) {
    throw new Error(
      `${where} sets concurrency policy "${policy}", which is reserved but not ` +
        `implemented in v1. Use "allow" (default), "queue", or "reject". ` +
        `"${policy}" lands in a follow-up.`
    );
  }

  if (!V1_POLICIES.has(policy)) {
    throw new Error(
      `${where} has an unsupported concurrency policy ${JSON.stringify(policy)}. ` +
        `Use "allow" (default), "queue", or "reject".`
    );
  }

  if (typeof config !== "string" && config.key !== undefined) {
    const key = config.key;
    const keyOk =
      key === "session" || key === "user" || key === "none" || typeof key === "function";
    if (!keyOk) {
      throw new Error(
        `${where} has an unsupported concurrency key ${JSON.stringify(key)}. ` +
          `Use "session" (default), "user", "none", or a (ctx) => string function.`
      );
    }
  }
}
