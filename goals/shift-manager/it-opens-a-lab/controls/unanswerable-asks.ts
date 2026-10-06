/**
 * Control `unanswerable-asks`: Shift Manager marks every ask unanswerable.
 *
 * Built into the control page in place of `src/lib/reads.ts`. Everything is
 * the real module except `createLabReader`, whose snapshot marks each pending
 * ask as one Shift Manager can't answer, so no card offers Approve. The goal must
 * fail at "an answer from Inbox lands in the store" on a Lab holding an ask.
 */
import {
  createLabReader as readerAsWritten,
  DISPATCHED_RUN_UNANSWERABLE,
  type LabReader,
} from "../../../../packages/shift-manager/src/lib/reads.ts";

export * from "../../../../packages/shift-manager/src/lib/reads.ts";

/** The real reader, with every ask marked unanswerable. */
export function createLabReader(clients: Parameters<typeof readerAsWritten>[0]): LabReader {
  const reader = readerAsWritten(clients);
  return {
    ...reader,
    read: async () => {
      const snapshot = await reader.read();
      if (snapshot.refused !== undefined || !snapshot.asks.ok) return snapshot;
      const asks = snapshot.asks.value.map((ask) => ({ ...ask, unanswerable: DISPATCHED_RUN_UNANSWERABLE }));
      return { ...snapshot, asks: { ok: true, value: asks } };
    },
  };
}
