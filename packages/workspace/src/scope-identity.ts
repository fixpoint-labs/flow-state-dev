/**
 * Which instance of a scope a run is in, and what to call it.
 *
 * Two things need this answer and would otherwise each derive it. A bash tool
 * names a workspace DIRECTORY and a sandbox registry entry after a scope; a
 * projection names a durable COLLECTION after one. Different questions, same
 * underlying rule — and a rule with two derivations is one that gets changed
 * in one of them. The tenant boundary in particular has already been wrong
 * once for exactly that reason.
 *
 * So the rule lives here, once, and each consumer frames the answer its own
 * way: a directory needs filesystem-safe segments, a key needs none.
 */

/**
 * Read the principal off a block's execution context.
 *
 * The one place that knows which context fields carry it. `session.identity.id`
 * and `request.identity.id` come off the request body; `userId`, `orgId` and
 * `tenantId` come from a verified principal, which is what makes them safe to
 * key a shared scope on (BP-031).
 */
export function principalFromContext(ctx: {
  session: { identity: { id: string; userId?: string; orgId?: string; tenantId?: string } };
  request: { identity: { id: string } };
}): ScopePrincipal {
  return {
    sessionId: ctx.session.identity.id,
    requestId: ctx.request.identity.id,
    userId: ctx.session.identity.userId,
    orgId: ctx.session.identity.orgId,
    tenantId: ctx.session.identity.tenantId,
  };
}

/** Who a run is, as far as scoping is concerned. */
export interface ScopePrincipal {
  /** This request. The narrowest scope there is. */
  requestId: string;
  sessionId: string;
  /** From a verified principal, not the request body. Absent when anonymous. */
  userId?: string;
  /** From a verified principal, not the request body. Absent when there is none. */
  orgId?: string;
  /** The framework's tenant boundary. Absent in a single-tenant app. */
  tenantId?: string;
}

/** A scope, spelled the way core spells it. */
export type ScopeName = "request" | "session" | "user" | "org";

/**
 * The components that name ONE instance of `scope`, in order.
 *
 * `request` and `session` are namespaced by tenant because their ids arrive on
 * the request body: two tenants naming the same session must not meet. `user`
 * and `org` are not, because they are keyed on an identity the framework
 * verified, and those scopes are shared across tenants by design — a tenant
 * segment would split the sharing they exist to provide.
 *
 * A `user` or `org` scope with no such identity falls back to the session,
 * tenant included. That is a narrowing, never a widening: it can only give a
 * run less reach than it asked for.
 */
export function scopeComponents(
  scope: ScopeName,
  principal: ScopePrincipal,
): (string | undefined)[] {
  const tenantScoped = (id: string): (string | undefined)[] => [principal.tenantId, id];
  switch (scope) {
    case "request":
      return tenantScoped(principal.requestId);
    case "user":
      return principal.userId !== undefined
        ? [principal.userId]
        : tenantScoped(principal.sessionId);
    case "org":
      return principal.orgId !== undefined
        ? [principal.orgId]
        : tenantScoped(principal.sessionId);
    case "session":
    default:
      return tenantScoped(principal.sessionId);
  }
}

/**
 * Join components into one string no other component list can spell.
 *
 * Length-framed, because a raw join on a delimiter is not injective: with a
 * `:` join, `(tenant "a:b", id "d")` and `(tenant "a", id "b:d")` are one
 * string. An absent component gets its own shape rather than a sentinel value,
 * because every sentinel is also a legal id — `-` is a tenant id the engine
 * accepts, so spelling "no tenant" as `-` puts it on the same key as the
 * tenant actually named `-`.
 */
export function frameComponents(parts: readonly (string | undefined)[]): string {
  return parts.map((c) => (c === undefined ? "-" : `${c.length}:${c}`)).join("");
}

/**
 * What a collection IS, durably — the value `Mount.collectionId` wants.
 *
 * Scope, the instance of that scope, and the pattern. Two runs addressing the
 * same rows get the same string; two that only spell their paths alike get
 * different ones.
 *
 * **Close to the engine's storage key, not equal to it.** The engine also
 * folds per-resource flow isolation into where a user- or org-scoped resource
 * lands, and that rule is the engine's — reproducing it here would be a second
 * copy of something this package does not own. So two flows that isolate the
 * same user's resources from each other share an id here while their rows are
 * separate, and one of them can be told `contested` over a row it does not
 * share. That direction is the safe one: a refusal is reported and retryable,
 * a missed claim is a silent overwrite. Making it exact needs the storage key
 * itself, which means a public accessor on the collection ref.
 */
export function collectionIdFor(
  collection: { scope: ScopeName; pattern: string },
  principal: ScopePrincipal,
): string {
  return frameComponents([
    collection.scope,
    ...scopeComponents(collection.scope, principal),
    collection.pattern,
  ]);
}

/**
 * The identity for a door that has no principal to scope by.
 *
 * `createBashTool` returns plain tools rather than blocks, so it never sees an
 * execution context — which is also why it refuses a `scope`. With no scope
 * instance to name, two tool sets built over the same pattern share an id and
 * therefore arbitrate.
 *
 * That over-arbitrates: two sets over unrelated collections with one pattern
 * refuse each other. It is the deliberate direction. The alternative — a
 * unique id per factory call — makes two sets holding refs to the SAME rows
 * invisible to each other, and a missed claim is a silent overwrite where a
 * false one is a reported refusal.
 */
export function unscopedCollectionId(collection: { scope: ScopeName; pattern: string }): string {
  return frameComponents([collection.scope, collection.pattern]);
}
