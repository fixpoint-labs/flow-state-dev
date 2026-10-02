/**
 * `createSeatHireCapability` — hire, fire and the two repairs as catalog
 * tools on the existing mint.
 *
 * Compose it into a worker kind's `uses` and the kind's catalog gains `hire`,
 * `fire`, `brokenSeats` and `rehire`. That is a grant the kind offers, not a
 * grant a seat holds: a seat still names the tool in `tools:`, and an empty
 * list stays empty (FIX-1393). The tools mint and retire seats of kinds this
 * factory closed over, write the durable roster, write `inventory/seats/*` so
 * Discover can see the new seat, and register the address. They do not invent
 * a kind, and they do not attach boards.
 *
 * ## Which changes ask a person first
 *
 * `askBefore` names the verbs whose tool raises a stock `human_approval`
 * before it writes: the tool checks the change would succeed, asks, checks
 * again on Approve, then makes it. Deny changes nothing, and the model reads
 * the denial as the tool's result. `rehire` always asks, whatever the list
 * says, because a repair is the person's call. `brokenSeats` only reads, and
 * never asks. Omitted, `hire` and `fire` are the blocks themselves, exactly as
 * before the option existed.
 *
 * A verb that asks needs durable execution: the answer arrives later, through
 * the engine's resume route, and a restart in between leaves the ask standing.
 * In an app without it, the tool refuses by name and changes nothing.
 *
 * The blocks an action mounts directly (`createSeatHireBlocks`) never ask: the
 * person calling that action already decided.
 *
 * ## Why this is a sibling of `createWorkforceCapability`, not a preset on it
 *
 * That capability's door is a control *because* composing it means "you may
 * ask what is around you." Hire is a grant a seat must name. Different fence,
 * different factory.
 */

import { defineCapability, handler, SuspensionError, SuspensionRejectedError } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import type { ZodTypeAny } from "zod";
import { defineHiredRosterCollection } from "./roster/collections";
import { defineSeatInventoryCollection } from "./inventory/collections";
import { HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "./seat-hire-keys";
import {
  buildSeatHire,
  createSeatHireBlocks,
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
  type HiredSeatOwnerPin,
  type SeatHireBlocks,
  type SeatHireCapabilityOptions,
  type SeatHireVerb,
} from "./seat-hire-blocks";

/** The capability name a worker file spells under `capabilities:`. */
export const SEAT_HIRE_CAPABILITY = "seat-hire";

/** Re-exported so existing imports of this module keep resolving. */
export {
  createSeatHireBlocks,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  hiredSeatOwnerPinFromRosterOwner,
  registerHiredSeat,
  type HiredSeatOwnerPin,
  type SeatHireBlocks,
  type SeatHireCapabilityOptions,
};

/** A roster change a Lab can put behind a person's approval. */
export type SeatHireAskVerb = "hire" | "fire";

/** What a seat-hire approval carries in its `data`, for Inbox and the screens that read it. */
export interface SeatHireAskData {
  verb: SeatHireAskVerb | "rehire";
  seatId: string;
  /** The kind hired or re-hired onto, the kind a fired seat stored, or `null` for a row that does not read. */
  kind: string | null;
}

export interface SeatHireToolOptions extends SeatHireCapabilityOptions {
  /**
   * The changes whose tool asks a person before it writes. Default `[]`:
   * nothing asks. `rehire` asks whatever this says.
   */
  askBefore?: readonly SeatHireAskVerb[];
}

const ASK_VERBS: readonly SeatHireAskVerb[] = ["hire", "fire"];

/**
 * Build the seat-hire capability.
 *
 * @param options The kinds map, register/unregister, the optional allowlist /
 *   board ids, and `askBefore`. Org is never an option: it comes from the
 *   principal at the call.
 * @returns A capability named `seat-hire`, contributing catalog `hire`,
 *   `fire`, `brokenSeats` and `rehire`, and installing the roster and
 *   seat-inventory collections.
 * @throws when `askBefore` names a verb other than `hire` or `fire`.
 */
export function createSeatHireCapability(options: SeatHireToolOptions): DefinedCapability {
  const askBefore = new Set(options.askBefore ?? []);
  for (const verb of askBefore) {
    if (!ASK_VERBS.includes(verb)) {
      throw new Error(`askBefore names "${String(verb)}"; it takes ${ASK_VERBS.join(" and ")}.`);
    }
  }
  const { blocks, verbs } = buildSeatHire(options);

  const hire = askBefore.has("hire") ? asking(blocks.hire, "hire", verbs.hire) : blocks.hire;
  const fire = askBefore.has("fire") ? asking(blocks.fire, "fire", verbs.fire) : blocks.fire;
  const rehire = asking(blocks.rehire, "rehire", verbs.rehire);

  return defineCapability({
    name: SEAT_HIRE_CAPABILITY,
    resources: {
      [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
      [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection(),
    },
    presets: {
      tools: { tools: [hire, fire, blocks.brokenSeats, rehire] },
      default: ["tools"],
    },
  });
}

/** What the ask says, in Inbox's words. */
function askMessage(data: SeatHireAskData): string {
  const kind = data.kind === null ? "" : ` (kind "${data.kind}")`;
  switch (data.verb) {
    case "hire":
      return `Hire seat "${data.seatId}"${kind}?`;
    case "fire":
      return `Fire seat "${data.seatId}"${kind}?`;
    case "rehire":
      return `Re-hire seat "${data.seatId}" onto${kind === "" ? " a new kind" : kind}?`;
  }
}

/**
 * A verb's tool that asks first: check, ask, then make the change, whose own
 * refusals are the check again.
 *
 * The runtime re-enters the tool from the top on Approve, and on a restart
 * that picks up an approved request, so the check before the ask runs again
 * then too: a change that has since stopped being possible is refused rather
 * than asked twice or made. A re-entry after the change landed meets its
 * write's own refusal (a second hire of one id) or no-op (a fire of a seat
 * already gone), so it is never made twice.
 */
function asking<I extends { seatId: string }, O>(
  block: BlockDefinition<ZodTypeAny, ZodTypeAny>,
  verb: SeatHireAskData["verb"],
  run: SeatHireVerb<I, O>,
): BlockDefinition<ZodTypeAny, ZodTypeAny> {
  return handler({
    name: block.name,
    description: `${block.description ?? ""} Waits for a person's approval first; a denial changes nothing.`.trim(),
    inputSchema: block.inputSchema as ZodTypeAny,
    outputSchema: block.outputSchema as ZodTypeAny,
    execute: async (input: I, ctx: BlockContext) => {
      const { kind } = await run.check(input, ctx);
      const data: SeatHireAskData = { verb, seatId: input.seatId, kind };
      const cannotAsk = (why: string) =>
        new Error(`"${block.name}" waits for a person's approval here, and this app can't ask for one: ${why} Nothing was changed.`);
      if (ctx.suspend === undefined) throw cannotAsk("it runs without durable execution.");
      try {
        await ctx.suspend({
          reason: "human_approval",
          message: askMessage(data),
          data: { ...data },
          allow: ["approve", "reject"],
        });
      } catch (error) {
        // The ask itself, and a denial on resume, are control flow the runtime
        // handles. Anything else is an app that cannot hold an ask.
        if (error instanceof SuspensionError || error instanceof SuspensionRejectedError) throw error;
        throw cannotAsk(error instanceof Error ? error.message : String(error));
      }
      return await run.run(input, ctx);
    },
  }) as unknown as BlockDefinition<ZodTypeAny, ZodTypeAny>;
}
