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
 * `HIRED_ROSTER_PRIVATE_RESOURCE`, `fire` and `rehire` take an `owner`
 * (`"organization"` or `"me"`) naming which row they act on, and `brokenSeats`
 * lists the caller's own user-owned rows beside the org's, each with its
 * `owner`. Without `owner` they act on the only row under the seat id, and
 * refuse when the caller has both. That collection serves a row only to the member it belongs to, so
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
  ResourceRef,
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
import { deleteOwnInventoryRow, INVENTORY_RACE_ATTEMPTS, isWriteConflict, removeHiredSeat } from "./roster/remove";
import { incarnationOfRow, mintedFrom, newIncarnation, tagIncarnation } from "./roster/incarnation";
import { hiredSeatManifest, seatAddress, toHiredSeatRow } from "./roster/rows";
import { resolveHiredSeatLocation, type HiredSeatLocation, type HiredSeatOwner } from "./roster/locate";

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
   * The seat serving an address right now, if any — the registry's own
   * instance. Lets `rehire`, run again to finish a repair, count a seat the
   * registry already holds as its own when that seat was minted from the
   * repaired row (a restart registered it). Omitted, a retry that finds the
   * address taken is refused, since nothing else can tell that seat from an
   * unrelated one of the same kind.
   */
  instanceAt?: (id: string) => FlowInstance | undefined;
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

/**
 * Whose roster row a seat id names: the organization's, or the caller's own
 * user-owned one. `brokenSeats` reports it on each entry; `fire` and `rehire`
 * take it, and need it when the caller has both rows under one seat id.
 */
const seatOwner = z.enum(["organization", "me"]);

const fireInput = z
  .object({
    seatId: z.string().min(1),
    /** Which row to fire. Omitted, the only row under the id; refused when there are two. */
    owner: seatOwner.optional(),
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
  /** Whose row it is: what `fire` and `rehire` take as `owner` to reach this row. */
  owner: seatOwner,
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
    /** Which row to repair. Omitted, the only row under the id; refused when there are two. */
    owner: seatOwner.optional(),
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

/**
 * Find a seat's roster row for this call: `resolveHiredSeatLocation` over this
 * flow's two rosters and the session's user.
 */
function locateSeatRow(
  ctx: BlockContext,
  seatId: string,
  owner: HiredSeatOwner | undefined,
  leftoverAt: { orgId: string; inventory: ResourceCollectionRef } | null
): Promise<HiredSeatLocation> {
  return resolveHiredSeatLocation({
    seatId,
    owner,
    roster: collectionOf(ctx, HIRED_ROSTER_RESOURCE),
    privateRoster: privateRosterOf(ctx),
    userId: ctx.session.identity.userId,
    leftoverAt,
  });
}

/** A row's pending-repair marker; `null` when none, or on a row from before the field (BP-030). */
function pendingRepairOf(state: JsonObject): string | null {
  return typeof state.pendingRepair === "string" ? state.pendingRepair : null;
}

/** The row no longer carries this call's incarnation: another call replaced it. */
class SeatMoved extends Error {
  constructor(address: string) {
    super(`"${address}" changed while this call was finishing it, most likely by another hire or repair of it. This call stopped.`);
  }
}

/**
 * The call's own roster row failed its check: carried out of an inventory
 * write, so it isn't read as that write's conflict.
 */
class FenceFailed extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/** The address has a declared seat's inventory row, which no hire writes over. */
class DeclaredRow extends Error {
  constructor(address: string) {
    super(`"${address}" has a declared seat's inventory row, which a hire does not write over.`);
  }
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

  /**
   * Refuse an address a declared seat's inventory row sits at (a team named
   * like the organization), even while nothing serves it. Writes nothing.
   */
  const refuseDeclaredAddress = async (ctx: BlockContext, address: string): Promise<void> => {
    const row = await collectionOf(ctx, SEAT_INVENTORY_RESOURCE).getOptional(address);
    if (row?.state.hired === false) {
      throw new Error(`"${address}" is a seat declared in a worker file. Hire under another id.`);
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
    tagIncarnation(seat, row.incarnation);
    return seat;
  };

  /**
   * Publish the seat's inventory row, and say what a person should know.
   *
   * Every write runs `fence` (the call's roster row is still current) after
   * looking at the row it replaces, and lands only on that row: a create when
   * there was none, otherwise a version-checked replace whose check runs inside
   * the write, so a row another writer put there since is looked at, and
   * fenced for, again. While the call's roster row is current, no other hire's
   * row at the address can be live (one roster row per address), so the row
   * replaced is this incarnation's or a stale one. A declared seat's row
   * (`hired: false`) is never written over.
   */
  const publish = async (
    ctx: BlockContext,
    seat: FlowInstance,
    flow: string,
    address: string,
    incarnation: string,
    fence: () => Promise<unknown>
  ) => {
    const door = seatDoorOf(seat);
    const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
    const next: JsonObject = { id: address, kind: flow, door: door.door, hired: true, incarnation };
    const create = async () => {
      await fence();
      await inventory.create(address, next);
    };
    let written = false;
    for (let attempt = 0; attempt < INVENTORY_RACE_ATTEMPTS && !written; attempt += 1) {
      try {
        const row = await inventory.getOptional(address);
        if (row === undefined) {
          await create();
        } else {
          try {
            // The engine re-runs this against the row that won after any
            // version conflict, so the check and the fence always precede
            // the write that lands.
            await row.updateState(async (current) => {
              if (current.hired === false) throw new DeclaredRow(address);
              await fence();
              return next;
            });
          } catch (error) {
            // Deleted since this call read it: write it fresh.
            if (error instanceof FenceFailed || (error as { code?: unknown }).code !== "resource_deleted") throw error;
            await create();
          }
        }
        written = true;
      } catch (error) {
        if (error instanceof FenceFailed || !isWriteConflict(error)) throw error;
      }
    }
    if (!written) {
      throw Object.assign(new Error(`"${address}"'s inventory row kept changing under this call.`), {
        code: "concurrent_modification",
      });
    }
    const warnings = [
      ...unattendedBoardWarnings(options.channelBoards ?? [], [seat]),
      ...(door.problem === undefined ? [] : [door.problem]),
    ];
    return warnings.length > 0 ? { warning: warnings.join("\n") } : {};
  };

  /**
   * Register a seat. A `duplicate-id` refusal counts as registered only on a
   * repair's retry (`own` set), and only when `instanceAt` shows the seat
   * holding the address was minted from this incarnation's row — the one a
   * restart registered. Any other holder, same kind or not, is a refusal.
   *
   * @returns whether this call registered it.
   */
  const registerOnce = (seat: FlowInstance, pin: InstanceOwnerPin, own?: string): boolean => {
    try {
      registerHiredSeat(options.register, seat, pin);
      return true;
    } catch (error) {
      const refused = error as { reason?: unknown; id?: unknown };
      if (own !== undefined && refused.reason === "duplicate-id" && refused.id === seat.id) {
        const live = options.instanceAt?.(seat.id);
        if (live !== undefined && live.kind === seat.kind && mintedFrom(live, own)) return false;
      }
      throw error;
    }
  };

  /**
   * The steps after a hire or re-hire wrote its roster row: register, publish
   * the inventory row, and (for a re-hire) clear the row's pending-repair
   * marker. Before each side effect the row is re-read from the store (a
   * verified no-op write) and must still exist carrying `incarnation`.
   *
   * A conflict of any kind (the row was deleted, carries another incarnation,
   * or another writer kept moving the inventory row) stops the call and takes
   * back only what is still this incarnation's: the seat at the address when
   * `instanceAt` shows it was minted from this incarnation, and the inventory
   * row while it carries it. The other writer's seat, row and registration are
   * left as they are. Without `instanceAt` the seat is left registered, since
   * nothing can tell it from a seat hired again at the address.
   */
  const settle = async (
    ctx: BlockContext,
    ref: ResourceRef<JsonObject>,
    incarnation: string,
    seat: FlowInstance,
    pin: InstanceOwnerPin,
    flow: string,
    address: string,
    step: {
      /** A repair's retry: a registration of this incarnation's seat counts as done. */
      retry?: boolean;
      /** Clear `pendingRepair` as the last write (a re-hire). */
      repair?: boolean;
      /** Undo the row write when registration is refused. */
      onRegisterFailed?: (error: unknown) => Promise<void>;
    }
  ) => {
    const stillOurs = (current: JsonObject) => {
      if (incarnationOfRow(current) !== incarnation) throw new SeatMoved(address);
      return current;
    };
    const fence = async () => {
      try {
        await ref.updateState(stillOurs);
      } catch (error) {
        throw new FenceFailed(error);
      }
    };
    try {
      await fence();
      try {
        registerOnce(seat, pin, step.retry ? incarnation : undefined);
      } catch (error) {
        await step.onRegisterFailed?.(error);
        throw error;
      }
      let warnings: { warning?: string };
      try {
        warnings = await publish(ctx, seat, flow, address, incarnation, fence);
      } catch (error) {
        // A fire that removed the inventory row under this write removed the
        // roster row first; that is the conflict below, not a failed write.
        if (error instanceof FenceFailed || isWriteConflict(error)) throw error;
        await fence();
        if (!step.repair) throw error;
        throw new Error(
          `"${address}" was re-hired onto "${flow}" and is serving, but its inventory row could not be ` +
            `written: ${error instanceof Error ? error.message : String(error)}. Run the same re-hire again to finish it.`
        );
      }
      await ref.updateState((current) =>
        step.repair && pendingRepairOf(current) === incarnation
          ? { ...stillOurs(current), pendingRepair: null }
          : stillOurs(current)
      );
      return warnings;
    } catch (thrown) {
      const error = thrown instanceof FenceFailed ? thrown.reason : thrown;
      if (!(error instanceof SeatMoved) && !isWriteConflict(error)) throw error;
      // Checked and removed with no await between: the seat at the address
      // is this incarnation's, or it is left.
      const live = options.instanceAt?.(address);
      if (live !== undefined && mintedFrom(live, incarnation)) options.unregister(address);
      await deleteOwnInventoryRow(collectionOf(ctx, SEAT_INVENTORY_RESOURCE), address, incarnation);
      throw new Error(
        (error as { code?: unknown }).code === "resource_deleted"
          ? `"${address}" was fired while this call was finishing it. Nothing of it was kept.`
          : `"${address}" changed while this call was finishing it, most likely by another hire, fire or ` +
              `repair of it. This call stopped and kept nothing of its own; the other one's seat was left as it is.`
      );
    }
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
      await refuseDeclaredAddress(ctx, address);

      const incarnation = newIncarnation();
      const row = toHiredSeatRow({
        seatId: input.seatId,
        flow: input.flow,
        settings: input.settings,
        instructions: input.instructions ?? null,
        owningOrgId: orgId,
        incarnation,
      });
      const seat = mint(orgId, row, address);

      const roster = collectionOf(ctx, HIRED_ROSTER_RESOURCE);
      const written = await roster.create(input.seatId, asStored(row));

      // Pin from the roster owner of the row just written — the org cell of
      // this hire — not from `seat.id`. Address is a name the caller can type;
      // it is not evidence of ownership (FIX-1529 / F2-PLAN).
      const warnings = await settle(ctx, written, incarnation, seat, { orgId }, input.flow, address, {
        onRegisterFailed: async () => {
          try {
            await roster.delete(input.seatId);
          } catch (cleanupError) {
            console.error(
              `[seat-hire] "${address}" was written and could not be registered, and its row could ` +
                `not be removed either — the next boot will skip and name it: ${String(cleanupError)}`
            );
          }
        },
      });
      return { seatId: input.seatId, address, ...warnings };
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
      const located = await locateSeatRow(ctx, input.seatId, input.owner, { orgId, inventory });
      const removed = await removeHiredSeat({
        orgId,
        roster: located.roster,
        key: located.key,
        inventory,
        address: seatAddress(orgId, input.seatId, located.ownerUserId),
        isHeld: (address) => options.instanceAt?.(address) !== undefined || options.kindAt?.(address) !== undefined,
        release: (address, storedKind, incarnation) => {
          // With `instanceAt`, only the seat minted from this row is released:
          // checked and removed with no await between. A `null` incarnation
          // matches only a seat minted from a row from before incarnations,
          // never a declared one.
          if (options.instanceAt !== undefined) {
            const live = options.instanceAt(address);
            if (live === undefined) return "not-held";
            if (!mintedFrom(live, incarnation)) {
              console.error(
                `[seat-hire] removed the roster row for "${address}", but the address is held by a seat ` +
                  `that row didn't mint — leaving it registered.`
              );
              return "held-by-another";
            }
            return options.unregister(address) ? "released" : "not-held";
          }
          // Without it, the kind is all there is to go on.
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
        ...(await collectionOf(ctx, HIRED_ROSTER_RESOURCE).list()).map((ref) => ({ ref, owner: "organization" as const })),
        ...(owned === undefined ? [] : await owned.list()).map((ref) => ({ ref, owner: "me" as const })),
      ];
      const broken: Array<z.infer<typeof brokenSeatOutput>> = [];
      for (const { ref, owner } of rows) {
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
          owner,
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
      // Re-hire acts only on a row that exists, so there is no leftover to find.
      const located = await locateSeatRow(ctx, input.seatId, input.owner, null);
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
        // A seat the start serves is not repaired: a working seat changes kind
        // by fire then hire. The one exception is a re-hire that wrote this
        // row and didn't finish (the process died, or the inventory write
        // failed), which the row says itself with its pending-repair marker.
        // Only the same re-hire finishes it; a row with no marker (an older
        // row included, BP-030) has no repair pending.
        const token = old.pendingRepair;
        if (token === null || old.incarnation !== token) {
          throw new Error(
            `"${address}" still starts on kind "${old.flow}". To change a working seat's kind, fire it and hire it again.`
          );
        }
        if (!deepEqual(row, { ...old, pendingRepair: null, incarnation: null })) {
          throw new Error(
            `"${address}" has an unfinished re-hire onto "${old.flow}". Run that same re-hire again to finish it.`
          );
        }
        refuseUnhireableKind(input.flow, "re-hire onto");
        const live = options.kindAt?.(address);
        if (live !== undefined && live !== input.flow) {
          throw new Error(`"${address}" is already served by a flow of kind "${live}", so it can't be re-hired.`);
        }
        const warnings = await settle(ctx, existing, token, checked.seat, pin, input.flow, address, {
          retry: true,
          repair: true,
        });
        return { seatId: old.seatId, address, ...warnings };
      }

      // Everything that can refuse runs before the write.
      refuseUnhireableKind(input.flow, "re-hire onto");
      const held = options.kindAt?.(address);
      if (held !== undefined) {
        throw new Error(`"${address}" is already served by a flow of kind "${held}", so it can't be re-hired.`);
      }
      await refuseDeclaredAddress(ctx, address);
      const token = newIncarnation();
      const seat = mint(orgId, { ...row, incarnation: token }, address);

      // One version-checked write, marked as a repair in progress until the
      // seat is registered and published. If the row moved since it was read
      // (another repair landed, or it was retired), this one is refused rather
      // than written over it.
      await existing.updateState((current) => {
        if (!deepEqual(current, before)) {
          throw new Error(
            `"${address}" changed while this re-hire was being made, most likely by another repair. Nothing was written.`
          );
        }
        // Onto the stored row, so a key a newer version wrote is kept.
        return { ...current, ...asStored({ ...row, pendingRepair: token, incarnation: token }) };
      });

      const warnings = await settle(ctx, existing, token, seat, pin, input.flow, address, {
        repair: true,
        onRegisterFailed: async () => {
          // Registration refused: write the old row back, while it is still this repair's.
          try {
            await existing.updateState((current) => {
              if (pendingRepairOf(current) !== token) throw new SeatMoved(address);
              return before;
            });
          } catch (restoreError) {
            console.error(
              `[seat-hire] "${address}" was re-hired onto "${input.flow}" and could not be registered, and its ` +
                `old row could not be written back either — the next boot serves it on "${input.flow}", and the ` +
                `same re-hire run again finishes it: ${String(restoreError)}`
            );
          }
        },
      });
      return { seatId: old.seatId, address, ...warnings };
    },
  });

  return { hire, fire, brokenSeats, rehire };
}
