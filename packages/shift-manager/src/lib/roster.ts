/**
 * The user's roster beside the worker inventory: their own workers, read
 * through Workforce's client, joined to the inventory's rows so Roster and
 * the sidebar's TEAMS draw the same workers.
 *
 * A worker the user hired is theirs alone, so the organization's worker
 * inventory never names it. Workforce's `roster()` answers for the caller
 * only, and every surface that lists workers joins the inventory to it.
 */
import { useEffect, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import type { LoadedSnapshot } from "./derive";
import { describeFailure, workerNames, type Failure, type Worker } from "./reads";
import { useLab } from "./lab-data";
import { useWorkforce } from "./workforce";

/** The roster read: its entries, its failure, or `undefined` until the first read lands. */
export type RosterRead = { entries: RosterEntry[] } | { failure: Failure } | undefined;

/**
 * The roster read in flight or landed for each Lab connection, and the
 * snapshot it was read for. Sidebar and Roster both draw the roster; sharing
 * one read per snapshot keeps them from racing two first reads, which could
 * each open the user's roster session.
 */
const reads = new WeakMap<object, { readAt: number; read: Promise<RosterEntry[]> }>();

/**
 * The user's roster, read through Workforce's client with every snapshot
 * (`readAt`): `undefined` until the first read lands, and not read until
 * there is a snapshot. Every caller on one connection shares one read per
 * snapshot.
 */
export function useRoster(readAt: number | undefined): RosterRead {
  const { client } = useLab();
  const workforce = useWorkforce();
  const [read, setRead] = useState<RosterRead>(undefined);
  useEffect(() => {
    if (readAt === undefined) return;
    let held = reads.get(client);
    if (held?.readAt !== readAt) {
      held = { readAt, read: workforce.roster() };
      reads.set(client, held);
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
  }, [client, workforce, readAt]);
  return read;
}

/**
 * The user's own workers as rows beside the inventory's: each on the flow
 * it names, with that flow's door and rules flag, grouped and named the way an inventory
 * row is.
 */
function ownWorkers(entries: readonly RosterEntry[], inventory: readonly Worker[]): Worker[] {
  return entries
    .filter((entry) => !entry.standard && !inventory.some((worker) => worker.id === entry.id))
    .map((entry) => ({
      id: entry.id,
      kind: entry.flow,
      door: inventory.find((worker) => worker.kind === entry.flow)?.door ?? null,
      rules: inventory.find((worker) => worker.kind === entry.flow)?.rules ?? false,
      ...workerNames(entry.id, entry.name, entry.teamName),
    }));
}

/** A standard worker the roster lists and the inventory hasn't registered, as a row. */
function standardWorkers(entries: readonly RosterEntry[], inventory: readonly Worker[]): Worker[] {
  return ownWorkers(
    entries.filter((entry) => entry.standard).map((entry) => ({ ...entry, standard: false })),
    inventory,
  );
}

/**
 * The snapshot with the roster's workers in its inventory, the user's own
 * ones listed in `own`. With the inventory unread, the standard workers the
 * roster lists are still the user's, so they are added too.
 */
export function withRoster(snapshot: LoadedSnapshot, read: RosterRead): { snapshot: LoadedSnapshot; workers: Worker[]; own: Worker[] } {
  const entries = read !== undefined && "entries" in read ? read.entries : [];
  const inventoryWorkers = snapshot.inventory.ok ? snapshot.inventory.value.workers : [];
  const own = ownWorkers(entries, inventoryWorkers);
  const extra = snapshot.inventory.ok ? own : [...standardWorkers(entries, inventoryWorkers), ...own];
  const workers = [...inventoryWorkers, ...extra];
  return {
    snapshot: {
      ...snapshot,
      inventory: { ok: true, value: { workers } },
    },
    workers,
    own,
  };
}
