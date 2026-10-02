/**
 * `createSeatHireBlocks` — `hire`, `fire`, `brokenSeats` and `rehire` as
 * blocks, with no model in front of them and no approval of their own.
 *
 * `createSeatHireCapability` mounts `hire` and `fire` as its catalog tools. An
 * action mounts any of the four directly; a flow that lets a model reach the
 * repairs puts them behind an approval.
 *
 * Registration failure deletes the roster row written for that hire. The
 * inventory write sits after that compensation. `fire` removes the roster row,
 * then the address, then the seat's inventory row, through `removeHiredSeat`,
 * the one removal every hired seat goes through.
 *
 * `brokenSeats` reads through the boot reload's own per-row check, so it names
 * exactly the stored seats the start skips. `rehire` keeps a seat that no
 * longer starts at its address, on a kind the caller names; it never picks one.
 *
 * User-owned seats: when the mounting flow has the user-owned roster under
 * `HIRED_ROSTER_PRIVATE_RESOURCE`, `fire` and `rehire` find the caller's own
 * user-owned row first and the org's row second (as kitchen-sink's admin fire
 * does), and `brokenSeats` lists the caller's own user-owned rows beside the
 * org's. That collection serves a row only to the member it belongs to, so
 * another member's user-owned seats are theirs to list and repair.
 */

import { handler } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core";
import { deepEqual } from "@flow-state-dev/core/helpers";
import type {
  BlockDefinition,
  FlowInstance,
  InstanceOwnerPin,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  HIRED_ROSTER_PRIVATE_RESOURCE,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE
} from "./seat-hire-keys";
import { seatDoorOf } from "./seat-door";
import { hireWorkforce, unattendedBoardWarnings, type HireOptions } from "./hire";
import { checkHiredSeatRow } from "./roster/check";
import { HIRED_ROSTER_PREFIX, type HiredSeatRow } from "./roster/collections";
import { hiredSeatOwnerPinFromRosterOwner, registerHiredSeat } from "./roster/register-hired-seat";
import { removeHiredSeat } from "./roster/remove";
import { encodeUserSegment, hiredSeatManifest, seatAddress, toHiredSeatRow } from "./roster/rows";

/** The registry keys live in a leaf module; re-exported here by name. */
export { HIRED_ROSTER_PRIVATE_RESOURCE, HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE };

/**
 * The owner pin a hired-seat register must carry: another name for core's
 * `InstanceOwnerPin`, `{ orgId, userId? }`.
 *
 * Derived from the hire row's roster owner, never from the address. `orgId`
 * is the owning org. `userId` is present only when that row is user-owned.
 */
export type HiredSeatOwnerPin = InstanceOwnerPin;

/** The one owner-pin gate lives with the roster; re-exported here by name. */
export { hiredSeatOwnerPinFromRosterOwner, registerHiredSeat };

export interface SeatHireCapabilityOptions {
  /**
   * The flows a hire may name — the same map `hireWorkforce` takes.
   *
   * Closed over, not copied: a kind registered on this object after the
   * factory runs is hireable. The built-in `agent` kind sits underneath, as
   * it does for host hire.
   */
  kinds?: HireOptions["kinds"];
  /**
   * Admit a minted seat at its address, with the owner pin from the hire
   * row's roster owner. Hire refuses rather than call this without a pin.
   * A hire that answers is a hire that was written down, so the roster row
   * is created first; if this throws the row is deleted.
   */
  register: (seat: FlowInstance, pin: HiredSeatOwnerPin) => void;
  /**
   * Release an address in this process. Fire deletes the roster row first;
   * this is what makes the address stop resolving here.
   */
  unregister: (id: string) => boolean;
  /**
   * The kind serving an address right now, if any. Used to refuse a second
   * hire of a live seat before a row is written, the same pre-check host
   * admin makes. Omitted, `create()` on the roster is still the duplicate
   * refusal.
   */
  kindAt?: (id: string) => string | undefined;
  /**
   * Kinds this tool may mint, as a subset of {@link SeatHireCapabilityOptions.kinds}.
   * Omitted, every kind on the map (plus the built-in `agent`) is hireable.
   */
  allowKinds?: readonly string[];
  /**
   * Channel-board ledger ids, forwarded to `hireWorkforce` so an unattended
   * board still warns. Hire does not attach boards; the warning is the
   * honesty.
   */
  channelBoards?: readonly string[];
}

const hireInput = z
  .object({
    seatId: z.string().min(1),
    flow: z.string().min(1),
    settings: z.record(z.unknown()).default({}),
    instructions: z.string().optional(),
    /**
     * Accepted so a body that names an org is not an extra-key refusal, and
     * ignored so a body that names another org changes nothing about which
     * roster is written (BP-031).
     */
    orgId: z.unknown().optional(),
  })
  .strict();

const hireOutput = z.object({
  seatId: z.string(),
  address: z.string(),
  warning: z.string().optional(),
});

const fireInput = z
  .object({
    seatId: z.string().min(1),
    orgId: z.unknown().optional(),
  })
  .strict();

const fireOutput = z.object({
  seatId: z.string(),
  /** Where the seat answered. `null` for a row that did not read, which has no address to trust. */
  address: z.string().nullable(),
  released: z.boolean(),
  /**
   * Present when the roster row was already gone and only the seat's leftover
   * inventory row was removed: a second call after a crash between the two
   * deletes. Only a row marked `hired: true` is removed this way.
   */
  alreadyGone: z.literal(true).optional(),
});

/** Ignores an org in the body, as every block here does (BP-031). */
const brokenSeatsInput = z.object({ orgId: z.unknown().optional() }).strict();

const brokenSeatOutput = z.object({
  /**
   * The id `fire` and `rehire` take. For an `unreadable` row, the row's key
   * in the roster, which is what `fire` retires it by.
   */
  seatId: z.string(),
  /** The row's full storage key, as the boot report names it. */
  key: z.string(),
  /** The kind the row stored, or `null` when the row did not read. */
  kind: z.string().nullable(),
  reason: z.enum(["kind-gone", "refused", "unreadable"]),
  /** The start's own sentence for why the row is skipped. */
  detail: z.string(),
});

const brokenSeatsOutput = z.array(brokenSeatOutput);

const rehireInput = z
  .object({
    seatId: z.string().min(1),
    flow: z.string().min(1),
    /** Settings for the new kind. The old kind's are not carried over. */
    settings: z.record(z.unknown()).default({}),
    /** Replaces the stored instructions. Omitted, the stored ones carry over. */
    instructions: z.string().optional(),
    orgId: z.unknown().optional(),
  })
  .strict();

/**
 * The org the call runs under, from the verified principal.
 *
 * `identity.orgId` first: `identity.id` is the storage key, which carries the
 * flow when an app isolates its org state, and a roster keyed by that would
 * be a different roster per flow.
 */
function orgOf(ctx: BlockContext): string {
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error(
      "This request resolves no organization, and a roster is organization-scoped — " +
        "there is nothing to write to."
    );
  }
  return orgId;
}

function collectionOf(ctx: BlockContext, key: string): ResourceCollectionRef {
  return ctx.resources[key] as unknown as ResourceCollectionRef;
}

/** The user-owned roster, when the mounting flow has it. */
function privateRosterOf(ctx: BlockContext): ResourceCollectionRef | undefined {
  return ctx.resources[HIRED_ROSTER_PRIVATE_RESOURCE] as unknown as ResourceCollectionRef | undefined;
}

/** Where one seat's roster row is, and whose it is. */
interface LocatedSeatRow {
  roster: ResourceCollectionRef;
  key: string | Record<string, string>;
  /** The member a user-owned row belongs to; `null` for an org-visible row. */
  ownerUserId: string | null;
}

/**
 * Find a seat's roster row: the caller's own user-owned row when the flow
 * mounts that roster and it has one, otherwise the org's row (present or not).
 *
 * With `leftoverAt` (fire): when neither roster row is there, a hired
 * inventory row the caller's own fire left at the caller's user-owned address
 * (a crash after its roster row went) keeps the seat the caller's, so the
 * retry removes that row rather than looking at the org address.
 */
async function locateSeatRow(
  ctx: BlockContext,
  seatId: string,
  leftoverAt?: { orgId: string; inventory: ResourceCollectionRef }
): Promise<LocatedSeatRow> {
  const owned = privateRosterOf(ctx);
  const userId = ctx.session.identity.userId;
  const org: LocatedSeatRow = { roster: collectionOf(ctx, HIRED_ROSTER_RESOURCE), key: seatId, ownerUserId: null };
  if (owned === undefined || typeof userId !== "string" || userId.length === 0) return org;
  const own: LocatedSeatRow = {
    roster: owned,
    key: { owner: `~${encodeUserSegment(userId)}`, seat: seatId },
    ownerUserId: userId,
  };
  if ((await owned.getOptional(own.key)) !== undefined) return own;
  if (leftoverAt === undefined || (await org.roster.getOptional(org.key)) !== undefined) return org;
  const leftover = await leftoverAt.inventory.getOptional(seatAddress(leftoverAt.orgId, seatId, userId));
  return leftover?.state.hired === true ? own : org;
}

function asStored(row: HiredSeatRow): JsonObject {
  return row as unknown as JsonObject;
}

function listed(names: readonly string[]): string {
  return names.length > 0 ? names.join(", ") : "(none)";
}

/**
 * The seat-hire handlers, model-free. `createSeatHireCapability` mounts `hire`
 * and `fire` as catalog tools; `brokenSeats` and `rehire` are mounted by the
 * caller, behind its own approval.
 */
export interface SeatHireBlocks {
  readonly hire: BlockDefinition<typeof hireInput, typeof hireOutput>;
  /** Remove a hired seat: a working one, or one that no longer starts (retire). */
  readonly fire: BlockDefinition<typeof fireInput, typeof fireOutput>;
  /** The organization's stored seats the start would skip, each with its reason. Writes nothing. */
  readonly brokenSeats: BlockDefinition<typeof brokenSeatsInput, typeof brokenSeatsOutput>;
  /** Keep a seat that no longer starts at its address, on a kind the caller names. */
  readonly rehire: BlockDefinition<typeof rehireInput, typeof hireOutput>;
}

/**
 * Build `{ hire, fire, brokenSeats, rehire }`.
 *
 * @param options Kinds, register/unregister, and the optional allowlist.
 *   Org comes from the principal at the call, not from options.
 */
export function createSeatHireBlocks(options: SeatHireCapabilityOptions): SeatHireBlocks {
  const kinds = options.kinds ?? {};
  const allow = options.allowKinds === undefined ? undefined : new Set(options.allowKinds);

  const hireableKindNames = (): string[] => {
    const names = new Set<string>(["agent", ...Object.keys(kinds)]);
    if (allow !== undefined) {
      return [...names].filter((name) => allow.has(name)).sort();
    }
    return [...names].sort();
  };

  /** Refuse a kind this tool may not mint, or this app does not carry. Writes nothing. */
  const refuseUnhireableKind = (flow: string, verb: string): void => {
    const available = hireableKindNames();
    if (allow !== undefined && !allow.has(flow)) {
      throw new Error(`This seat may not ${verb} kind "${flow}". It may hire: ${listed(available)}.`);
    }
    if (!Object.hasOwn(kinds, flow) && flow !== "agent") {
      throw new Error(`This app carries no flow kind "${flow}". It carries: ${listed(available)}.`);
    }
  };

  /** Mint the seat a row describes, running the kind's settings schema. Writes nothing. */
  const mint = (orgId: string, row: HiredSeatRow, address: string): FlowInstance => {
    const record = hiredSeatManifest(orgId, row);
    // Type narrowing, not a second fence: the row was just stamped with this org.
    if ("problem" in record) {
      throw new Error(`"${address}" could not be hired: ${record.problem}.`);
    }
    const [seat] = hireWorkforce([record.manifest], {
      kinds,
      channelBoards: options.channelBoards,
    });
    if (seat === undefined) {
      throw new Error(`"${address}" could not be hired, and no reason was given.`);
    }
    return seat;
  };

  /** Publish the seat's inventory row, and say what a person should know. */
  const publish = async (ctx: BlockContext, seat: FlowInstance, flow: string, address: string) => {
    const door = seatDoorOf(seat);
    const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
    await inventory.upsert(address, { id: address, kind: flow, door: door.door, hired: true });
    const warnings = [
      ...unattendedBoardWarnings(options.channelBoards ?? [], [seat]),
      ...(door.problem === undefined ? [] : [door.problem]),
    ];
    return warnings.length > 0 ? { warning: warnings.join("\n") } : {};
  };

  const hire = handler({
    name: "hire",
    description:
      "Mint a seat of a kind this app already registered. Names the kind and a " +
      "seat id. Does not invent a kind, and does not attach boards.",
    inputSchema: hireInput,
    outputSchema: hireOutput,
    execute: async (input, ctx) => {
      const orgId = orgOf(ctx);
      const address = seatAddress(orgId, input.seatId);
      refuseUnhireableKind(input.flow, "hire");

      const held = options.kindAt?.(address);
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
      });
      const seat = mint(orgId, row, address);

      const roster = collectionOf(ctx, HIRED_ROSTER_RESOURCE);
      await roster.create(input.seatId, asStored(row));

      try {
        // Pin from the roster owner of the row just written — the org cell
        // of this hire — not from `seat.id`. Address is a name the caller
        // can type; it is not evidence of ownership (FIX-1529 / F2-PLAN).
        registerHiredSeat(options.register, seat, { orgId });
      } catch (error) {
        try {
          await roster.delete(input.seatId);
        } catch (cleanupError) {
          console.error(
            `[seat-hire] "${address}" was written and could not be registered, and its row could ` +
              `not be removed either — the next boot will skip and name it: ${String(cleanupError)}`
          );
        }
        throw error;
      }

      return { seatId: input.seatId, address, ...(await publish(ctx, seat, input.flow, address)) };
    },
  });

  const fire = handler({
    name: "fire",
    description:
      "Remove a runtime-hired seat: its roster row, its address in this process, and its " +
      "inventory row. Also retires a stored seat that no longer starts.",
    inputSchema: fireInput,
    outputSchema: fireOutput,
    execute: async (input, ctx) => {
      const orgId = orgOf(ctx);
      const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
      const located = await locateSeatRow(ctx, input.seatId, { orgId, inventory });
      const removed = await removeHiredSeat({
        orgId,
        roster: located.roster,
        key: located.key,
        inventory,
        address: seatAddress(orgId, input.seatId, located.ownerUserId),
        isHeld: (address) => options.kindAt?.(address) !== undefined,
        release: (address, storedKind) => {
          const liveKind = options.kindAt?.(address);
          if (liveKind !== undefined && liveKind !== storedKind) {
            console.error(
              `[seat-hire] removed the roster row for "${address}" (kind "${storedKind}"), but the ` +
                `address is held by a flow of kind "${liveKind}" — leaving it registered.`
            );
            return "held-by-another";
          }
          return options.unregister(address) ? "released" : "not-held";
        },
      });

      switch (removed.outcome) {
        case "removed":
          return { seatId: input.seatId, address: removed.address, released: removed.released };
        case "unreadable":
          return { seatId: input.seatId, address: null, released: false };
        case "already-gone":
          return { seatId: input.seatId, address: removed.address, released: false, alreadyGone: true as const };
        case "nothing":
          throw new Error(
            options.kindAt?.(removed.address) === undefined
              ? `This organization hired no seat "${input.seatId}".`
              : `"${removed.address}" was not hired through this tool — a seat declared in a worker file is ` +
                `removed by editing its folder, not by firing it.`
          );
      }
    },
  });

  const brokenSeats = handler({
    name: "brokenSeats",
    description:
      "List this organization's stored seats that would not start, each with its reason " +
      "(kind-gone, refused, unreadable), the caller's own user-owned seats included when the " +
      "flow mounts that roster. Reads only.",
    inputSchema: brokenSeatsInput,
    outputSchema: brokenSeatsOutput,
    execute: async (_input, ctx) => {
      const orgId = orgOf(ctx);
      // The org's rows, and the caller's own user-owned rows when the flow
      // mounts that roster: the same rows the start reads for this member.
      const owned = privateRosterOf(ctx);
      const rows = [
        ...(await collectionOf(ctx, HIRED_ROSTER_RESOURCE).list()),
        ...(owned === undefined ? [] : await owned.list()),
      ];
      const broken: Array<z.infer<typeof brokenSeatOutput>> = [];
      for (const ref of rows) {
        const checked = checkHiredSeatRow(orgId, ref.state, kinds);
        if (checked.ok) continue;
        // The id `fire` takes: the key's last segment (`~<user>/<seat>` for a
        // user-owned row, which `fire` finds by the caller).
        const relativeKey = (
          ref.path.startsWith(HIRED_ROSTER_PREFIX) ? ref.path.slice(HIRED_ROSTER_PREFIX.length) : ref.path
        ).split("/").pop()!;
        broken.push({
          seatId: checked.reason === "unreadable" ? relativeKey : (checked.row?.seatId ?? relativeKey),
          key: ref.path,
          kind: checked.row?.flow ?? null,
          reason: checked.reason,
          detail: checked.detail,
        });
      }
      return broken.sort((left, right) => left.key.localeCompare(right.key));
    },
  });

  const rehire = handler({
    name: "rehire",
    description:
      "Keep a stored seat that no longer starts (its kind is gone, or refuses its settings) at " +
      "its address, on a kind this app carries. The caller names the kind; settings are the new kind's.",
    inputSchema: rehireInput,
    outputSchema: hireOutput,
    execute: async (input, ctx) => {
      const orgId = orgOf(ctx);
      const located = await locateSeatRow(ctx, input.seatId);
      const address = seatAddress(orgId, input.seatId, located.ownerUserId);
      const existing = await located.roster.getOptional(located.key);
      if (existing === undefined) {
        throw new Error(`This organization hired no seat "${input.seatId}".`);
      }

      const before = existing.state as JsonObject;
      const checked = checkHiredSeatRow(orgId, before, kinds);
      if (!checked.ok && (checked.reason === "unreadable" || checked.row === undefined)) {
        throw new Error(`"${input.seatId}" is a row that can't be read (${checked.detail}). Fire it to retire it.`);
      }
      const old = checked.row!;
      const row = toHiredSeatRow({
        seatId: old.seatId,
        flow: input.flow,
        settings: input.settings,
        instructions: input.instructions ?? old.instructions,
        owningOrgId: orgId,
        ownerUserId: old.ownerUserId,
      });
      const pin = hiredSeatOwnerPinFromRosterOwner({ orgId, userId: old.ownerUserId });

      if (checked.ok) {
        // Only a seat the start skips for its kind: a working seat changes
        // kind by fire then hire. The one exception is this same re-hire run
        // again after its row was written (a crash, or an inventory write that
        // failed): the stored row is already the one it would write, so the
        // retry finishes the registration and the inventory row, and writes no
        // roster row.
        if (!deepEqual(row, old)) {
          throw new Error(
            `"${address}" still starts on kind "${old.flow}". To change a working seat's kind, fire it and hire it again.`
          );
        }
        refuseUnhireableKind(input.flow, "re-hire onto");
        const live = options.kindAt?.(address);
        if (live !== undefined && live !== input.flow) {
          throw new Error(`"${address}" is already served by a flow of kind "${live}", so it can't be re-hired.`);
        }
        if (live === undefined) registerHiredSeat(options.register, checked.seat, pin);
        return { seatId: old.seatId, address, ...(await publish(ctx, checked.seat, input.flow, address)) };
      }

      // Everything that can refuse runs before the write.
      refuseUnhireableKind(input.flow, "re-hire onto");
      const held = options.kindAt?.(address);
      if (held !== undefined) {
        throw new Error(`"${address}" is already served by a flow of kind "${held}", so it can't be re-hired.`);
      }
      const seat = mint(orgId, row, address);

      // One version-checked write. If the row moved since it was read (another
      // repair landed, or it was retired), this one is refused rather than
      // written over it.
      await existing.updateState((current) => {
        if (!deepEqual(current, before)) {
          throw new Error(
            `"${address}" changed while this re-hire was being made, most likely by another repair. Nothing was written.`
          );
        }
        return asStored(row);
      });

      try {
        registerHiredSeat(options.register, seat, pin);
      } catch (error) {
        try {
          await existing.updateState(() => before);
        } catch (restoreError) {
          console.error(
            `[seat-hire] "${address}" was re-hired onto "${input.flow}" and could not be registered, and its ` +
              `old row could not be written back either — the next boot serves it on "${input.flow}": ${String(restoreError)}`
          );
        }
        throw error;
      }

      // The seat is re-hired and serving from here on; only its inventory row
      // is left. If that write fails, the same call run again finishes it
      // (the retry branch above), so the error says so instead of undoing a
      // repair that took.
      try {
        return { seatId: old.seatId, address, ...(await publish(ctx, seat, input.flow, address)) };
      } catch (error) {
        throw new Error(
          `"${address}" was re-hired onto "${input.flow}" and is serving, but its inventory row could not be ` +
            `written: ${error instanceof Error ? error.message : String(error)}. Run the same re-hire again to finish it.`
        );
      }
    },
  });

  return { hire, fire, brokenSeats, rehire };
}
