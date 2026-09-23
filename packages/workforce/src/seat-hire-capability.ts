/**
 * `createSeatHireCapability` — hire and fire as catalog tools on the existing
 * mint.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains `hire`
 * and `fire`. That is a grant the kind offers, not a grant a seat holds: a
 * seat still names the tool in `tools:`, and an empty list stays empty
 * (FIX-1393). The tools mint and retire seats of kinds this factory closed
 * over, write the durable roster, write `inventory/seats/*` so Discover can
 * see the new seat, and register the address. They do not invent a kind, and
 * they do not attach boards.
 *
 * ## Why this is a sibling of `createWorkforceCapability`, not a preset on it
 *
 * That capability's door is a control *because* composing it means "you may
 * ask what is around you." Hire is a grant a seat must name. Different fence,
 * different factory.
 */

import { defineCapability, handler } from "@flow-state-dev/core";
import type { DefinedCapability, JsonObject } from "@flow-state-dev/core";
import type { FlowInstance, ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { hireWorkforce, unattendedBoardWarnings, type HireOptions } from "./hire";
import { defineHiredRosterCollection, type HiredSeatRow } from "./roster/collections";
import { hiredSeatManifest, seatAddress, toHiredSeatRow } from "./roster/rows";
import { defineSeatInventoryCollection } from "./inventory/collections";

/** The capability name a worker file spells under `capabilities:`. */
export const SEAT_HIRE_CAPABILITY = "seat-hire";

/** Registry key the capability installs the durable roster under. */
export const HIRED_ROSTER_RESOURCE = "hiredRoster";

/** Registry key the capability installs the seat inventory under. */
export const SEAT_INVENTORY_RESOURCE = "seatInventory";

/**
 * The owner pin a hired-seat register must carry (FIX-1529 / F2-PLAN).
 *
 * Derived from the hire row's roster owner, never from the address. `orgId`
 * is the owning org. `userId` is present only when that row is user-owned.
 */
export interface HiredSeatOwnerPin {
  orgId: string;
  userId?: string;
}

/**
 * Project a hire row's roster owner into the pin registration requires.
 *
 * @throws when `orgId` is missing — an unpinned hired-seat register is
 * refused rather than admitted as shared.
 */
export function hiredSeatOwnerPinFromRosterOwner(
  owner: { orgId?: string | null; userId?: string | null },
): HiredSeatOwnerPin {
  if (typeof owner.orgId !== "string" || owner.orgId.length === 0) {
    throw new Error(
      "A hired seat cannot be registered without an owner pin { orgId, userId? } derived from the hire row's roster owner.",
    );
  }
  return typeof owner.userId === "string" && owner.userId.length > 0
    ? { orgId: owner.orgId, userId: owner.userId }
    : { orgId: owner.orgId };
}

/**
 * Admit a hired seat only with a pin from its hire row's roster owner.
 *
 * This is the hire writer's register path. Omitting the pin refuses. Engine
 * `register(flow, { pin })` is FIX-1529; this gate exists so seat-hire cannot
 * leave an unpinned path in the meantime.
 */
export function registerHiredSeat(
  register: (seat: FlowInstance, pin: HiredSeatOwnerPin) => void,
  seat: FlowInstance,
  pin: HiredSeatOwnerPin | undefined,
): void {
  register(seat, hiredSeatOwnerPinFromRosterOwner(pin ?? {}));
}

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
   * row's roster owner. Hire refuses rather than call this without a pin
   * (FIX-1529 / F2-PLAN). A hire that answers is a hire that was written
   * down, so the roster row is created first; if this throws the row is
   * deleted.
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
  address: z.string(),
  released: z.boolean(),
});

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

function asStored(row: HiredSeatRow): JsonObject {
  return row as unknown as JsonObject;
}

function listed(names: readonly string[]): string {
  return names.length > 0 ? names.join(", ") : "(none)";
}

/**
 * Build the seat-hire capability.
 *
 * @param options The kinds map, register/unregister, and the optional
 *   allowlist / board ids. Org is never an option — it comes from the
 *   principal at the call.
 * @returns A capability named `seat-hire`, contributing catalog `hire` and
 *   `fire` and installing the roster and seat-inventory collections.
 */
export function createSeatHireCapability(
  options: SeatHireCapabilityOptions,
): DefinedCapability {
  const kinds = options.kinds ?? {};
  const allow = options.allowKinds === undefined ? undefined : new Set(options.allowKinds);

  const hireableKindNames = (): string[] => {
    const names = new Set<string>(["agent", ...Object.keys(kinds)]);
    if (allow !== undefined) {
      return [...names].filter((name) => allow.has(name)).sort();
    }
    return [...names].sort();
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
      const available = hireableKindNames();

      if (allow !== undefined && !allow.has(input.flow)) {
        throw new Error(
          `This seat may not hire kind "${input.flow}". It may hire: ${listed(available)}.`
        );
      }

      if (!Object.hasOwn(kinds, input.flow) && input.flow !== "agent") {
        throw new Error(
          `This app carries no flow kind "${input.flow}". It carries: ${listed(available)}.`
        );
      }

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

      const inventory = collectionOf(ctx, SEAT_INVENTORY_RESOURCE);
      await inventory.upsert(address, { id: address, kind: input.flow });

      const warnings = unattendedBoardWarnings(options.channelBoards ?? [], [seat]);
      return {
        seatId: input.seatId,
        address,
        ...(warnings.length > 0 ? { warning: warnings.join("\n") } : {}),
      };
    },
  });

  const fire = handler({
    name: "fire",
    description:
      "Remove a runtime-hired seat from the durable roster and release its " +
      "address in this process. The inventory row stays — it means was registered, not still hired.",
    inputSchema: fireInput,
    outputSchema: fireOutput,
    execute: async (input, ctx) => {
      const orgId = orgOf(ctx);
      const address = seatAddress(orgId, input.seatId);
      const roster = collectionOf(ctx, HIRED_ROSTER_RESOURCE);
      const existing = await roster.getOptional(input.seatId);
      if (existing === undefined) {
        const held = options.kindAt?.(address);
        throw new Error(
          held === undefined
            ? `This organization hired no seat "${input.seatId}".`
            : `"${address}" was not hired through this tool — a seat declared in a worker file is ` +
              `removed by editing its folder, not by firing it.`
        );
      }

      const storedKind = String(existing.state.flow);
      await roster.delete(input.seatId);

      const liveKind = options.kindAt?.(address);
      if (liveKind !== undefined && liveKind !== storedKind) {
        console.error(
          `[seat-hire] removed the roster row for "${address}" (kind "${storedKind}"), but the ` +
            `address is held by a flow of kind "${liveKind}" — leaving it registered.`
        );
        return { seatId: input.seatId, address, released: false };
      }

      const released = options.unregister(address);
      return { seatId: input.seatId, address, released };
    },
  });

  return defineCapability({
    name: SEAT_HIRE_CAPABILITY,
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    presets: {
      tools: { tools: [hire, fire] },
      default: ["tools"],
    },
  });
}
