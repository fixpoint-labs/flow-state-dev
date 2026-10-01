/**
 * Control `static-names`: Shift Manager with its seat list written in rather than
 * read from the Lab.
 *
 * Built into the control page in place of `src/lib/reads.ts`. Everything is
 * the real module except `createLabReader`, whose snapshot has its seats
 * replaced by one Lab's seat list fixed at build time (`__STATIC_SEATS__`,
 * the DevForce tree's seats). Opened over DevForce it looks right; opened over
 * any other Lab, TEAMS lists seats that Lab doesn't have. The goal must fail
 * at "TEAMS equals the store's seats", naming the missing seats.
 */
import { createLabReader as readerAsWritten, toSeat, type LabReader, type Seat } from "../../../../labs/shift-manager/src/lib/reads.ts";

export * from "../../../../labs/shift-manager/src/lib/reads.ts";

declare const __STATIC_SEATS__: Array<{ id: string; kind: string }>;

/** The real reader, with the seat list swapped for the one written in. */
export function createLabReader(clients: Parameters<typeof readerAsWritten>[0]): LabReader {
  const reader = readerAsWritten(clients);
  const seats = __STATIC_SEATS__.map((row) => toSeat(row)).filter((s): s is Seat => s !== undefined);
  return {
    ...reader,
    read: async () => {
      const snapshot = await reader.read();
      if (snapshot.refused !== undefined || !snapshot.inventory.ok) return snapshot;
      return { ...snapshot, inventory: { ok: true, value: { ...snapshot.inventory.value, seats } } };
    },
  };
}
