/**
 * The person's roster beside the seat inventory: their own workers, read
 * through Workforce's client, joined to the inventory's rows so Roster and
 * the sidebar's TEAMS draw the same workers.
 *
 * A worker the person hired is theirs alone, so the organization's seat
 * inventory never names it. Workforce's `roster()` answers for the caller
 * only, and every surface that lists workers joins the inventory to it.
 */
import { useEffect, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import type { LoadedSnapshot } from "./derive";
import { describeFailure, STAFF_TEAM, type Failure, type Seat } from "./reads";
import { useLab } from "./lab-data";
import { useWorkforce } from "./workforce";

/** The roster read: its entries, its failure, or `undefined` until the first read lands. */
export type RosterRead = { entries: RosterEntry[] } | { failure: Failure } | undefined;

/**
 * The roster read in flight or landed for each Lab connection, and the
 * snapshot it was read for. Sidebar and Roster both draw the roster; sharing
 * one read per snapshot keeps them from racing two first reads, which could
 * each open the person's roster session.
 */
const reads = new WeakMap<object, { readAt: number; read: Promise<RosterEntry[]> }>();

/**
 * The person's roster, read through Workforce's client with every snapshot
 * (`readAt`): `undefined` until the first read lands, and not read until
 * there is a snapshot. Every caller on one connection shares one read per
 * snapshot.
 */
export function useRoster(readAt: number | undefined): RosterRead {
  const { clients } = useLab();
  const workforce = useWorkforce();
  const [read, setRead] = useState<RosterRead>(undefined);
  useEffect(() => {
    if (readAt === undefined) return;
    let held = reads.get(clients);
    if (held?.readAt !== readAt) {
      held = { readAt, read: workforce.roster() };
      reads.set(clients, held);
    }
    let closed = false;
    held.read
      .then((entries) => {
        if (!closed) setRead({ entries });
      })
      .catch((error: unknown) => {
        if (!closed) setRead({ failure: describeFailure(error) });
      });
    return () => {
      closed = true;
    };
  }, [clients, workforce, readAt]);
  return read;
}

/**
 * The person's own workers as rows beside the inventory's: each on the flow
 * it names, with that flow's door, grouped by its id the way an inventory
 * row is.
 */
function ownSeats(entries: readonly RosterEntry[], inventory: readonly Seat[]): Seat[] {
  return entries
    .filter((entry) => !entry.standard && !inventory.some((seat) => seat.id === entry.id))
    .map((entry) => {
      const dot = entry.id.indexOf(".");
      return {
        id: entry.id,
        kind: entry.flow,
        door: inventory.find((seat) => seat.kind === entry.flow)?.door ?? null,
        team: dot > 0 ? entry.id.slice(0, dot) : STAFF_TEAM,
        name: dot > 0 ? entry.id.slice(dot + 1) : entry.id,
      };
    });
}

/** A standard worker the roster lists and the inventory hasn't registered, as a row. */
function standardSeats(entries: readonly RosterEntry[], inventory: readonly Seat[]): Seat[] {
  return ownSeats(
    entries.filter((entry) => entry.standard).map((entry) => ({ ...entry, standard: false })),
    inventory,
  );
}

/**
 * The snapshot with the roster's workers in its inventory, the person's own
 * ones listed in `own`. With the inventory unread, the standard workers the
 * roster lists are still the person's, so they are added too.
 */
export function withRoster(snapshot: LoadedSnapshot, read: RosterRead): { snapshot: LoadedSnapshot; seats: Seat[]; own: Seat[] } {
  const entries = read !== undefined && "entries" in read ? read.entries : [];
  const inventorySeats = snapshot.inventory.ok ? snapshot.inventory.value.seats : [];
  const own = ownSeats(entries, inventorySeats);
  const extra = snapshot.inventory.ok ? own : [...standardSeats(entries, inventorySeats), ...own];
  const seats = [...inventorySeats, ...extra];
  return {
    snapshot: {
      ...snapshot,
      inventory: { ok: true, value: { ...(snapshot.inventory.ok ? snapshot.inventory.value : { workstreams: [] }), seats } },
    },
    seats,
    own,
  };
}
