/**
 * Hired workers joining an app's flows record, checked.
 *
 * A worker is registered under its own id, and an org worker's id is its bare
 * folder name. Spread into a flows record beside the app's own flows, a worker
 * whose id is already a flow's key would replace that flow, and the flow would
 * be gone from the server with nothing said. This merge refuses that instead.
 */

/**
 * Add `workers` to `flows` under their ids, refusing any collision.
 *
 * @param flows The app's own flows, by id (a mailbox kind, an app flow).
 * @param workers The hired workers, from `hireWorkforce`.
 * @returns A new record holding both; `flows` is not changed.
 * @throws If a worker's id is already a key of `flows`, or two workers share an id.
 *   The message names the id and says to rename the worker's folder.
 */
export function mergeWorkerFlows<F, S extends { id: string }>(
  flows: Record<string, F>,
  workers: readonly S[]
): Record<string, F | S> {
  const merged: Record<string, F | S> = { ...flows };
  const seen = new Set<string>();
  for (const worker of workers) {
    if (seen.has(worker.id)) {
      throw new Error(`The worker "${worker.id}" is declared more than once. Rename one of the workers' folders.`);
    }
    if (Object.hasOwn(flows, worker.id)) {
      throw new Error(
        `The worker "${worker.id}" can't be registered: its id is already the flow "${worker.id}". ` +
          `Rename the worker's folder.`
      );
    }
    seen.add(worker.id);
    merged[worker.id] = worker;
  }
  return merged;
}
