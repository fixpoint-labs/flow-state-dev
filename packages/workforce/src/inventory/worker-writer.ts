/**
 * The worker inventory's writer: the one action `openInventory` dispatches to
 * write the org's worker rows, built for a flow to install.
 *
 * A worker has no session of its own, and a resource collection can only be
 * written from inside a running flow, so the rows are written by an action on
 * some flow the app names (`OpenInventoryOptions.workerWriter`). This module is
 * that action.
 */

import { handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { defineWorkerInventoryCollection, workerInventoryRowSchema } from "./collections";
import type { WorkerInventoryRow } from "./collections";

/**
 * The action the boot binder dispatches ONCE, carrying the roster's workers.
 *
 * **Pinned**: `openInventory` names this string. One run for the whole roster
 * rather than one per worker: a worker holds no session, so there is no per-worker
 * place this has to land, and the rows are a straight copy of what the binder
 * already holds.
 *
 * Lives in `internal.actions`, never the public map — its whole input is the
 * row data, with nothing to check it against. Reachable only by the binder's
 * own direct, trusted `runAction({ source: "internal", ... })` call.
 */
export const INVENTORY_REGISTER_WORKERS = "registerWorkersInInventory";

/** The roster's workers, as the binder holds them. */
const registerWorkersInputSchema = z
  .object({ workers: z.array(workerInventoryRowSchema) })
  .strict();

/** What the worker write reports: how many rows landed. */
export const inventoryWorkersRegisteredSchema = z.object({ written: z.number() });

/**
 * Write one worker row from a boot. A worker's row is its standard worker's, the
 * same on every process, so a later boot's write replaces an earlier one's.
 */
async function publishBootWorkerRow(workers: ResourceCollectionRef, row: WorkerInventoryRow): Promise<void> {
  await workers.upsert(row.id, row);
}

/**
 * The block that writes the worker rows, keyed by its action name.
 *
 * It refuses an org-less request by name. The inventory is org-scoped storage,
 * so without an org there is nothing to write in — and the resource registry
 * would report the collection as unregistered, which sends a reader to check a
 * registration that is fine.
 *
 * @returns The entry, keyed by {@link INVENTORY_REGISTER_WORKERS}. The block
 *   declares the collection it writes, so installing the entry installs the
 *   collection too. **Spread it into `internal.actions`, never `actions`**: its
 *   whole input is caller-supplied row data with nothing to check it against,
 *   so a public caller could write fabricated worker rows.
 *
 * @example
 *   defineFlow({
 *     kind: "inventory-writer",
 *     internal: { actions: { ...inventoryWriterActions() } }
 *   });
 */
export function inventoryWriterActions() {
  // Fresh per call. Two collections declared from one factory share storage —
  // a collection is addressed by its pattern and scope, never by object
  // identity — so this costs nothing and keeps the declaration local to the
  // flow that installs it.
  const workers = defineWorkerInventoryCollection();

  const registerWorkers = handler({
    name: "inventory-register-workers",
    inputSchema: registerWorkersInputSchema,
    outputSchema: inventoryWorkersRegisteredSchema,
    resources: { workers },
    execute: async (input, ctx) => {
      if (ctx.org === undefined) {
        throw new Error(
          "the worker rows cannot be written: this request carries no organization, and the " +
            "inventory is org-scoped storage. Run the worker write under the app's `orgId`."
        );
      }

      const problems: string[] = [];
      let written = 0;
      for (const row of input.workers) {
        try {
          await publishBootWorkerRow(ctx.resources.workers, row);
          written += 1;
        } catch (error) {
          problems.push(
            `worker "${row.id}" — ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Every row is attempted before anything is reported: one worker the store
      // refuses is not an org with no worker inventory. The throw is what carries
      // the failure back out — a boot door hands back an action's return value
      // in a shape this package cannot read, so a `problems` field on the
      // output would reach nobody.
      if (problems.length > 0) {
        throw new Error(
          `${problems.length} of ${input.workers.length} worker rows could not be written:\n  - ` +
            problems.join("\n  - ")
        );
      }
      return { written };
    }
  });

  return {
    [INVENTORY_REGISTER_WORKERS]: {
      block: registerWorkers,
      description:
        "Write the org's worker rows into the live inventory. Boot machinery, called once by " +
        "`openInventory` with the roster it was hired from."
    }
  };
}
