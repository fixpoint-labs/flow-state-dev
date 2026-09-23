/**
 * workforce-admin — hire a seat while the app is running, and fire one.
 *
 * The reference HTTP path for a durable hire, and **only** that: the seat-facing
 * hire a worker reaches through its own tools is FIX-1480's and composes this
 * roster rather than standing up a second one. Nothing here is the API a Lab
 * copies.
 *
 * **The shape of a hire, and why it is in this order.**
 *
 *   1  refuse anything this deploy can decide is wrong — no org, an org that is
 *      not a legal address segment, a kind this app does not carry, an address
 *      something already holds. Nothing has been written at this point.
 *   2  MINT the seat. `hireWorkforce` runs the kind's own settings schema, so a
 *      setting the kind refuses is refused here — still before any row exists,
 *      which is what BR-9's "no row, no registration" requires. Minting is not
 *      registering; nothing is reachable yet.
 *   3  WRITE the row, with `create()`. Its already-exists throw IS the refusal
 *      of a duplicate hire, including two arriving at once. Never `upsert()`.
 *   4  REGISTER. A hire that answers is a hire that was written down, so the
 *      row goes first.
 *   5  if registration fails, DELETE the row this call created, then report the
 *      registration failure. A hire that failed leaves nothing behind.
 *
 * **One seat per call.** There is no batch form, deliberately: a batch cannot
 * honour "a refused hire changes nothing" without atomic admission nobody here
 * needs.
 *
 * **What a fire does not do.** It removes the row and the address. It cancels
 * nothing — a run already going finishes and its items are persisted — and it
 * deletes no sessions, state or resources. Those are a separate, irreversible
 * operation. And it is durable immediately but process-wide only at the next
 * boot: a sibling process serving the seat keeps serving it until it restarts.
 * That window is the same one a hire has, and it is documented rather than
 * closed, because closing it needs cross-process invalidation — a subsystem,
 * not a line.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  hiredRosterStorageKey,
  hiredSeatManifest,
  hireWorkforce,
  seatAddress,
  toHiredSeatRow,
  type HiredSeatRow,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { workforceRegistrar } from "@/lib/workforce-registrar";
import { adminPrincipalResolver } from "@/lib/workforce-admin-auth";
import { kitchenSinkKinds } from "@/workforce/hire";

const roster = defineHiredRosterCollection();
/** User-owned rows. No browser read; the single-segment roster does not list them. */
const rosterPrivate = defineHiredRosterPrivateCollection();

/** The kinds a hire may name, and the sentence that lists them in a refusal. */
const KIND_NAMES = Object.keys(kitchenSinkKinds).sort();

const hireInput = z.object({
  /** The seat's id within the organization — `"support.ada"`. */
  seatId: z.string().min(1),
  /** The flow kind to hire it into. */
  flow: z.string().min(1),
  /** The settings bag handed to that kind. */
  settings: z.record(z.unknown()).default({}),
  /** The seat's instructions. */
  instructions: z.string().optional(),
});

const hireOutput = z.object({
  /** The address the seat now answers on. */
  address: z.string(),
  /** The organization it was hired into — from the credential, never the body. */
  orgId: z.string(),
});

const fireInput = z.object({ seatId: z.string().min(1) });

const fireOutput = z.object({
  address: z.string(),
  orgId: z.string(),
  /** Whether an address stopped answering in THIS process. */
  released: z.boolean(),
});

/**
 * The org the call runs under, from the verified principal.
 *
 * `ctx.org` exists because the resolver returned one. There is no unscoped
 * roster to fall back to, so a call without one is refused rather than written
 * somewhere no flow can read.
 */
function orgOf(ctx: { org?: { identity: { id: string; orgId?: string } } }): string {
  // `identity.orgId` first: `identity.id` is the storage key, which carries the
  // flow when an app isolates its org state, and a roster keyed by that would
  // be a different roster per flow.
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error(
      "This admin credential resolves no organization, and a roster is organization-scoped — " +
        "there is nothing to write to."
    );
  }
  return orgId;
}

/**
 * The roster collection, through `ctx.resources`' loose typing.
 *
 * Typed at the storage shape rather than at `HiredSeatRow`: the row's
 * `settings` is an open bag, which is deliberately wider than `JsonObject`'s
 * recursive value type. The schema on the collection is what validates a row;
 * this cast only names the accessor.
 */
function rosterOf(ctx: { resources: Record<string, unknown> }): ResourceCollectionRef {
  return ctx.resources.roster as unknown as ResourceCollectionRef;
}

function privateRosterOf(ctx: { resources: Record<string, unknown> }): ResourceCollectionRef {
  return ctx.resources.rosterPrivate as unknown as ResourceCollectionRef;
}

function userOf(ctx: { session: { identity: { userId?: string } } }): string {
  const userId = ctx.session.identity.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("This admin credential resolves no user, and a hire is user-owned.");
  }
  return userId;
}

/** A row on its way into storage. See {@link rosterOf} for why this is a cast. */
function asStored(row: HiredSeatRow): JsonObject {
  return row as unknown as JsonObject;
}

const hire = handler({
  name: "workforce-admin-hire",
  inputSchema: hireInput,
  outputSchema: hireOutput,
  execute: async (input, ctx) => {
    const orgId = orgOf(ctx);

    // Refuses a dotted, empty or over-long org before anything else looks at
    // it: without this, `acme` + `support.ada` and `acme.support` + `ada` spell
    // one address and the second hire silently rebinds the first.
    const userId = userOf(ctx);
    // User-owned seats carry the user in the address, so two members can hire
    // the same seat id without sharing one address. The pin is the row, below.
    const address = seatAddress(orgId, input.seatId, userId);

    if (!Object.hasOwn(kitchenSinkKinds, input.flow)) {
      throw new Error(
        `This app carries no flow kind "${input.flow}". It carries: ${KIND_NAMES.join(", ")}.`
      );
    }

    // Before the row is written, and naming what holds it. `register` would
    // also refuse a duplicate, but only after a row existed — which would make
    // every refused hire depend on the compensating delete working.
    const held = workforceRegistrar.kindAt(address);
    if (held !== undefined) {
      throw new Error(
        `"${address}" is already served by a flow of kind "${held}". Fire that seat first, or hire under another id.`
      );
    }

    const row = toHiredSeatRow({
      seatId: input.seatId,
      flow: input.flow,
      settings: input.settings,
      instructions: input.instructions ?? null,
      owningOrgId: orgId,
      ownerUserId: userId,
    });

    // Minted from exactly what will be stored, not from the request — so a
    // seat that hires is a seat the stored row can rebuild at the next boot.
    // This is also where the kind's own settings schema runs, which is why it
    // happens before anything is written. A row whose owning org disagrees
    // with this cell comes back as a reason and is not written.
    const record = hiredSeatManifest(orgId, row);
    if ("problem" in record) {
      throw new Error(record.problem);
    }
    const [seat] = hireWorkforce([record.manifest], { kinds: kitchenSinkKinds });
    if (seat === undefined) {
      throw new Error(`"${address}" could not be hired, and no reason was given.`);
    }

    // User-owned, so the key is nested. The browser roster is single-segment
    // and does not list it. `create`, never `upsert`: the already-exists throw
    // IS the duplicate refusal, and it survives a second hire arriving at the
    // same moment.
    const storageKey = hiredRosterStorageKey(row);
    const owner = storageKey.slice(0, storageKey.indexOf("/"));
    await privateRosterOf(ctx).create(
      { owner, seat: input.seatId },
      asStored(row)
    );

    try {
      // `registerFromRoster`, not `register`: this records that the address is
      // held by an instance THIS app minted from a roster row, which is what
      // `fire` checks before releasing it (BR-28).
      workforceRegistrar.registerFromRoster(seat, {
        pin: record.manifest.ownerPin,
      });
    } catch (error) {
      // The row this call created, removed — a hire that failed leaves nothing
      // behind. If the delete also fails, the stranded row is skipped and named
      // at the next boot rather than failing it, and the caller still hears
      // about the registration failure rather than about the cleanup.
      try {
        await privateRosterOf(ctx).delete({ owner: `~${userId}`, seat: input.seatId });
      } catch (cleanupError) {
        console.error(
          `[workforce-admin] "${address}" was written and could not be registered, and its row could ` +
            `not be removed either — the next boot will skip and name it: ${String(cleanupError)}`
        );
      }
      throw error;
    }

    ctx.emit.message(`Hired ${address} as ${input.flow}.`);
    return { address, orgId };
  },
});

const fire = handler({
  name: "workforce-admin-fire",
  inputSchema: fireInput,
  outputSchema: fireOutput,
  execute: async (input, ctx) => {
    const orgId = orgOf(ctx);
    const userId = userOf(ctx);
    const rows = rosterOf(ctx);
    const owned = privateRosterOf(ctx);

    // Org-scoped, so another organization's seat is not reachable by fire even
    // by exact id. A file-declared seat has no row here either, which is the
    // same refusal reached from the other side — its folder is where it is
    // removed. User-owned rows live on the private collection; a legacy
    // org-visible row is still the flat key.
    const ownedRow = await owned.getOptional({ owner: `~${userId}`, seat: input.seatId });
    const existing = ownedRow ?? (await rows.getOptional(input.seatId));
    // A user-owned row answers on `<org>.~<user>.<seat>`. A legacy flat row,
    // and a file-declared seat, stay on `<org>.<seat>`.
    const address = seatAddress(orgId, input.seatId, ownedRow !== undefined ? userId : null);
    if (existing === undefined) {
      const held = workforceRegistrar.kindAt(address);
      throw new Error(
        held === undefined
          ? `This organization hired no seat "${input.seatId}".`
          : `"${address}" was not hired through this action — a seat declared in \`workforce/teams/\` is ` +
            `removed by editing its folder, not by firing it.`
      );
    }

    const storedKind = String(existing.state.flow);
    if (ownedRow !== undefined) {
      await owned.delete({ owner: `~${userId}`, seat: input.seatId });
    } else {
      await rows.delete(input.seatId);
    }

    // Released ONLY when the address is held by the instance this row minted
    // (BR-28). **Two clauses, because neither subsumes the other**, and each
    // fails a case the other admits:
    //
    //   - PROVENANCE (`isFromRoster`) is what BR-28 is actually written in
    //     terms of. Kind equality alone is a weaker proxy: a seat declared in
    //     `workforce/teams/` at this address carrying the row's OWN kind
    //     passes it, and firing would unregister a file-declared seat —
    //     contradicting the refusal a few lines above, which promises such a
    //     seat is removed by editing its folder. Reachable: hire a seat, later
    //     add a folder declaring one at the same address with the same kind,
    //     restart. The file seat registers first, the reload's duplicate is
    //     skipped and named (BR-21), and the row survives.
    //   - KIND still matters because a mark can go STALE. Provenance records
    //     that this app registered the address; it cannot see the address
    //     being re-taken by a different instance afterwards. When the kinds
    //     disagree, whatever is there now is not what the mark refers to.
    //
    // `kindAt` gates both, and only when something is actually there: an
    // address nothing holds is the ordinary stranded-row cleanup (a sibling
    // process's registration, or a compensating delete that failed), which
    // falls through to `released: false` with nothing to report.
    const liveKind = workforceRegistrar.kindAt(address);
    const mintedHere = workforceRegistrar.isFromRoster(address);
    if (liveKind !== undefined && (!mintedHere || liveKind !== storedKind)) {
      console.error(
        `[workforce-admin] removed the roster row for "${address}" (kind "${storedKind}"), but the ` +
          `address is held by a flow of kind "${liveKind}" that ` +
          (mintedHere
            ? "no longer matches the stored kind"
            : "this app did not register from that row") +
          " — leaving it registered."
      );
      return { address, orgId, released: false };
    }

    const released = workforceRegistrar.unregister(address);
    ctx.emit.message(`Fired ${address}.`);
    return { address, orgId, released };
  },
});

/**
 * The admin flow. Its resolver is its own, and `fsdev.config.ts` registers this
 * flow **only** when a credential is configured — see `lib/workforce-admin-auth.ts`.
 */
const workforceAdminFlow = defineFlow({
  kind: "workforce-admin",
  requireUser: true,
  authentication: {
    resolvePrincipal: adminPrincipalResolver(),
    requireUser: true,
  },
  resources: { roster, rosterPrivate },
  actions: {
    hire: { inputSchema: hireInput, block: hire },
    fire: { inputSchema: fireInput, block: fire },
  },
});

const flow = workforceAdminFlow();

export default flow;
