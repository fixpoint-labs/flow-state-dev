/**
 * Who every caller of this app is: one organization and one user, both named
 * here and read from nothing the caller sends.
 *
 * Kitchen-sink authenticates nobody. Without a resolver of its own it would run
 * as the framework's development organization, whose id is not a legal seat
 * address, so every hire in the app would be refused. So the app names one
 * real organization instead, and `fsdev.config.ts` hands
 * {@link resolveKitchenSinkPrincipal} to `createFlowState` as the host-level
 * fallback. Every flow that declares no resolver of its own resolves through
 * it: the assistant's flow, every seat and every channel. That is what makes a
 * hire and the read that follows it land in the same organization.
 *
 * Two flows keep a resolver of their own. `workforce-admin` authenticates an
 * operator by bearer token, and every token must name
 * {@link KITCHEN_SINK_ORG_ID} (`lib/workforce-admin-auth.ts`). `weekly-digest`
 * runs its scheduled path on its own test org; it neither hires nor reads the
 * roster.
 *
 * **Both values are constants, and that is the point (BP-031).** Nothing on a
 * request — body, query, header, cookie — can name another organization or
 * another user. The user is a constant too because the management routes
 * (session reads, resource reads) resolve the principal with no body at all, so
 * a user read from the body would own a session its own reads then refuse.
 *
 * What it costs, stated for anyone copying this: anyone who can open a deployed
 * copy of this app is `devuser` in `kitchen-sink`, and can hire and fire its
 * seats. This is a stand-in for sign-in, not a form of it.
 */
import type { ResolvePrincipalFn } from "@flow-state-dev/core/types";

/** The one organization this app runs as. The only one `WORKFORCE_ADMIN_TOKENS` may name. */
export const KITCHEN_SINK_ORG_ID = "kitchen-sink";

/** The one user every caller of this app is, including the boot that opens the channels. */
export const KITCHEN_SINK_USER_ID = "devuser";

/**
 * The host-level principal resolver. Takes no argument on purpose: there is
 * nothing on the request it is allowed to read.
 */
export const resolveKitchenSinkPrincipal: ResolvePrincipalFn = () => ({
  userId: KITCHEN_SINK_USER_ID,
  orgId: KITCHEN_SINK_ORG_ID,
});
