/**
 * Control `static-names`: Shift Manager with its seat list written in rather than
 * read from the Lab.
 *
 * Built into the control page in place of `src/lib/directory-reads.ts`.
 * Everything is the real module except `useDirectoryReads`, whose inventory
 * rows are replaced by one Lab's seat list fixed at build time
 * (`__STATIC_SEATS__`, the DevTeam tree's seats). Opened over DevTeam it looks
 * right; opened over any other Lab, TEAMS lists seats that Lab doesn't have.
 * The goal must fail at "TEAMS equals the store's seats", naming the missing
 * seats.
 *
 * Only the names are written in. A written-in seat the store also holds keeps
 * that stored row's `door`, the action that takes a person's message, so the
 * control removes the tree reading and nothing else: a composer turn to a
 * seat that exists still goes through.
 */
import { useMemo } from "react";
import { useDirectoryReads as readsAsWritten, type DirectoryReads } from "../../../../packages/shift-manager/src/lib/directory-reads.ts";
import { toWorker, type Worker } from "../../../../packages/shift-manager/src/lib/workers.ts";

export * from "../../../../packages/shift-manager/src/lib/directory-reads.ts";

declare const __STATIC_SEATS__: Array<{ id: string; kind: string }>;

/** The real reads, with the inventory's seats swapped for the ones written in. */
export function useDirectoryReads(): DirectoryReads {
  const reads = readsAsWritten();
  const stored = reads.inventory.values;
  const rows = useMemo(() => {
    if (stored === undefined) return undefined;
    const doors = new Map(stored.map((seat) => [seat.id, seat]));
    return __STATIC_SEATS__.map((row) => toWorker({ ...row, door: doors.get(row.id)?.door ?? null })).filter((s): s is Worker => s !== undefined);
  }, [stored]);
  const inventory = useMemo(() => ({ ...reads.inventory, values: rows }), [reads.inventory, rows]);
  return { ...reads, inventory };
}
