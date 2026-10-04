/**
 * `openInventory` — the boot binder that fills the live inventory.
 *
 * It runs after `openMailboxes` and writes nothing itself. Everything the
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
 * A **mailbox** has a session, and its `members` live there and nowhere else.
 * So the binder does not write a mailbox's row at all: it runs
 * {@link INVENTORY_REGISTER_MAILBOX} inside that mailbox's own session and the
 * mailbox writes its own row from its own state. **The binder carries no member
 * data**, and that is the point rather than a detail. A roster's `members:` is
 * what a file said when it was last read; an edit to it does not reach a
 * mailbox that is already open, so a binder copying it forward would publish a
 * file-time answer under a live name. What the row buys is that the two
 * disagreeing becomes *visible* instead of silent.
 *
 * **Nothing is deleted for being absent.** A row means *was registered in this
 * org*, not *still declared*. A roster handed to one boot may be a partial one,
 * and a binder that reconciled against it would drop the row of a live mailbox
 * another process opened. A reader tolerates a row naming something it cannot
 * reach; there is no undoing a row that should not have been removed.
 *
 * Each removal is positive evidence, not absence. A roster record marked
 * `mintFor:` is a project talk template, never a mailbox, so a mailbox row an
 * earlier boot wrote under its id is retired ({@link INVENTORY_RETIRE_MAILBOXES},
 * through the seat writer). And `fire` (`removeHiredSeat`) deletes the row of
 * the hired seat it removes, which it knows exactly.
 */

import { isTalkTemplate, kindOf, orderedById } from "../mailbox/mailbox-binder";
import {
  INVENTORY_REGISTER_MAILBOX,
  INVENTORY_REGISTER_SEATS,
  INVENTORY_RETIRE_MAILBOXES
} from "../mailbox/mailbox-flow";
import type { MailboxManifest } from "../manifest";
import { seatDoorOf } from "../seat-door";
import { incarnationOf } from "../roster/incarnation";

/**
 * One registered seat, as the binder needs it.
 *
 * Structurally typed, and satisfied by `hireWorkforce`'s own return value: a
 * hired seat is a flow copy carrying these three fields. Typed this
 * loosely on purpose — what belongs in the inventory is the seats that
 * actually exist, and a manifest the hire step refused never became one.
 */
export interface InventorySeat {
  /** The seat's id (`"<teamId>.<name>"`, or a bare `"<name>"` for an org seat) — the id its row is keyed by. */
  id: string;
  /** The flow kind it was hired into. */
  kind: string;
  /**
   * The seat's public actions, which its door is read from (see
   * `seat-door.ts`). A hired seat carries them. Required, so a caller that
   * builds `{ id, kind }` by hand can't register a seat as taking no message
   * by forgetting them: pass `{}` to say the seat has no door.
   */
  actions: Readonly<Record<string, unknown>>;
  /**
   * The seat's settings, which `hireWorkforce` stamps with its `seatId`. A
   * seat whose `seatId` differs from its `id` was hired at runtime (its id is
   * an address); one whose `seatId` is its `id` was declared. The row's
   * `hired` is read from this; omitted, the row says `null` (unknown).
   */
  config?: unknown;
}

/** `true` for a runtime hire, `false` for a declared seat, `null` when the seat doesn't say. */
function hiredOf(seat: InventorySeat): boolean | null {
  const seatId =
    typeof seat.config === "object" && seat.config !== null
      ? (seat.config as { readonly seatId?: unknown }).seatId
      : undefined;
  return typeof seatId === "string" ? seatId !== seat.id : null;
}

/** What the binder registers: the seats that were hired, and the mailboxes that were opened. */
export interface InventoryRoster {
  /** The registered seats. Pass `hireWorkforce(...)`'s result directly. */
  seats: readonly InventorySeat[];
  /** The mailbox records — the same ones `mailboxInstances` registered and `openMailboxes` opened. */
  mailboxes: readonly MailboxManifest[];
}

/** One action the binder asks the app's door to run. */
export interface InventoryActionRequest {
  /** The action's name — one of the two pinned inventory action names. */
  action: string;
  /** The action's input. Empty for a mailbox registration. */
  input: unknown;
  /** The user every run is made as — the same one the mailboxes were opened for. */
  userId: string;
  /** The org the rows are written in. Always present: the binder refuses without one. */
  orgId: string;
  /** The flow kind to run on: the mailbox's own kind, or the seat writer's. */
  flowKind: string;
  /** The session to run in: the mailbox's id for a mailbox, the seat writer's session otherwise. */
  sessionId: string;
  /**
   * `"internal"` for the seat write, absent for a mailbox registration.
   *
   * The seat-registration action lives only in the flow's `internal.actions`
   * map, not its public one (see `inventoryWriterActions` in
   * `mailbox-flow.ts`), because its whole input is caller-supplied row data
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
 * reused after. It never collides with a mailbox: a mailbox's id is
 * `"<teamId>.<name>"` and always carries a dot.
 */
export const INVENTORY_SEAT_WRITER_SESSION = "inventory-binder";

export interface OpenInventoryOptions {
  /**
   * The action door — one call per open mailbox, plus one for the seats.
   *
   * Structurally typed and supplied by the app, for the same reason
   * `openMailboxes` takes its session client that way: this package depends on
   * no client package. It is a one-liner over whatever the app already uses to
   * run an action, and it has to be the app's because the shipped action client
   * is bound to one `flowKind` when it is created while mailboxes may be
   * several:
   *
   * ```ts
   * const run = (req) =>
   *   createClient({ flowKind: req.flowKind, userId: req.userId })
   *     .sendAction(req.action, req.input, { sessionId: req.sessionId, orgId: req.orgId });
   * ```
   *
   * **It must reject when the action fails.** A door that hands back a failed
   * run as an ordinary value reports every mailbox registered and writes
   * nothing, and the binder has no other way to tell: an action's return value
   * arrives in whatever shape that door gives it, so the rejection is the only
   * signal this package can read.
   *
   * Return the action's output, or a run result carrying it as `output`
   * (`runAction`'s shape), and `InventoryBinding.seats` counts the seat rows
   * that actually landed; any other return counts the rows sent.
   */
  run: (request: InventoryActionRequest) => Promise<unknown>;

  /**
   * Where the SEAT rows are written.
   *
   * A seat has no session of its own, and a collection can only be written from
   * inside a running flow — so the seat rows need a flow to run in, and the
   * binder cannot derive one. Every mailbox kind built with `inventory: true`
   * carries the writer, and so does any flow of the app's own that spreads
   * `inventoryWriterActions`. Naming it is one line, and it is the single thing
   * about this call that is not already decided by the roster.
   *
   * Required when the roster carries seats, and refused by name when it is
   * missing. A roster with no seats does not need one. A roster carrying talk
   * templates uses it too, to retire their old mailbox rows; without one that
   * is named in `problems`.
   */
  seatWriter?: InventorySeatWriter;

  /** The user every run is made as — the same one `openMailboxes` opened the mailboxes for. */
  userId: string;

  /**
   * The org the rows are written in, and the same one the mailboxes were opened
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
  /**
   * How many seat rows were written. A row the boot may no longer write — the
   * store already holds a newer hire's row at that address — is left and not
   * counted. The count is the seat action's own, read from what `run`
   * returns: the action's output, or a run result carrying it as `output`.
   * A door whose return carries neither (an HTTP action client returns no
   * output) gets the number of rows sent instead.
   */
  seats: number;
  /** How many mailboxes registered themselves. */
  mailboxes: number;
  /**
   * What failed, named, in roster order. Never thrown: one mailbox whose kind
   * cannot register is not an app with no inventory, and the caller decides
   * which of these is fatal.
   */
  problems: string[];
}

/**
 * The seat action's `written` count from what the door returned: the action's
 * output itself, or a run result carrying it as `output` (what `runAction`
 * returns). `undefined` when the return carries neither.
 */
function writtenOf(ran: unknown): number | undefined {
  const read = (value: unknown) => {
    const written = (value as { written?: unknown } | null | undefined)?.written;
    return typeof written === "number" ? written : undefined;
  };
  return read(ran) ?? read((ran as { output?: unknown } | null | undefined)?.output);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fill the org's live inventory: one row per hired seat, and one per open
 * mailbox written by that mailbox itself.
 *
 * Run it after `openMailboxes` — a mailbox that is not open yet has no session
 * to register in, and the failure is named rather than silent. The seat half
 * does not care about the order.
 *
 * Re-running over an unchanged roster is a no-op: every write is keyed by the
 * record's own id, so nothing duplicates and nothing appends. A mailbox that
 * has been open since an earlier boot keeps its original `openedAt`. A seat
 * row is written only where the boot may still write it (no row when read, or
 * a stored row of the same seat), so a boot whose roster is older than the
 * store never replaces a runtime hire's row.
 *
 * @param roster  The hired seats and the opened mailbox records.
 * @param options `run`: the action door. `seatWriter`: the flow the seat rows
 *   are written through. `userId` / `orgId`: who and where.
 * @returns What was written, and one named entry per failure. Nothing is
 *   retried.
 * @throws If no `orgId` was given, or if the roster carries seats and no
 *   `seatWriter` was named. Both are wiring mistakes an app should not boot
 *   past — a run that continued would report success and write where nobody
 *   can read. An app with no authentication passes `DEFAULT_ORG_ID`
 *   explicitly; it is the absent value, not that one, that is refused.
 */
export async function openInventory(
  roster: InventoryRoster,
  options: OpenInventoryOptions
): Promise<InventoryBinding> {
  const seats = orderedById(roster.seats);
  // A project talk template (`mintFor:`) is never opened, so it has no session
  // to register from, and the Lab's mailbox list stays its declared mailboxes.
  const mailboxes = orderedById(roster.mailboxes.filter((manifest) => !isTalkTemplate(manifest)));
  const templates = orderedById(roster.mailboxes.filter(isTalkTemplate));

  // `openInventory` writes through trusted direct execution, below any
  // resolver, so it names the organization itself (BR-4) — an ABSENT one is
  // refused rather than guessed. The inventory is org-scoped storage: an app
  // that authenticates and forgets to pass its verified organization would
  // write its entire inventory into a namespace none of its sessions read
  // back, and the only symptom is an inventory that reads empty everywhere,
  // which points at nothing.
  //
  // Naming `DEFAULT_ORG_ID` explicitly is a different thing and goes through
  // (D3): a development app with no resolver has its mailbox sessions bound to
  // the framework default, and saying so here is how its rows land where those
  // sessions read them. The refusal is about the caller who said nothing.
  const orgId = options.orgId;
  if (orgId === undefined) {
    throw new Error(
      `openInventory was given no \`orgId\`. The inventory is org-scoped storage, so a write ` +
        `with no organization lands where no flow in the app can read it back. Pass the same ` +
        `organization the mailbox sessions are opened under — the verified one if the app ` +
        `authenticates, or \`DEFAULT_ORG_ID\` from \`@flow-state-dev/core\` if it does not.`
    );
  }

  if (seats.length > 0 && options.seatWriter === undefined) {
    throw new Error(
      `openInventory was given ${seats.length} seat${seats.length === 1 ? "" : "s"} and no ` +
        `\`seatWriter\`. A seat has no session, so its row has to be written from inside some ` +
        `flow, and there is nothing in the roster that says which. Pass ` +
        `\`seatWriter: { flowKind }\` naming a kind that carries the inventory writer — the ` +
        `mailbox kind does when \`mailboxInstances\` was called with \`inventory: true\`.`
    );
  }

  const problems: string[] = [];
  let seatsWritten = 0;

  if (seats.length > 0) {
    const writer = options.seatWriter!;
    try {
      const ran = await options.run({
        action: INVENTORY_REGISTER_SEATS,
        // Id, kind, door, origin and incarnation only. A seat's row is the whole of what the
        // inventory knows about it, and everything else on a record is the
        // declared layer's to answer.
        input: {
          seats: seats.map((seat) => ({
            id: seat.id,
            kind: seat.kind,
            door: seatDoorOf(seat).door,
            hired: hiredOf(seat),
            incarnation: incarnationOf(seat) ?? null,
          })),
        },
        userId: options.userId,
        orgId,
        flowKind: writer.flowKind,
        sessionId: writer.sessionId ?? INVENTORY_SEAT_WRITER_SESSION,
        // The seat writer lives in `internal.actions` only — see
        // `InventoryActionRequest.source`.
        source: "internal"
      });
      // The action skips a row the boot may no longer write (a newer hire's),
      // so its own count is the one reported, when the door hands it back.
      seatsWritten = writtenOf(ran) ?? seats.length;
    } catch (error) {
      // Collected, not thrown: an app whose mailboxes all registered is not an
      // app with no inventory, and the caller is the one that knows whether a
      // seatless inventory is worth refusing to boot over.
      problems.push(`the seat rows could not be written — ${messageOf(error)}`);
    }
  }

  // A record that was a mailbox at an earlier boot and is a template now: its
  // old mailbox row would keep advertising it as an addressable mailbox.
  if (templates.length > 0) {
    const ids = templates.map((manifest) => manifest.id);
    if (options.seatWriter === undefined) {
      problems.push(
        `the talk templates ${ids.map((id) => `"${id}"`).join(", ")} could not be retired from the ` +
          `mailbox inventory — no \`seatWriter\` was named to run the removal in`
      );
    } else {
      try {
        await options.run({
          action: INVENTORY_RETIRE_MAILBOXES,
          input: { ids },
          userId: options.userId,
          orgId,
          flowKind: options.seatWriter.flowKind,
          sessionId: options.seatWriter.sessionId ?? INVENTORY_SEAT_WRITER_SESSION,
          source: "internal"
        });
      } catch (error) {
        problems.push(`the talk templates' old mailbox rows could not be retired — ${messageOf(error)}`);
      }
    }
  }

  let mailboxesWritten = 0;
  for (const manifest of mailboxes) {
    const selected = kindOf(manifest.declared);
    if ("problem" in selected) {
      problems.push(`mailbox "${manifest.id}" — ${selected.problem}`);
      continue;
    }

    try {
      await options.run({
        action: INVENTORY_REGISTER_MAILBOX,
        // Empty, and that is the contract rather than an omission: the mailbox
        // reads its members out of its own session state, so there is nothing
        // for the binder to supply and nothing it could supply that would not
        // be the file's answer wearing the live one's name.
        input: {},
        userId: options.userId,
        orgId,
        flowKind: selected.kind,
        sessionId: manifest.id
      });
      mailboxesWritten += 1;
    } catch (error) {
      // The walk continues. The two ways to land here are a mailbox that is
      // not open (so there is no membership to publish) and a kind that does
      // not declare the registration action at all — a hand-rolled one that
      // did not carry it. Both are named; neither is a mailbox quietly absent
      // from the inventory.
      problems.push(
        `mailbox "${manifest.id}" could not register in the inventory — ${messageOf(error)}`
      );
    }
  }

  return { seats: seatsWritten, mailboxes: mailboxesWritten, problems };
}
