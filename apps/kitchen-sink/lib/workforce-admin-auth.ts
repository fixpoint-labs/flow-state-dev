/**
 * The admin credential for `workforce-admin`, and the organization it names.
 *
 * **Why this flow carries a resolver of its own.** The framework's stock
 * resolver, `defaultBodyUserIdPrincipalResolver`, reads `userId` *and `orgId`*
 * straight out of the request body. That is fine for a demonstration flow whose
 * whole state is the caller's own. It is not fine for `hire` and `fire`, which
 * write durable state belonging to an organization: under the stock resolver
 * "the organization comes from the resolved principal" is true and means
 * nothing, because the caller supplied it. Any caller could hire into any
 * organization. This is BP-031, and closing it is a resolver rather than a
 * check inside the action — the action never sees an unverified org at all.
 *
 * **Fail-closed.** With no credential configured, `adminPrincipalResolver()`
 * returns `undefined` and `fsdev.config.ts` does not register the admin flow at
 * all. A default deployment therefore has no hire path to reach, rather than
 * one guarded by a check somebody could get wrong.
 *
 * Configure it as `WORKFORCE_ADMIN_TOKENS="<org>:<token>[,<org>:<token>…]"`.
 * Two organizations are supported because the story this app tells is that two
 * customers can each hold a seat called `support.ada`; one is the ordinary
 * case and costs the same code.
 */

import { timingSafeEqual } from "node:crypto";
import { extractBearerToken, PrincipalResolutionError } from "@flow-state-dev/engine";
import type { FlowInstance, ResolvePrincipalFn } from "@flow-state-dev/core/types";

/** The env var holding `<org>:<token>` pairs. */
export const ADMIN_TOKENS_ENV = "WORKFORCE_ADMIN_TOKENS";

/**
 * The user every admin action runs as.
 *
 * A fixed machine identity rather than something off the request: the admin
 * credential authenticates an operator, not an end user, and the runtime still
 * needs a `userId` to key its request records by. Nothing user-scoped is read
 * or written by either action.
 */
export const ADMIN_USER_ID = "workforce-admin";

/**
 * Parse `WORKFORCE_ADMIN_TOKENS` into token → org. Malformed entries are
 * skipped.
 *
 * **A token naming more than one organization drops ALL of its bindings**,
 * later one and earlier one alike. `Map#set` would keep the last write and
 * discard the first silently, which turns a copy-paste in an env var into a
 * cross-tenant authorization decision made by config order: with
 * `acme:secret,bravo:secret`, acme's own admin credential resolves the BRAVO
 * organization and hires into it. Dropping the later binding alone would still
 * leave acme's operator holding a credential bravo also knows.
 *
 * Failing closed here has a second effect worth knowing rather than
 * discovering: {@link adminCredentialConfigured} reads this map, so a config
 * whose ONLY token collides leaves the admin flow unregistered altogether —
 * no hire path at all, rather than one pointing at the wrong tenant.
 *
 * The same organization listed twice under one token is not a collision: it is
 * one binding written twice, and it resolves.
 */
function configuredTokens(): Map<string, string> {
  const raw = process.env[ADMIN_TOKENS_ENV];
  const byToken = new Map<string, string>();
  if (typeof raw !== "string" || raw.trim().length === 0) return byToken;

  const orgsByToken = new Map<string, Set<string>>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    // Split at the FIRST colon: an org id can never contain one (it is a
    // single address segment), and a token might.
    const at = trimmed.indexOf(":");
    if (at <= 0 || at === trimmed.length - 1) {
      console.error(
        `[workforce-admin] ignoring a malformed ${ADMIN_TOKENS_ENV} entry — expected "<org>:<token>"`
      );
      continue;
    }
    const token = trimmed.slice(at + 1);
    const orgs = orgsByToken.get(token);
    if (orgs === undefined) orgsByToken.set(token, new Set([trimmed.slice(0, at)]));
    else orgs.add(trimmed.slice(0, at));
  }

  for (const [token, orgs] of orgsByToken) {
    if (orgs.size > 1) {
      // The organizations, never the token — this line goes to a log.
      console.error(
        `[workforce-admin] one ${ADMIN_TOKENS_ENV} token is shared by ${orgs.size} organizations ` +
          `(${[...orgs].join(", ")}) — dropping every binding for it, because which organization it ` +
          `resolves would otherwise depend on the order they are written in. Give each organization ` +
          `its own token.`
      );
      continue;
    }
    byToken.set(token, [...orgs][0]!);
  }
  return byToken;
}

/** Whether any admin credential is configured. Decides whether the flow exists at all. */
export function adminCredentialConfigured(): boolean {
  return configuredTokens().size > 0;
}

/** Constant-time compare that does not leak length through an early return. */
function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The resolver for `workforce-admin`, or `undefined` when nothing is
 * configured — in which case the flow is not registered.
 *
 * The returned principal's `orgId` is the one the credential is bound to. The
 * request body is never consulted for it, which is the whole point: a hire
 * whose body says `orgId: "bravo"` under `acme`'s token writes to `acme`.
 *
 * Read once, at module scope, rather than per request: a credential that could
 * change between two requests of one process would make "which org am I" a
 * question with two answers in one boot.
 */
export function adminPrincipalResolver(): ResolvePrincipalFn | undefined {
  const byToken = configuredTokens();
  if (byToken.size === 0) return undefined;

  return (context) => {
    const header = context.request?.headers?.get("authorization") ?? null;
    const token = extractBearerToken(header);
    if (token === null) {
      throw new PrincipalResolutionError(
        "workforce-admin requires an admin credential: send `Authorization: Bearer <token>`.",
        { status: 401 }
      );
    }
    // Every candidate is compared, and the loop is not broken early, so the
    // time taken does not depend on which entry matched.
    let orgId: string | undefined;
    for (const [expected, org] of byToken) {
      if (matches(token, expected)) orgId = org;
    }
    if (orgId === undefined) {
      throw new PrincipalResolutionError("Invalid workforce-admin credential.", {
        status: 401,
      });
    }
    return { userId: ADMIN_USER_ID, orgId };
  };
}

/**
 * A seat hired from a roster row, resolving its callers with the admin
 * credential that hired it.
 *
 * A roster hire pins the seat to the organization and user the admin
 * credential resolved, and every request to the seat is checked against that
 * pin. So the seat has to resolve its callers the same way. With no resolver
 * of its own it falls to the framework default, which names the default
 * organization, and the pin refuses even the operator who just hired it.
 *
 * **On the seat instance, and nowhere wider.** A host-level resolver would put
 * every open flow in this app (`chat-agent`, the channels, the file-declared
 * seats) behind the admin token. A resolver on the kind would do the same to
 * the file-declared seats of that kind, which run unpinned for `devuser`. The
 * instance is the one place that covers exactly the pinned seats.
 *
 * The pin is untouched: this only decides who the caller IS, from the verified
 * token. Whether that caller may reach the seat is still the pin's call, so
 * another organization's credential is refused as before.
 *
 * Returned unchanged when no credential is configured — nothing can resolve
 * the pinned organization, so the pin refuses everyone — and when the seat's
 * kind names a resolver of its own, which is that kind's decision to make.
 */
export function withAdminAuthentication(
  seat: FlowInstance,
  resolvePrincipal: ResolvePrincipalFn | undefined
): FlowInstance {
  if (resolvePrincipal === undefined || seat.authentication?.resolvePrincipal !== undefined) {
    return seat;
  }
  return { ...seat, authentication: { ...seat.authentication, resolvePrincipal } };
}
