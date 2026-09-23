/**
 * Owner planes — the candidate shape FIX-1522 explored. Experimental, not a
 * supported API; see README.md for what it proves and how to run it.
 *
 * A **plane** is one roster owner inside one principal org: `(org, owner)`,
 * where `owner` is the org itself or one user of it. The org is the SECURITY
 * axis (principal → org, FIX-1442) and is always read from the session. The
 * owner is the ROSTER axis. The two never substitute for each other.
 *
 * **One hire store.** Both planes store the same `hiredSeatRowSchema` under the
 * same `workforce/roster/` prefix. The owner picks the *cell* the row lands in:
 *
 *   org plane   scope "org",  cell <orgId>,  key workforce/roster/<seatId>
 *   user plane  scope "user", cell <userId>, key workforce/roster/<orgId>/<seatId>
 *
 * The org plane is byte-identical to what FIX-1475 already writes, so nothing
 * persisted moves. The user plane puts the org in the key because a user cell
 * is keyed by the bare user id and would otherwise follow the person into every
 * org they belong to.
 *
 * Isolation comes from the engine, not from this file: a user-scoped read
 * resolves the SESSION's user cell and a session binds its user and org from the
 * verified principal. {@link assertOwnPlane} exists because the engine's answer
 * to "wrong plane" is a quiet miss, not a refusal (see the POC's leg C3).
 */

import { defineResource, defineResourceCollection } from "@flow-state-dev/core";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { hireWorkforce, type HireOptions } from "../src/hire";
import {
  defineHiredRosterCollection,
  HIRED_ROSTER_PREFIX,
  hiredSeatRowSchema,
  parseHiredSeatRow,
  seatAddress,
  toHiredSeatRow,
  type HiredRosterStores,
} from "../src/roster";
import { CHANNEL_BOARD_CLIENT_FIELDS } from "../src/channel/channel-board";
import type { FlowInstance } from "@flow-state-dev/core/types";

/** Who owns a roster. The org id of an org owner is the principal's org. */
export type WorkforceOwner = { type: "org"; id: string } | { type: "user"; id: string };

export type PlaneType = WorkforceOwner["type"];

/** The slice of a block's context a plane is read from: the session's own identity. */
export interface PlaneContext {
  session: { identity: { id: string; userId?: string; orgId?: string } };
}

/** The running session's org and user, as the engine bound them. Never from input. */
export function sessionPrincipal(ctx: PlaneContext): { orgId: string; userId: string } {
  const { orgId, userId } = ctx.session.identity;
  if (orgId === undefined || userId === undefined) {
    throw new Error(`session "${ctx.session.identity.id}" carries no org or user — refusing to pick a plane`);
  }
  return { orgId, userId };
}

/** The plane of the given type that the running session is entitled to. */
export function ownPlane(ctx: PlaneContext, type: PlaneType): WorkforceOwner {
  const { orgId, userId } = sessionPrincipal(ctx);
  return type === "org" ? { type, id: orgId } : { type, id: userId };
}

/**
 * Refuse, by name, a write aimed at a plane the running session does not own.
 *
 * Without it a user-plane declaration used from someone else's session does not
 * fail: it resolves the CALLER's own user cell and writes there. The work is
 * mis-filed rather than refused, which is the soft failure the POC measured.
 */
export function assertOwnPlane(ctx: PlaneContext, owner: WorkforceOwner): void {
  const mine = ownPlane(ctx, owner.type);
  if (mine.id !== owner.id) {
    const { orgId, userId } = sessionPrincipal(ctx);
    throw new Error(
      `plane ${owner.type}:${owner.id} is not this session's — it runs as user "${userId}" in org ` +
        `"${orgId}". Cross-plane work needs an explicit door; a board write is not one.`
    );
  }
}

/**
 * The flow-instance id a seat on this plane registers under.
 *
 *   org   acme.eng.lead          (unchanged from `seatAddress`)
 *   user  acme.~alice.eng.lead
 *
 * `~` is outside the segment alphabet, so no folder-declared team id can start
 * with it. A runtime-hired row's seat id is not segment-validated, so the
 * leading `~` is refused here too — otherwise the two shapes could collide.
 */
export function planeAddress(orgId: string, owner: WorkforceOwner, seatId: string): string {
  if (seatId.startsWith("~")) {
    // A roster row's seat id is only `min(1)`, so without this an org row
    // named `~alice.eng.lead` would register at alice's address.
    throw new Error(`seat id "${seatId}" starts with "~", which marks a user plane's address`);
  }
  if (owner.type === "org") return seatAddress(orgId, seatId);
  return seatAddress(orgId, `~${encodeUserSegment(owner.id)}.${seatId}`);
}

/**
 * A principal's user id as one address segment. User ids are opaque
 * (`alice@example.com`, `auth0|123`) and may carry dots, so they are escaped
 * rather than held to the folder-name rule: every character outside
 * `[a-z0-9-]` becomes `%XX` per UTF-8 byte. `%` is itself escaped, so the
 * encoding is injective, and no `.` survives, so the address still splits.
 */
export function encodeUserSegment(userId: string): string {
  if (userId.length === 0) throw new Error("a user id must not be empty — it is part of a seat's address");
  let out = "";
  for (const char of userId) {
    if (/[a-z0-9-]/.test(char)) {
      out += char;
      continue;
    }
    for (const byte of new TextEncoder().encode(char)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * The roster row's key within the plane's cell.
 *
 * Explore-only: the org in a user row's key works around a user cell being
 * one per person rather than per org (C7), and the browser read still spans
 * orgs. The shippable shape is a (user × org) cell in the engine.
 */
export function planeRowKey(orgId: string, owner: WorkforceOwner, seatId: string): string {
  return owner.type === "org" ? seatId : `${orgId}/${seatId}`;
}

/** The prefix one plane's rows sit under, relative to the collection. */
export function planeRowPrefix(orgId: string, owner: WorkforceOwner): string {
  return owner.type === "org" ? "" : `${orgId}/`;
}

/**
 * The hired roster for one plane type. The org plane IS FIX-1475's collection;
 * the user plane is the same schema, prefix and exposure at user scope.
 */
export function planeRosterCollection(type: PlaneType) {
  if (type === "org") return defineHiredRosterCollection();
  return defineResourceCollection({
    pattern: `${HIRED_ROSTER_PREFIX}**`,
    scope: "user",
    flowIsolation: false,
    stateSchema: hiredSeatRowSchema,
    client: { state: { read: true }, expose: ["seatId", "flow", "instructions"] },
  });
}

/** One entry of a seed pack: a seat to hire the first time a plane opens. */
export interface SeedTemplate {
  seatId: string;
  flow: string;
  settings?: Record<string, unknown>;
  instructions?: string | null;
}

/** A named, versioned set of seats a plane starts from. */
export interface SeedPack {
  id: string;
  version: number;
  seats: readonly SeedTemplate[];
}

/**
 * The record that a plane has been seeded. One per plane, beside the roster.
 *
 * It is what makes seed-then-evolve hold: the roster alone cannot tell "never
 * seeded" from "seeded, then every seat was fired", so any seed keyed on the
 * roster's contents resurrects a fired seat on the next boot.
 */
export const seedLedgerSchema = z.object({
  packs: z.record(z.object({ version: z.number(), seededAt: z.string() })).default({}),
});

export function planeSeedLedger(type: PlaneType) {
  return defineResource({
    ref: "workforce-seeded",
    scope: type,
    flowIsolation: false,
    stateSchema: seedLedgerSchema,
  });
}

/**
 * How to apply a seed pack. `create-if-absent` is the tempting one and is
 * wrong: it keys "already seeded" on the roster, so a fired seat comes back.
 */
export type SeedStrategy = "create-if-absent" | "ledgered";

/** Minimal slices of the refs the seed step writes through. */
interface RosterRef {
  getOptional(key: string): Promise<unknown>;
  create(key: string, state: unknown): Promise<unknown>;
}
interface LedgerRef {
  state: z.infer<typeof seedLedgerSchema>;
  patchState(patch: Partial<z.infer<typeof seedLedgerSchema>>): Promise<unknown> | unknown;
}

/**
 * The ledger key for one pack on one plane. A user's ledger is one record per
 * person (user scope), so it carries the org the same way the roster key does —
 * otherwise seeding at one org would mark the pack seeded in all of them.
 */
export function seedMarker(orgId: string, owner: WorkforceOwner, packId: string): string {
  return owner.type === "org" ? packId : `${orgId}/${packId}`;
}

/**
 * Apply `pack` to one plane's roster. Returns the seat ids it wrote.
 *
 * `ledgered` writes each seat with `create` (so a hire already there is never
 * overwritten) and only on the plane's FIRST seeding of this pack id. A bumped
 * version is recorded, keeping the first `seededAt`, but hires nothing on its
 * own: what a new version should do to a plane that has evolved is a product
 * call, not a mechanism.
 */
export async function seedPlane(
  roster: RosterRef,
  ledger: LedgerRef,
  orgId: string,
  owner: WorkforceOwner,
  pack: SeedPack,
  strategy: SeedStrategy
): Promise<string[]> {
  const marker = seedMarker(orgId, owner, pack.id);
  const recorded = ledger.state.packs[marker];
  if (strategy === "ledgered" && recorded !== undefined) {
    if (recorded.version !== pack.version) {
      await ledger.patchState({
        packs: { ...ledger.state.packs, [marker]: { version: pack.version, seededAt: recorded.seededAt } },
      });
    }
    return [];
  }

  const written: string[] = [];
  for (const seat of pack.seats) {
    const key = planeRowKey(orgId, owner, seat.seatId);
    if ((await roster.getOptional(key)) !== undefined) continue;
    await roster.create(key, toHiredSeatRow(seat));
    written.push(seat.seatId);
  }

  if (strategy === "ledgered") {
    await ledger.patchState({
      packs: { ...ledger.state.packs, [marker]: { version: pack.version, seededAt: new Date().toISOString() } },
    });
  }
  return written;
}

/**
 * A board on a plane: the same task collection shape a channel board is, at the
 * plane's scope. A user-plane board's rows live in the user's cell.
 */
export function planeBoard(type: PlaneType, id: string) {
  return Object.assign(defineTaskCollection({ id, scope: type }), {
    id,
    client: { state: { read: true }, expose: CHANNEL_BOARD_CLIENT_FIELDS },
  });
}

/**
 * Read one plane's roster at boot and hire what it names — `reloadHiredSeats`
 * with the cell as a parameter instead of a hard-coded `("org", orgId)`.
 */
export async function reloadPlane(
  stores: HiredRosterStores,
  orgId: string,
  owner: WorkforceOwner,
  kinds: HireOptions["kinds"]
): Promise<{ seats: FlowInstance[]; problems: string[] }> {
  const prefix = HIRED_ROSTER_PREFIX + planeRowPrefix(orgId, owner);
  const rows = await stores.resourceState.getByPrefix(owner.type, owner.id, prefix);
  const seats: FlowInstance[] = [];
  const problems: string[] = [];
  for (const key of Object.keys(rows).sort()) {
    const parsed = parseHiredSeatRow(rows[key]!.state);
    if ("problem" in parsed) {
      problems.push(`${owner.type}:${owner.id} row "${key}" — ${parsed.problem}`);
      continue;
    }
    const { row } = parsed;
    try {
      seats.push(
        ...hireWorkforce(
          [
            {
              id: planeAddress(orgId, owner, row.seatId),
              declared: { ...row.settings, flow: row.flow },
              body: row.instructions ?? "",
            },
          ],
          { kinds }
        )
      );
    } catch (error) {
      problems.push(`${owner.type}:${owner.id} row "${key}" — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { seats, problems };
}
