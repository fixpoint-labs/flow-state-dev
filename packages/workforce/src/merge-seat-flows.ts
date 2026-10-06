/**
 * Hired seats joining an app's flows record, checked.
 *
 * A seat is registered under its own id, and an org seat's id is its bare
 * folder name. Spread into a flows record beside the app's own flows, a seat
 * whose id is already a flow's key would replace that flow, and the flow would
 * be gone from the server with nothing said. This merge refuses that instead.
 */

/**
 * Add `seats` to `flows` under their ids, refusing any collision.
 *
 * @param flows The app's own flows, by id (a mailbox kind, an app flow).
 * @param seats The hired seats, from `hireWorkforce`.
 * @returns A new record holding both; `flows` is not changed.
 * @throws If a seat's id is already a key of `flows`, or two seats share an id.
 *   The message names the id and says to rename the worker's folder.
 */
export function mergeSeatFlows<F, S extends { id: string }>(
  flows: Record<string, F>,
  seats: readonly S[]
): Record<string, F | S> {
  const merged: Record<string, F | S> = { ...flows };
  const seen = new Set<string>();
  for (const seat of seats) {
    if (seen.has(seat.id)) {
      throw new Error(`The seat "${seat.id}" is declared more than once. Rename one of the workers' folders.`);
    }
    if (Object.hasOwn(flows, seat.id)) {
      throw new Error(
        `The seat "${seat.id}" can't be registered: its id is already the flow "${seat.id}". ` +
          `Rename the worker's folder.`
      );
    }
    seen.add(seat.id);
    merged[seat.id] = seat;
  }
  return merged;
}
