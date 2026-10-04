/**
 * Whose coding run a row is, on a board kept per organization.
 *
 * The manager keeps everything about a run per person: the checkout folder
 * and the branch carry the principal, and the run record and the run's
 * questions are user-scoped. On a user-scoped board that is the whole story,
 * because nobody else can see the row. On an **organization-scoped** board —
 * a mailbox's board, say — a second member can drain the same row, and before
 * this rule their retry started over in a new checkout on a new branch without
 * the first attempt's record or agent session: one row, two runs.
 *
 * So the run belongs to the member who started it. The manager records that
 * member on the row the first time it runs it, from the request's resolved
 * identity (BP-031), and two doors enforce it:
 *
 * - {@link runOwnerDispatcher} narrows the board's claim,
 *   so another member's drain never claims the row. That is the door that
 *   charges nothing: the claim is what spends an attempt, and it never happens.
 *   The host wires it on the board that drains.
 * - the manager itself refuses a row another member owns before it derives
 *   anything, for a board whose drain was not wired with the dispatcher. That
 *   refusal comes after the claim, so it does cost the attempt; it exists so a
 *   run is never forked.
 *
 * **The record lives in the row's `metadata`**, the one place on a row the
 * manager can write. Metadata is writable by anyone who can write the board,
 * so this is a coordination record rather than an access boundary: rewriting
 * it can make a run fork, which is the harm it prevents, but it cannot hand
 * one member another's checkout, record or session, since those are derived
 * from each request's own resolved identity and never from the row.
 */
import type { TaskDispatcher } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import type { RunPrincipal } from "./workspace";

/**
 * The metadata key the owner is recorded under. **Pinned**: a status surface
 * reads it, and rows written before a rename would stop being recognised.
 */
export const HARNESS_RUN_OWNER_KEY = "harnessRunOwner";

const runOwnerSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
});

/** Who a run belongs to, as recorded on its row. */
export type RunOwner = z.infer<typeof runOwnerSchema>;

/**
 * The owner recorded on a row, or `null` when none is.
 *
 * `null` for a row the manager has never run, for any row written before the
 * rule existed (BP-030), and for a record that does not parse. The last one is
 * deliberate: the next run records its own principal, which is the same thing
 * that happens to a row nobody has run.
 */
export function runOwnerOf(row: { metadata?: Record<string, unknown> } | undefined): RunOwner | null {
  const parsed = runOwnerSchema.safeParse(row?.metadata?.[HARNESS_RUN_OWNER_KEY]);
  return parsed.success ? parsed.data : null;
}

/** The record for a principal, with no `tenantId` key when there is none. */
export function runOwnerFor(principal: RunPrincipal): RunOwner {
  return {
    userId: principal.userId,
    ...(principal.tenantId !== undefined ? { tenantId: principal.tenantId } : {}),
  };
}

/** Is this principal the one the row's run belongs to? Tenant absence is compared as a fact. */
export function isRunOwner(owner: RunOwner, principal: RunPrincipal): boolean {
  return owner.userId === principal.userId && owner.tenantId === principal.tenantId;
}

/** The refusal another member's drain meets, naming whose run it is. */
export function foreignRunMessage(taskId: string, owner: RunOwner): string {
  const tenant = owner.tenantId === undefined ? "" : ` (tenant "${owner.tenantId}")`;
  return (
    `[harness-manager] task ${taskId} is "${owner.userId}"${tenant}'s coding run: they started ` +
    `it, and its checkout, branch, run record and agent session are theirs. Only their drain ` +
    `continues it; this drain leaves the row as it is.`
  );
}

/**
 * What the principal is read from — the request's authenticated identity, and
 * nothing else.
 *
 * Typed by what it READS rather than as a whole `BlockContext`, so any caller
 * can pass its own narrower context without a cast. The casts were not free:
 * `as BlockContext` on a handler whose resources are typed fails to compile,
 * and the escape hatch that fixes it (`as unknown as`) would silently accept a
 * context that has no identity at all — on the one derivation where a missing
 * identity means two principals sharing a checkout.
 */
export interface RequestIdentityContext {
  user?: { identity?: unknown } | undefined;
}

/**
 * Who this run belongs to, from the request's RESOLVED identity.
 *
 * `ctx.user.identity` is what the principal resolver produced, not anything a
 * caller put in a body — which is what makes it usable as an isolation boundary
 * (BP-031). A missing user id is refused rather than defaulted: a default would
 * put every unauthenticated run in one shared checkout, which is the exact
 * collision the principal is here to prevent.
 */
export function runPrincipal(ctx: RequestIdentityContext): RunPrincipal {
  const identity = ctx.user?.identity as
    | { id?: unknown; tenantId?: unknown }
    | undefined;
  const userId = identity?.id;
  if (typeof userId !== "string" || userId === "") {
    throw new Error(
      "[harness-manager] this request has no resolved user identity, so a run cannot be " +
        "isolated to one. Refusing rather than sharing a checkout across principals.",
    );
  }
  return {
    userId,
    ...(typeof identity?.tenantId === "string" && identity.tenantId !== ""
      ? { tenantId: identity.tenantId }
      : {}),
  };
}

/**
 * A board dispatcher that never claims a row whose coding run another member
 * started — the half of the run-owner rule that charges nothing.
 *
 * Wire it on the board that drains rows a manager runs, when that board is
 * kept per organization (a mailbox's board): `taskBoard({ dispatcher:
 * runOwnerDispatcher() })`. The claim is what spends an attempt, so refusing
 * here leaves the row exactly as it was: same status, same attempt count,
 * same lease. Readiness and order stay the collection's: the owner check is
 * an `eligibility` narrow, which the substrate applies on top of its own.
 *
 * A row with no recorded owner is claimable by anyone; the manager records
 * the claimant on its first run. When a claim comes back empty only because
 * every claimable row was someone else's, the drain is refused with an error
 * naming whose run it is, rather than returning as if the board were idle.
 *
 * @returns A dispatcher to pass as `taskBoard({ dispatcher })`.
 */
export function runOwnerDispatcher(): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const principal = runPrincipal(ctx);
      let refused: { taskId: string; owner: RunOwner } | undefined;
      const claimed = await collection.claim(workerId, {
        eligibility: (task) => {
          const owner = runOwnerOf(task);
          if (owner === null || isRunOwner(owner, principal)) return true;
          if (refused === undefined) refused = { taskId: task.id, owner };
          return false;
        },
      });
      if (claimed === null && refused !== undefined) {
        throw new Error(foreignRunMessage(refused.taskId, refused.owner));
      }
      return claimed;
    },
  };
}
