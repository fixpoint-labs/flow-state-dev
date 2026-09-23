/**
 * The hired roster — one org-scoped row per seat hired while the app was
 * running, at `workforce/roster/*`.
 *
 * This is the durable half of a runtime hire. A `WORKER.md` file declares a
 * seat and the boot reads it; a hire that happens after the boot has no file
 * to be written into, so it is written here instead, and the next boot reads
 * it back through the same door the hire went through.
 *
 * **Not the seat inventory, and deliberately beside it rather than inside it.**
 * `inventory/seats/*` answers *was registered in this org* and never deletes a
 * row — which is right for browsing and wrong for a roster, because firing a
 * seat has to remove it. Two contracts, two collections; they join on the seat
 * id and nothing else. A runtime-hired seat gets a roster row and no inventory
 * row, so nothing has to explain which of two answers is current.
 *
 * These keys are a public surface on the same terms the inventory's are:
 * moving the prefix breaks every deployment that has already hired.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import {
  HIRED_ROSTER_PRIVATE_PATTERN,
  markHiredRosterPrivateCollection,
} from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * One hired seat, as it is stored.
 *
 * **The envelope is closed; `settings` is passthrough**, and the two halves
 * answer to different owners. The envelope's keys are this package's to
 * version, so this version declares all of them and Zod's default strip drops
 * anything else — safe here, and only here, because nothing ever
 * read-modify-writes one of these rows: a hire `create`s it once and a fire
 * deletes it, so a key a newer version added is never carried through an older
 * version's rewrite and lost.
 *
 * `settings` is the opposite case and gets the opposite rule (BP-030). That
 * bag belongs to the flow kind's own `configSchema`, which is free to grow
 * keys this package has never heard of, so it is stored and handed back
 * untouched. Typing it as a closed shape — or letting a strip run over it —
 * would silently thin a seat's configuration on the first reload after a kind
 * gained a setting, and the seat would come back running on defaults with
 * nothing said.
 *
 * `seatId` and `flow` are required rather than defaulted, the same call the
 * seat inventory makes for the same reason: a row that lost either is not a
 * thinner row, it is a row that cannot be turned back into a seat, and a
 * default of `""` would look structurally fine and mint nothing.
 */
export const hiredSeatRowSchema = z.object({
  /**
   * The seat's id within its org — `"support.ada"`. Dotted, because a seat id
   * is already `"<teamId>.<name>"`; the org is NOT part of it. The address is
   * built by joining the two, which is why the ORG is the segment that has to
   * be dot-free (see `seatAddress`).
   */
  seatId: z.string().min(1),
  /** The flow kind this seat was hired into — what a `WORKER.md` spells `flow:`. */
  flow: z.string().min(1),
  /**
   * The settings bag handed to the kind, verbatim. Passthrough — see the
   * schema's own note above.
   */
  settings: z.record(z.unknown()).default({}),
  /**
   * The seat's instructions — what a file-declared seat carries in its
   * Markdown body. Nullable with a `null` default (BP-023), so a reader
   * `== null`-guards it rather than parsing `""`, and so a row written before
   * a seat had instructions still reads.
   */
  instructions: z.string().nullable().default(null),
  /**
   * The organization this hire belongs to. `null` — the default — is a row
   * written before the field existed (BP-023, BP-030). A reload then binds
   * the cell the row was stored in. A present value that disagrees with that
   * cell is refused rather than stripped or re-bound.
   */
  owningOrgId: z.string().nullable().default(null),
  /**
   * The user this hire belongs to. `null` means every member of the owning
   * org may see it. A user-owned hire sets the caller. Independent of
   * `owningOrgId`: matching one does not imply the other.
   */
  ownerUserId: z.string().nullable().default(null),
});

/** One stored roster row. @see hiredSeatRowSchema */
export type HiredSeatRow = z.infer<typeof hiredSeatRowSchema>;

/** The collection's storage prefix, without its wildcard. Pinned; see the file header. */
export const HIRED_ROSTER_PREFIX = "workforce/roster/";

/**
 * `flowIsolation: false`, spelled out rather than left to the flow-level flag,
 * for exactly the reason the inventory spells it out: left undefined, an app
 * that sets `isolateOrgState` for an unrelated reason would give the hiring
 * flow a private roster, and every other flow — including the boot reload —
 * would read empty with nothing at this layer saying why.
 */
const SHARED_ACROSS_FLOWS = false;

/**
 * The hired roster — one row per runtime-hired seat, at `workforce/roster/*`.
 *
 * Install it under the block that does the hiring. Org-scoped: every flow in
 * the org reads the same rows, and a flow under a different `orgId` reads
 * none, which is what makes two orgs able to hold a seat of the same name.
 *
 * Takes no options. The prefix, the scope and the sharing are the contract the
 * boot reload joins against, not app settings.
 *
 * **Write a row with `create()`, never `upsert()` or `getOrCreate()`.**
 * `create()` throws when the key already exists, and that throw *is* the
 * refusal of a second hire of the same seat — including two arriving at once,
 * with no lock and no check of your own. The seat inventory next door writes
 * with `upsert`, so the wrong one is a single copy-paste away and it loses the
 * refusal without any sign that it did.
 *
 * @example
 *   resources: { roster: defineHiredRosterCollection() }
 */
export function defineHiredRosterCollection() {
  return defineResourceCollection({
    pattern: `${HIRED_ROSTER_PREFIX}*`,
    scope: "org",
    flowIsolation: SHARED_ACROSS_FLOWS,
    stateSchema: hiredSeatRowSchema,
    // A browser may read these rows. Without it the collection-state route
    // refuses every read with `403 State read not permitted`, and a roster
    // panel has no way to name the org's seats — an action's return value has
    // no path to the browser, so `readBoard`-style workarounds do not exist.
    //
    // What this opens is exactly the ORG's rows and no other org's, because
    // the read resolves against the session's `orgId` and a session binds to
    // its principal's org (`handleCreateSession` ignores `body.orgId`
    // entirely). The axis is `scope`, not `flowIsolation`: an org-scoped
    // resource is shared within the org by definition, so opening it to that
    // org's own members reveals nothing they could not already be told. A
    // USER-scoped collection would not get this — see
    // `cross-org-collection-read.test.ts`, which fails if the boundary moves.
    //
    // `expose` rather than the identity default (BP-015), and `settings` is
    // the key it leaves out. That bag is passthrough by contract — the flow
    // kind's own `configSchema` owns it and is free to grow keys this package
    // has never heard of, which is exactly the shape that should not be
    // broadcast to every browser in the org. What a roster panel needs is who
    // the seat is, not how it was configured. The other three are the seat's
    // identity and are what "a user can see the workers in their org" means.
    client: {
      state: { read: true },
      expose: ["seatId", "flow", "instructions"],
    },
  });
}

/**
 * The server-side writer for a user-owned roster row.
 *
 * Same store, nested key `~user/seat`. The browser collection's single
 * segment does not match it, and this collection has no browser read. The
 * returned object is branded. Registration admits this pattern only from
 * that brand. A block that holds the ref still only reaches the session
 * user's own rows. A deep `workforce/roster/**`, or any other two-segment
 * pattern under the roster, is refused.
 */
export function defineHiredRosterPrivateCollection() {
  return markHiredRosterPrivateCollection(
    defineResourceCollection({
      pattern: HIRED_ROSTER_PRIVATE_PATTERN,
      scope: "org",
      flowIsolation: SHARED_ACROSS_FLOWS,
      stateSchema: hiredSeatRowSchema,
    }),
  );
}
