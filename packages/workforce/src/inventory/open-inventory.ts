/**
 * `openInventory` — the boot binder that fills the live inventory.
 *
 * It runs after `openChannels` and writes nothing itself. Everything the
 * inventory holds is written from inside a flow, because a resource collection
 * has no door outside one: the session routes carry session state, and the
 * resource routes carry a collection item's *content*, not its state. So the
 * binder's whole job is to run two actions in the right places and to name what
 * failed.
 *
 * **Two writers, split by where the live answer lives.**
 *
 * A **seat** has no session. What it is — its id and the kind it was hired into
 * — is the roster the process was hired from, which the binder already holds,
 * so the seat rows go out in ONE run carrying all of them.
 *
 * A **channel** has a session, and its `members` live there and nowhere else.
 * So the binder does not write a channel's row at all: it runs
 * {@link INVENTORY_REGISTER_CHANNEL} inside that channel's own session and the
 * channel writes its own row from its own state. **The binder carries no member
 * data**, and that is the point rather than a detail. A roster's `members:` is
 * what a file said when it was last read; an edit to it does not reach a
 * channel that is already open, so a binder copying it forward would publish a
 * file-time answer under a live name. What the row buys is that the two
 * disagreeing becomes *visible* instead of silent.
 *
 * **Nothing is ever deleted.** A row means *was registered in this org*, not
 * *still declared*. A roster handed to one boot may be a partial one, and a
 * binder that reconciled against it would drop the row of a live channel
 * another process opened. A reader tolerates a row naming something it cannot
 * reach; there is no undoing a row that should not have been removed.
 */

import { kindOf, orderedById } from "../channel/channel-binder";
import {
  INVENTORY_REGISTER_CHANNEL,
  INVENTORY_REGISTER_SEATS
} from "../channel/channel-flow";
import type { ChannelManifest } from "../manifest";

/**
 * One registered seat, as the binder needs it.
 *
 * Structurally typed, and satisfied by `hireWorkforce`'s own return value: a
 * hired seat is a flow copy carrying exactly these two fields. Typed this
 * loosely on purpose — what belongs in the inventory is the seats that
 * actually exist, and a manifest the hire step refused never became one.
 */
export interface InventorySeat {
  /** The seat's id, `"<teamId>.<name>"` — the id its row is keyed by. */
  id: string;
  /** The flow kind it was hired into. */
  kind: string;
}

/** What the binder registers: the seats that were hired, and the channels that were opened. */
export interface InventoryRoster {
  /** The registered seats. Pass `hireWorkforce(...)`'s result directly. */
  seats: readonly InventorySeat[];
  /** The channel records — the same ones `channelInstances` registered and `openChannels` opened. */
  channels: readonly ChannelManifest[];
}

/** One action the binder asks the app's door to run. */
export interface InventoryActionRequest {
  /** The action's name — one of the two pinned inventory action names. */
  action: string;
  /** The action's input. Empty for a channel registration. */
  input: unknown;
  /** The user every run is made as — the same one the channels were opened for. */
  userId: string;
  /** The org the rows are written in. Always present: the binder refuses without one. */
  orgId: string;
  /** The flow kind to run on: the channel's own kind, or the seat writer's. */
  flowKind: string;
  /** The session to run in: the channel's id for a channel, the seat writer's session otherwise. */
  sessionId: string;
  /**
   * `"internal"` for the seat write, absent for a channel registration.
   *
   * The seat-registration action lives only in the flow's `internal.actions`
   * map, not its public one (see `inventoryWriterActions` in
   * `channel-flow.ts`), because its whole input is caller-supplied row data
   * with nothing to validate it against. `run` must forward this straight
   * into `runAction`'s own `source` option — `runAction({ source:
   * request.source, ... })` — so the seat write resolves from `internal.actions`
   * instead of the public one. A door that drops this field on the floor
   * makes the seat write unreachable rather than insecure: `resolveEntry`
   * reads one map per dispatch type with no fallback, so a `run` that always
   * dispatches as `"http"` gets `no-entry` for the seat write, never a
   * public hit on it.
   */
  source?: string;
}

/** Where the seat rows are written. @see OpenInventoryOptions.seatWriter */
export interface InventorySeatWriter {
  /** A flow kind carrying {@link INVENTORY_REGISTER_SEATS}. */
  flowKind: string;
  /** The session to run the write in. Defaults to {@link INVENTORY_SEAT_WRITER_SESSION}. */
  sessionId?: string;
}

/**
 * The session the seat write runs in when the caller names none.
 *
 * An ordinary session on the writer's flow, created on the first boot and
 * reused after. It never collides with a channel: a channel's id is
 * `"<teamId>.<name>"` and always carries a dot.
 */
export const INVENTORY_SEAT_WRITER_SESSION = "inventory-binder";

export interface OpenInventoryOptions {
  /**
   * The action door — one call per open channel, plus one for the seats.
   *
   * Structurally typed and supplied by the app, for the same reason
   * `openChannels` takes its session client that way: this package depends on
   * no client package. It is a one-liner over whatever the app already uses to
   * run an action, and it has to be the app's because the shipped action client
   * is bound to one `flowKind` when it is created while channels may be
   * several:
   *
   * ```ts
   * const run = (req) =>
   *   createClient({ flowKind: req.flowKind, userId: req.userId })
   *     .sendAction(req.action, req.input, { sessionId: req.sessionId, orgId: req.orgId });
   * ```
   *
   * **It must reject when the action fails.** A door that hands back a failed
   * run as an ordinary value reports every channel registered and writes
   * nothing, and the binder has no other way to tell: an action's return value
   * arrives in whatever shape that door gives it, so the rejection is the only
   * signal this package can read.
   */
  run: (request: InventoryActionRequest) => Promise<unknown>;

  /**
   * Where the SEAT rows are written.
   *
   * A seat has no session of its own, and a collection can only be written from
   * inside a running flow — so the seat rows need a flow to run in, and the
   * binder cannot derive one. Every channel kind built with `inventory: true`
   * carries the writer, and so does any flow of the app's own that spreads
   * `inventoryWriterActions`. Naming it is one line, and it is the single thing
   * about this call that is not already decided by the roster.
   *
   * Required when the roster carries seats, and refused by name when it is
   * missing. A roster with no seats does not need one.
   */
  seatWriter?: InventorySeatWriter;

  /** The user every run is made as — the same one `openChannels` opened the channels for. */
  userId: string;

  /**
   * The org the rows are written in, and the same one the channels were opened
   * under.
   *
   * Optional in this type only because the boot options beside it are; a run
   * without one is refused. The inventory is org-scoped storage, so a write
   * with no org goes somewhere no flow in the app can read back — the failure
   * is an inventory that reads empty everywhere, which points at nothing.
   */
  orgId?: string;
}

/** What one boot wrote, and what it could not. */
export interface InventoryBinding {
  /** How many seat rows were written. */
  seats: number;
  /** How many channels registered themselves. */
  channels: number;
  /**
   * What failed, named, in roster order. Never thrown: one channel whose kind
   * cannot register is not an app with no inventory, and the caller decides
   * which of these is fatal.
   */
  problems: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fill the org's live inventory: one row per hired seat, and one per open
 * channel written by that channel itself.
 *
 * Run it after `openChannels` — a channel that is not open yet has no session
 * to register in, and the failure is named rather than silent. The seat half
 * does not care about the order.
 *
 * Re-running over an unchanged roster is a no-op: every write is an upsert
 * keyed by the record's own id, so nothing duplicates and nothing appends. A
 * channel that has been open since an earlier boot keeps its original
 * `openedAt`.
 *
 * @param roster  The hired seats and the opened channel records.
 * @param options `run`: the action door. `seatWriter`: the flow the seat rows
 *   are written through. `userId` / `orgId`: who and where.
 * @returns What was written, and one named entry per failure. Nothing is
 *   retried.
 * @throws If no `orgId` was given, or if the roster carries seats and no
 *   `seatWriter` was named. Both are wiring mistakes an app should not boot
 *   past — a run that continued would report success and write where nobody
 *   can read.
 */
export async function openInventory(
  roster: InventoryRoster,
  options: OpenInventoryOptions
): Promise<InventoryBinding> {
  const seats = orderedById(roster.seats);
  const channels = orderedById(roster.channels);

  // Refused here rather than left to surface per row, and for the same reason
  // `openChannels` refuses an org-less roster that declares boards: an
  // org-scoped write with no org lands where no flow in this app resolves it,
  // so every read comes back empty and points at the reader.
  const orgId = options.orgId;
  if (orgId === undefined) {
    throw new Error(
      `openInventory was given no \`orgId\`, but the inventory is org-scoped storage: ` +
        `${seats.length} seat${seats.length === 1 ? "" : "s"} and ${channels.length} ` +
        `channel${channels.length === 1 ? "" : "s"} would be written where no flow can read ` +
        `them back. Pass the same \`orgId\` you passed \`openChannels\`.`
    );
  }

  if (seats.length > 0 && options.seatWriter === undefined) {
    throw new Error(
      `openInventory was given ${seats.length} seat${seats.length === 1 ? "" : "s"} and no ` +
        `\`seatWriter\`. A seat has no session, so its row has to be written from inside some ` +
        `flow, and there is nothing in the roster that says which. Pass ` +
        `\`seatWriter: { flowKind }\` naming a kind that carries the inventory writer — the ` +
        `channel kind does when \`channelInstances\` was called with \`inventory: true\`.`
    );
  }

  const problems: string[] = [];
  let seatsWritten = 0;

  if (seats.length > 0) {
    const writer = options.seatWriter!;
    try {
      await options.run({
        action: INVENTORY_REGISTER_SEATS,
        // Id and kind only. A seat's row is the whole of what the inventory
        // knows about it, and everything else on a record is the declared
        // layer's to answer.
        input: { seats: seats.map((seat) => ({ id: seat.id, kind: seat.kind })) },
        userId: options.userId,
        orgId,
        flowKind: writer.flowKind,
        sessionId: writer.sessionId ?? INVENTORY_SEAT_WRITER_SESSION,
        // The seat writer lives in `internal.actions` only — see
        // `InventoryActionRequest.source`.
        source: "internal"
      });
      seatsWritten = seats.length;
    } catch (error) {
      // Collected, not thrown: an app whose channels all registered is not an
      // app with no inventory, and the caller is the one that knows whether a
      // seatless inventory is worth refusing to boot over.
      problems.push(`the seat rows could not be written — ${messageOf(error)}`);
    }
  }

  let channelsWritten = 0;
  for (const manifest of channels) {
    const selected = kindOf(manifest.declared);
    if ("problem" in selected) {
      problems.push(`channel "${manifest.id}" — ${selected.problem}`);
      continue;
    }

    try {
      await options.run({
        action: INVENTORY_REGISTER_CHANNEL,
        // Empty, and that is the contract rather than an omission: the channel
        // reads its members out of its own session state, so there is nothing
        // for the binder to supply and nothing it could supply that would not
        // be the file's answer wearing the live one's name.
        input: {},
        userId: options.userId,
        orgId,
        flowKind: selected.kind,
        sessionId: manifest.id
      });
      channelsWritten += 1;
    } catch (error) {
      // The walk continues. The two ways to land here are a channel that is
      // not open (so there is no membership to publish) and a kind that does
      // not declare the registration action at all — a hand-rolled one that
      // did not carry it. Both are named; neither is a channel quietly absent
      // from the inventory.
      problems.push(
        `channel "${manifest.id}" could not register in the inventory — ${messageOf(error)}`
      );
    }
  }

  return { seats: seatsWritten, channels: channelsWritten, problems };
}
