/**
 * The user's roster beside the worker inventory: their own workers, read
 * through Workforce's client, joined to the inventory's rows so Roster and
 * the sidebar's TEAMS draw the same workers. The roster is followed, not
 * read once: a hire shows on every surface that draws it.
 *
 * A worker the user hired is theirs alone, so the organization's worker
 * inventory never names it. Workforce's roster answers for the caller only,
 * and every surface that lists workers joins the inventory to it.
 */
import { useEffect, useRef, useState } from "react";
import type { RosterEntry, WorkforceClient } from "@flow-state-dev/workforce/browser";
import type { LoadedSnapshot } from "./derive";
import { describeFailure, workerNames, type Failure, type Worker } from "./reads";
import { useLab } from "./lab-data";
import { useWorkforce } from "./workforce";

/** The roster read: its entries, its failure, or `undefined` until the first read lands. */
export type RosterRead = { entries: RosterEntry[] } | { failure: Failure } | undefined;

/** One roster watch, the last read it reported, and the views drawing it. */
type SharedWatch = { read: RosterRead; views: Set<(read: RosterRead) => void>; stop: () => void };

/**
 * The roster watch for each Lab connection. Roster, the sidebar's TEAMS, a
 * project's lead picker, worker settings and DELEGATES all draw the roster;
 * sharing one watch keeps them on the same roster, and keeps them from
 * racing two first reads.
 * The last view to go stops it.
 */
const watches = new WeakMap<object, SharedWatch>();

function joinWatch(client: object, workforce: WorkforceClient, view: (read: RosterRead) => void): () => void {
  let shared = watches.get(client);
  if (shared === undefined) {
    const created: SharedWatch = { read: undefined, views: new Set(), stop: () => {} };
    const tell = (read: RosterRead) => {
      created.read = read;
      for (const each of [...created.views]) each(read);
    };
    created.stop = workforce.watchRoster((entries) => tell({ entries }), {
      // A failed re-read keeps the roster already drawn; the next read that lands replaces it.
      onError: (error) => {
        if (created.read === undefined || "failure" in created.read) tell({ failure: describeFailure(error) });
      },
    });
    watches.set(client, created);
    shared = created;
  }
  const held = shared;
  held.views.add(view);
  view(held.read);
  return () => {
    held.views.delete(view);
    if (held.views.size > 0) return;
    held.stop();
    if (watches.get(client) === held) watches.delete(client);
  };
}

/**
 * The user's roster, followed through Workforce's client (`watchRoster`): a
 * hire, fork, edit or fire, from any tab or by any worker's turn, redraws
 * it. `undefined` until the first read lands. Every caller on one connection
 * shares one watch.
 */
export function useRoster(): RosterRead {
  const { client } = useLab();
  const workforce = useWorkforce();
  // The connection decides the watch; its workforce client is the one built over it.
  const workforceRef = useRef(workforce);
  workforceRef.current = workforce;
  const [read, setRead] = useState<RosterRead>(() => watches.get(client)?.read);
  useEffect(() => joinWatch(client, workforceRef.current, setRead), [client]);
  return read;
}

/**
 * The user's own workers as rows beside the inventory's: each on the flow
 * it names, with that flow's door and its rules and task flags, grouped and named the way an inventory
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
      doorTakesTask: inventory.find((worker) => worker.kind === entry.flow)?.doorTakesTask ?? false,
      ...workerNames(entry.id, entry.name, entry.teamName),
      ...harnessOf(entry),
    }));
}

/** The harness a roster entry's settings name, as a {@link Worker} field; nothing when it names none. */
function harnessOf(entry: RosterEntry | undefined): Pick<Worker, "harness"> {
  const harness = entry?.settings?.harness;
  return typeof harness === "string" ? { harness } : {};
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
  // A declared worker's harness rides on its roster entry, not on its inventory row.
  const inventoryWorkers = (snapshot.inventory.ok ? snapshot.inventory.value.workers : []).map((worker) => ({
    ...worker,
    ...harnessOf(entries.find((entry) => entry.id === worker.id)),
  }));
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
