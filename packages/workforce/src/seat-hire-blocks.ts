/**
 * `createSeatHireBlocks` — `hire`, `fire`, `brokenSeats` and `rehire` as
 * blocks, with no model in front of them and no approval of their own.
 *
 * An action mounts any of the four directly, and nothing asks: the person
 * calling the action already decided. `createSeatHireCapability` mounts all
 * four as catalog tools and puts the ones a Lab names in `askBefore`, and
 * `rehire` always, behind a person's approval. It reads each verb's checks and
 * its write from {@link buildSeatHire}, so the tool and the block refuse the
 * same things in the same words.
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
  SEAT_INVENTORY_RESOURCE,
  SEAT_ADMIN_TOOLS,
  SEAT_HIRE_CAPABILITY,
} from "./seat-hire-keys";
import { seatDoorOf } from "./seat-door";
import { hireWorkforce, KindRefusedHireError, unattendedBoardWarnings, type HireOptions } from "./hire";
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
   * it does for host hire. Every seat hired here is a hired worker (it carries an owner pin), so a flow the
   * map keeps for declared workers (`{ flow, standardOnly: true }`) refuses it.
   */
  workerFlows?: HireOptions["workerFlows"];
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
   * Keep roster admin with the seats the app declares. When `true`, `hire` and
   * `rehire` refuse settings that would give the new seat the roster tools: a
   * `tools:` line naming `hire`, `fire`, `rehire` or `brokenSeats`, or a
   * `capabilities:` pick of `seat-hire`. Default `false`: a hired seat may be
   * given them like any other tool.
   */
  refuseRosterAdmin?: boolean;
  /**
   * Kinds this tool may mint, as a subset of {@link SeatHireCapabilityOptions.workerFlows}.
   * Omitted, every kind on the map (plus the built-in `agent`) is hireable.
   */
  allowKinds?: readonly string[];
  /**
   * Mailbox-board ledger ids, forwarded to `hireWorkforce` so an unattended
   * board still warns. Hire does not attach boards; the warning is the
   * honesty.
   */
  mailboxBoards?: readonly string[];
}

const hireInput = z
  .object({
    seatId: z.string().min(1),
    flow: z.string().min(1),
    settings: z
      .record(z.unknown())
      .default({})
      .describe(
        "The kind's own settings. Some kinds require one or more, such as the document a seat " +
          "reads; your instructions name them and their values. The built-in `agent` kind needs none."
      ),
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

/**
 * Refuse settings that would hand the seat roster admin, whatever its kind:
 * a `tools:` line naming a seat-hire tool, or a `capabilities:` pick of the
 * seat-hire capability. Applied only under the `refuseRosterAdmin` option.
 */
function refuseRosterAdminIn(settings: Record<string, unknown> | undefined, verb: string): void {
  const tools = settings?.tools;
  const named = Array.isArray(tools) ? tools.filter((name) => SEAT_ADMIN_TOOLS.includes(name as string)) : [];
  const capabilities = settings?.capabilities;
  const picked =
    capabilities !== null && typeof capabilities === "object" && Object.hasOwn(capabilities, SEAT_HIRE_CAPABILITY);
  if (named.length === 0 && !picked) return;
  const what = named.length > 0 ? `the tools ${named.map((name) => `"${name}"`).join(", ")}` : `the "${SEAT_HIRE_CAPABILITY}" capability`;
  throw new Error(
    `This ${verb} asks for ${what}. This app keeps the roster tools with the seats it declares: ` +
      `a seat this tool hires can't hire, fire or repair seats. Hire it without them.`
  );
}

/** The row no longer carries this call's incarnation: another call replaced it. */
class SeatMoved extends Error {
  constructor(address: string) {
    super(`"${address}" changed while this call was finishing it, most likely by another hire or repair of it. This call stopped.`);
  }
}

/**
 * Refuse an approved change when the seat id now names a different row than
 * the one the person was asked about: another hire under the same id, a
 * different kind, or the other owner's seat.
 *
 * Only reached when a row is there to change. One with no incarnation (an
 * older row, or one a writer stamped none on) is refused: a replacement
 * written the same way would carry none either, and nothing else tells the
 * two apart.
 */
function refuseIfReplaced(verb: string, address: string, approved: SeatHireChecked, now: SeatHireChecked): void {
  if (approved.incarnation === null || now.incarnation === null) {
    throw new Error(
      `The seat "${address}" carries no incarnation on its roster row (it was written before incarnations, or ` +
        `by a writer that stamps none), so this approval can't be tied to the seat you were asked about, and the ` +
        `${verb} was not made.`
    );
  }
  if (approved.owner === now.owner && approved.incarnation === now.incarnation && (verb !== "fire" || approved.kind === now.kind)) {
    return;
  }
  throw seatChanged(verb, address);
}

/** The refusal for an approved change whose row is no longer the one approved. */
function seatChanged(verb: string, address: string): Error {
  return new Error(
    `The seat "${address}" changed while you were asked: it is not the one you approved, so the ${verb} was not made. Ask again if it should be.`
  );
}

/**
 * The token an approved re-hire writes as its pending repair: minted once per
 * tool call and kept on the request, like the check. So a recovery that finds
 * the repair row it wrote knows the row as its own and finishes it, while a
 * pending repair some other call wrote is still a replacement.
 */
async function repairTokenOnce(ctx: BlockContext): Promise<string> {
  const call = ctx._blockIdentity?.blockInstanceId;
  if (ctx.runOnce === undefined || call === undefined) return newIncarnation();
  return await ctx.runOnce(`seat-hire-repair-token:${call}`, async () => newIncarnation());
}

/**
 * The row an approved check found, as `owner` names it: so the change made on
 * Approve reaches that row, and no other the seat id has come to name.
 */
function approvedOwner(approved: SeatHireChecked | undefined): HiredSeatOwner | undefined {
  if (approved === undefined) return undefined;
  return approved.owner === null ? "organization" : "me";
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
 * The seat-hire handlers, model-free. `createSeatHireCapability` mounts all
 * four as catalog tools, with `rehire` (and any verb its `askBefore` names)
 * behind a person's approval; mounted as actions, none of them asks.
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

/** A verb's input and output, as its block declares them. */
export type HireInput = z.infer<typeof hireInput>;
export type HireOutput = z.infer<typeof hireOutput>;
export type FireInput = z.infer<typeof fireInput>;
export type FireOutput = z.infer<typeof fireOutput>;
export type RehireInput = z.infer<typeof rehireInput>;

/**
 * One verb that changes the roster, split where an approval goes between.
 *
 * `check` meets every refusal the change would meet and writes nothing.
 * `run` is the block's whole body, refusals included.
 */
export interface SeatHireVerb<I, O> {
  /**
   * Refuse, writing nothing, if the change would fail now.
   *
   * @returns what the change concerns, for the ask to name and the approval
   *   to bind to: the kind a hire mints or a re-hire moves onto, the kind a
   *   fired row stored (`null` for a row that does not read), and the row.
   */
  check(input: I, ctx: BlockContext): Promise<SeatHireChecked>;
  /**
   * Make the change. Given `approved`, the check a person approved, a fire or
   * re-hire that now finds a different row under the seat id refuses
   * instead of changing it.
   */
  run(input: I, ctx: BlockContext, approved?: SeatHireChecked): Promise<O>;
}

/** What a verb's check found: the kind, and the roster row it found it on. */
export interface SeatHireChecked {
  kind: string | null;
  /** The member a user-owned row belongs to; `null` for an org-visible row, and for a hire. */
  owner: string | null;
  /** The row's incarnation; `null` when there is no row (a hire, a leftover inventory row). */
  incarnation: string | null;
}

/** The three roster changes, each with its check. */
export interface SeatHireVerbs {
  readonly hire: SeatHireVerb<HireInput, HireOutput>;
  readonly fire: SeatHireVerb<FireInput, FireOutput>;
  readonly rehire: SeatHireVerb<RehireInput, HireOutput>;
}

/**
 * Build `{ hire, fire, brokenSeats, rehire }`.
 *
 * @param options Kinds, register/unregister, and the optional allowlist.
 *   Org comes from the principal at the call, not from options.
 */
export function createSeatHireBlocks(options: SeatHireCapabilityOptions): SeatHireBlocks {
  return buildSeatHire(options).blocks;
}

/**
 * The blocks and, under them, each verb's check and write.
 *
 * For `createSeatHireCapability`, whose gated tools check, ask, check again
 * and write. Not exported from the package: an app mounts the blocks.
 *
 * @param options As {@link createSeatHireBlocks}.
 */
export function buildSeatHire(options: SeatHireCapabilityOptions): {
  blocks: SeatHireBlocks;
  verbs: SeatHireVerbs;
} {
  const workerFlows = options.workerFlows ?? {};
  const allow = options.allowKinds === undefined ? undefined : new Set(options.allowKinds);

  const hireableKindNames = (): string[] => {
    const names = new Set<string>(["agent", ...Object.keys(workerFlows)]);
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
    if (!Object.hasOwn(workerFlows, flow) && flow !== "agent") {
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
      workerFlows,
      mailboxBoards: options.mailboxBoards,
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
    // No door warning: the hire already refused a worker flow with none or two.
    const warnings = unattendedBoardWarnings(options.mailboxBoards ?? [], [seat]);
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
      /**
       * Undo this call's roster write, only while the row is still this
       * call's: when registration is refused, and when a declared seat's
       * inventory row turned up at the address before the publish.
       */
      undoRowWrite?: () => Promise<void>;
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
        await step.undoRowWrite?.();
        throw error;
      }
      let warnings: { warning?: string };
      try {
        warnings = await publish(ctx, seat, flow, address, incarnation, fence);
      } catch (error) {
        // A fire that removed the inventory row under this write removed the
        // roster row first; that is the conflict below, not a failed write.
        if (error instanceof FenceFailed || isWriteConflict(error)) throw error;
        if (error instanceof DeclaredRow) {
          // A boot wrote a declared seat's row here after this call checked
          // the address (a rolling deploy whose old process still declares
          // it). A hire never writes over one, so it takes back what it did:
          // the seat it registered, then its roster row. The declared row and
          // anything else at the address are left.
          const live = options.instanceAt?.(address);
          if (live !== undefined && mintedFrom(live, incarnation)) options.unregister(address);
          await step.undoRowWrite?.();
          throw new Error(
            `"${address}" was taken by a declared seat's inventory row while this call was finishing it, ` +
              `and a hire does not write over a declared seat. This call took back its seat and its roster row.`
          );
        }
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

  /** Every refusal a hire meets before it writes, and the seat it would mint. */
  const prepareHire = (input: HireInput, ctx: BlockContext) => {
    const orgId = orgOf(ctx);
    const address = seatAddress(orgId, input.seatId);
    refuseUnhireableKind(input.flow, "hire");
    if (options.refuseRosterAdmin === true) refuseRosterAdminIn(input.settings, "hire");

    const held = options.kindAt?.(address);
    if (held !== undefined) {
      throw new Error(
        `"${address}" is already served by a flow of kind "${held}". Fire that seat first, or hire under another id.`
      );
    }
    // A declared seat is registered at its own id (`chief-of-staff`,
    // `<team>.<name>`), so a hire that reused it would be a second seat
    // answering to a declared seat's name.
    const declared = options.kindAt?.(input.seatId);
    if (declared !== undefined) {
      throw new Error(
        `"${input.seatId}" is the id of a seat this app declares (kind "${declared}"). Hire under another id.`
      );
    }

    const incarnation = newIncarnation();
    const row = toHiredSeatRow({
      seatId: input.seatId,
      flow: input.flow,
      settings: input.settings,
      instructions: input.instructions ?? null,
      owningOrgId: orgId,
      incarnation,
    });
    // The kind's own refusal (typed at its source by `hireWorkforce`) writes
    // nothing and the caller can correct it, so say so: a model reading only
    // the boot-time sentence takes it as final. A framework refusal or any
    // other mint fault keeps its own message.
    let seat: FlowInstance;
    try {
      seat = mint(orgId, row, address);
    } catch (error) {
      if (!(error instanceof KindRefusedHireError)) throw error;
      throw new Error(
        `"${address}" was not hired, and nothing was written. Kind "${input.flow}" refused it: ` +
          `${error.message}\n` +
          `If that names a setting, call hire again with it in \`settings\`.`
      );
    }
    return { orgId, address, row, incarnation, seat };
  };

  const hireVerb: SeatHireVerb<HireInput, HireOutput> = {
    check: async (input, ctx) => {
      const { address } = prepareHire(input, ctx);
      // The write's own duplicate refusal is `create()`; asked before an
      // approval, it has to be read.
      if ((await collectionOf(ctx, HIRED_ROSTER_RESOURCE).getOptional(input.seatId)) !== undefined) {
        throw new Error(`This organization already hired a seat "${input.seatId}". Fire it first, or hire under another id.`);
      }
      await refuseDeclaredAddress(ctx, address);
      return { kind: input.flow, owner: null, incarnation: null };
    },
    run: async (input, ctx) => {
      const { orgId, address, row, incarnation, seat } = prepareHire(input, ctx);
      await refuseDeclaredAddress(ctx, address);

      const roster = collectionOf(ctx, HIRED_ROSTER_RESOURCE);
      const written = await roster.create(input.seatId, asStored(row));

      // Pin from the roster owner of the row just written — the org cell of
      // this hire — not from `seat.id`. Address is a name the caller can type;
      // it is not evidence of ownership (FIX-1529 / F2-PLAN).
      const warnings = await settle(ctx, written, incarnation, seat, { orgId }, input.flow, address, {
        undoRowWrite: async () => {
          try {
            // Only while the row is still this hire's; the delete is
            // version-checked against the row read.
            const current = await roster.getOptional(input.seatId);
            if (current !== undefined && incarnationOfRow(current.state) === incarnation) {
              await roster.delete(input.seatId);
            }
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
  };

  /** The refusal for a fire that finds nothing of this organization's to remove. */
  const nothingToFire = (seatId: string, address: string): Error => {
    const declared = options.kindAt?.(address) !== undefined ? address : options.kindAt?.(seatId) !== undefined ? seatId : undefined;
    return new Error(
      declared === undefined
        ? `This organization hired no seat "${seatId}".`
        : `"${declared}" was not hired through this tool — a seat declared in a worker file is ` +
          `removed by editing its folder, not by firing it.`
    );
  };

  const fireVerb: SeatHireVerb<FireInput, FireOutput> = {
    check: async (input, ctx) => {
      const orgId = orgOf(ctx);
      const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
      const located = await locateSeatRow(ctx, input.seatId, input.owner, { orgId, inventory });
      const address = seatAddress(orgId, input.seatId, located.ownerUserId);
      const existing = await located.roster.getOptional(located.key);
      if (existing !== undefined) {
        const checked = checkHiredSeatRow(orgId, existing.state, workerFlows);
        return { kind: checked.row?.flow ?? null, owner: located.ownerUserId, incarnation: incarnationOfRow(existing.state) };
      }
      // What `removeHiredSeat` does with no row: a hired seat's leftover
      // inventory row (`hired: true`) at an address nothing holds is still
      // removed; anything else is nothing, and is refused before anyone is asked.
      if (options.kindAt?.(address) === undefined) {
        const leftover = await inventory.getOptional(address);
        if (leftover !== undefined && leftover.state.hired === true) {
          return { kind: null, owner: located.ownerUserId, incarnation: null };
        }
      }
      throw nothingToFire(input.seatId, address);
    },
    run: async (input, ctx, approved) => {
      const orgId = orgOf(ctx);
      const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
      // After an approval, the row the person was asked about: its owner,
      // even when the caller named none and the other roster has since gained
      // a row under the same id.
      const located = await locateSeatRow(ctx, input.seatId, input.owner ?? approvedOwner(approved), { orgId, inventory });
      if (approved !== undefined) {
        const now = await located.roster.getOptional(located.key);
        if (now !== undefined) {
          const kind = checkHiredSeatRow(orgId, now.state, workerFlows).row?.flow ?? null;
          refuseIfReplaced(
            "fire",
            seatAddress(orgId, input.seatId, located.ownerUserId),
            approved,
            { kind, owner: located.ownerUserId, incarnation: incarnationOfRow(now.state) }
          );
        }
      }
      const removed = await removeHiredSeat({
        orgId,
        roster: located.roster,
        key: located.key,
        inventory,
        address: seatAddress(orgId, input.seatId, located.ownerUserId),
        // After an approval, only the row the person approved: checked against
        // the removal's own read and its version-checked delete, so a row
        // fired and hired again since the check above is left alone.
        ...(approved === undefined ? {} : { incarnation: approved.incarnation }),
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
          throw nothingToFire(input.seatId, removed.address);
        case "replaced":
          throw seatChanged("fire", removed.address);
      }
    },
  };

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
        const checked = checkHiredSeatRow(orgId, ref.state, workerFlows, ref.path);
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

  /**
   * Every refusal a re-hire meets before it writes, and what it would do: write
   * a new row (`finish: false`), or finish the unfinished re-hire the row's
   * pending-repair marker names (`finish: true`). Writes nothing, so the
   * capability can run it before asking and the write runs it again after.
   */
  const prepareRehire = async (
    input: RehireInput,
    ctx: BlockContext,
    owner: HiredSeatOwner | undefined = input.owner,
    ownToken?: string
  ) => {
    const orgId = orgOf(ctx);
    // Re-hire acts only on a row that exists, so there is no leftover to find.
    const located = await locateSeatRow(ctx, input.seatId, owner, null);
    const address = seatAddress(orgId, input.seatId, located.ownerUserId);
    const existing = await located.roster.getOptional(located.key);
    if (existing === undefined) {
      throw new Error(`This organization hired no seat "${input.seatId}".`);
    }

    const before = existing.state as JsonObject;
    const target = { kind: input.flow, owner: located.ownerUserId, incarnation: incarnationOfRow(before) };
    const checked = checkHiredSeatRow(orgId, before, workerFlows, input.seatId);
    if (!checked.ok && (checked.reason === "unreadable" || checked.row === undefined)) {
      throw new Error(`"${input.seatId}" is a row that can't be read (${checked.detail}). Fire it to retire it.`);
    }
    const old = checked.row!;
    // The key the row was found under says whose it is; a stored owner that
    // says otherwise is refused, not re-derived, since either could be the wrong one.
    if ((old.ownerUserId ?? null) !== (located.ownerUserId ?? null)) {
      throw new Error(
        `"${input.seatId}"'s roster row says it belongs to ${old.ownerUserId === null ? "the whole org" : `user "${old.ownerUserId}"`}, ` +
          `but it is stored as ${located.ownerUserId === null ? "the org's" : `user "${located.ownerUserId}"'s`}, so it was not re-hired. ` +
          `Fire it to retire it.`
      );
    }
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
      // Finishing writes the seat out like any re-hire, so it meets the same
      // refusal: a row left from before the app turned it on is not finished.
      if (options.refuseRosterAdmin === true) refuseRosterAdminIn(input.settings, "re-hire");
      const live = options.kindAt?.(address);
      if (live !== undefined && live !== input.flow) {
        throw new Error(`"${address}" is already served by a flow of kind "${live}", so it can't be re-hired.`);
      }
      return { finish: true as const, target, address, existing, old, token, pin, seat: checked.seat };
    }

    // Everything that can refuse runs before the write.
    refuseUnhireableKind(input.flow, "re-hire onto");
    if (options.refuseRosterAdmin === true) refuseRosterAdminIn(input.settings, "re-hire");
    const held = options.kindAt?.(address);
    if (held !== undefined) {
      throw new Error(`"${address}" is already served by a flow of kind "${held}", so it can't be re-hired.`);
    }
    await refuseDeclaredAddress(ctx, address);
    const token = ownToken ?? newIncarnation();
    const seat = mint(orgId, { ...row, incarnation: token }, address);
    return { finish: false as const, target, address, existing, before, old, row, token, pin, seat };
  };

  const rehireVerb: SeatHireVerb<RehireInput, HireOutput> = {
    check: async (input, ctx) => (await prepareRehire(input, ctx)).target,
    run: async (input, ctx, approved) => {
      // An approved re-hire writes the token kept for this call, so a
      // recovery after the row write finds a pending repair it knows as its
      // own and finishes it. Any other row, a pending repair another call
      // wrote included, is checked against what the person approved.
      const ownToken = approved === undefined ? undefined : await repairTokenOnce(ctx);
      const prepared = await prepareRehire(input, ctx, input.owner ?? approvedOwner(approved), ownToken);
      const ours = prepared.finish && ownToken !== undefined && prepared.token === ownToken;
      if (approved !== undefined && !ours) refuseIfReplaced("re-hire", prepared.address, approved, prepared.target);
      if (prepared.finish) {
        const { address, existing, old, token, pin, seat } = prepared;
        const warnings = await settle(ctx, existing, token, seat, pin, input.flow, address, {
          retry: true,
          repair: true,
        });
        return { seatId: old.seatId, address, ...warnings };
      }
      const { address, existing, before, old, row, token, pin, seat } = prepared;

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
        undoRowWrite: async () => {
          // Write the old row back, while it is still this repair's.
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
  };

  const hire = handler({
    name: "hire",
    description:
      "Mint a seat of a kind this app already registered. Names the kind, a seat id, and in " +
      "`settings` whatever that kind requires: a kind refuses a hire missing a required setting, " +
      "naming it. Does not invent a kind, and does not attach boards.",
    inputSchema: hireInput,
    outputSchema: hireOutput,
    execute: hireVerb.run,
  });

  const fire = handler({
    name: "fire",
    description:
      "Remove a runtime-hired seat: its roster row, its address in this process, and its " +
      "inventory row. Also retires a stored seat that no longer starts.",
    inputSchema: fireInput,
    outputSchema: fireOutput,
    execute: fireVerb.run,
  });

  const rehire = handler({
    name: "rehire",
    description:
      "Keep a stored seat that no longer starts (its kind is gone, or refuses its settings) at " +
      "its address, on a kind this app carries. The caller names the kind; settings are the new kind's.",
    inputSchema: rehireInput,
    outputSchema: hireOutput,
    execute: rehireVerb.run,
  });

  return {
    blocks: { hire, fire, brokenSeats, rehire },
    verbs: { hire: hireVerb, fire: fireVerb, rehire: rehireVerb },
  };
}
