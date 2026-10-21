/**
 * The inventory's org-scoped worker collection — what was registered in this
 * organization, as opposed to what the tree declares. A row means *was
 * registered*, not *is open now*.
 *
 * The declared layer answers "what did somebody write down": a folder of
 * `WORKER.md` files, read at boot. It cannot answer "which of these were
 * registered", because a file has no idea. These rows are that second answer.
 * The two layers join on one thing, the record's `id`, and nothing else — no
 * mapping table, no second identity.
 *
 *   inventory/workers/<workerId>                which workers were registered in this org
 *
 * This key is a public surface. Moving it is a breaking change for any app
 * whose rows are already persisted. Nothing here deletes a row for going
 * missing. The one removal is `fire`'s, of a hired worker's own row.
 *
 * ## The browser read
 *
 * The collection declares `client.state.read`, so the collection-state route
 * (`GET /sessions/:id/resources/:ref`) serves its rows to a browser instead
 * of refusing with `403 State read not permitted`. That is how the DevTool's
 * Inventory tab — and any app's own browser code — names the organization's
 * workers.
 *
 * What it opens is exactly the SESSION'S organization's rows and no other's.
 * The route resolves rows through the session's stored `orgId`, and a session
 * binds its org from the resolved principal when it is created — never from
 * the request body, query or headers. The axis is `scope`: an org-scoped row
 * is shared within its org by definition, so its own users reading it
 * reveals nothing they could not already be told. The roster beside
 * it carries the same read on the same terms, and
 * `cross-org-collection-read.test.ts` fails if another org's rows come back
 * for either.
 *
 * The read names its fields with `expose` rather than the identity default
 * (BP-015), so a key added to a row later stays server-side until someone adds
 * it to the list. A row means *was registered in this organization*, not *is
 * open now*: nothing deletes one for going missing, so a reader must label it
 * that way. Firing a hired worker removes its row; a row an earlier version's
 * fire left behind has no roster row, and `listedWorkerRows` is the join that
 * hides it.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/**
 * One registered worker: the thing a `WORKER.md` declared and `hireWorkforce`
 * turned into a flow copy.
 *
 * Closed on purpose, unlike the skills collection's passthrough schema — that
 * one holds heterogeneous entries (manifests beside plain supporting files) and
 * has to tolerate anything. These rows have one writer and one shape, so an
 * unknown key is a mistake rather than a payload, and Zod's default strip drops
 * it on the way in.
 *
 * `id` and `kind` are required rather than defaulted. A row that lost them is
 * not a thinner row, it is a row that cannot be joined, and a default of `""`
 * would hand a consumer something that looks structurally fine and matches
 * nothing. Required means the framework's read path surfaces such a row as
 * empty instead, which is visible.
 */
export const workerInventoryRowSchema = z.object({
  /** The worker's id — the same id the declared record carries. The join key. */
  id: z.string().min(1),
  /** The worker flow this worker was hired into, e.g. the built-in `"agent"`. */
  kind: z.string().min(1),
  /**
   * The worker's door: the one public action its worker flow declares that takes a
   * user's message (`userMessage`, `{ message }` input). `null` when the
   * flow has none, or declares two (a hire problem). Defaulted so a row
   * written before doors were published reads as no door (BP-030); the next
   * boot rewrites it.
   */
  door: z.string().nullable().default(null),
  /**
   * The worker's display name (its `WORKER.md` `name:`), for people only; ids
   * stay the wiring. `null` when it names none, and on a row written before
   * the field (BP-023, BP-030): a view shows the id instead.
   */
  name: z.string().nullable().default(null),
  /**
   * Its team's display name (the team's `TEAM.md` `name:`). `null` when the
   * team names none, on an org worker, and on a row written before the field.
   */
  teamName: z.string().nullable().default(null),
  /**
   * Whether the worker keeps standing rules: its worker flow declares the
   * standing rules action. Read off the flow's actions rather than its name, so
   * an app's own `agent` that leaves the action out says so. Defaulted so a row
   * written before the field reads as keeping none (BP-030); the next boot
   * rewrites it.
   */
  rules: z.boolean().default(false),
  /**
   * Where the worker came from: `true` for a worker hired at runtime (its id is
   * its address, `<org>.<workerId>`), `false` for a declared one. A team list
   * reads this rather than the id's shape, because a declared team can share
   * the organization's name. `null` on a row written before the field existed
   * (BP-023, BP-030), or by a caller that couldn't say; the next boot rewrites
   * a worker that is still registered.
   */
  hired: z.boolean().nullable().default(null),
  /**
   * The incarnation of the hire or repair that published this row (see
   * `roster/incarnation.ts`). Fire deletes a hired worker's row only when it
   * carries the incarnation fired (`null` only for a roster row from before
   * incarnations), so a worker hired again at the same address keeps its row,
   * and never deletes a declared worker's. `null` on a declared worker's row and
   * on a row written before the field (BP-023, BP-030).
   */
  incarnation: z.string().nullable().default(null),
});

/** One row of the worker inventory. @see workerInventoryRowSchema */
export type WorkerInventoryRow = z.infer<typeof workerInventoryRowSchema>;

/**
 * `flowIsolation: false`, spelled out here rather than omitted.
 *
 * The skills collection deliberately leaves it unset, so an app that isolates
 * its org state wholesale gets an isolated skills catalog too. That is right
 * for a catalog each flow may reasonably want its own copy of. It is wrong
 * here. An inventory read by only the flow that wrote it answers nothing: the
 * point of these rows is that a worker's flow and an app's own flow all see the
 * same ones.
 *
 * Left undefined, `effectiveStorageTuple` (`packages/core/src/flow/defineFlow.ts`)
 * promotes an org-scoped entry to isolated whenever the declaring flow sets
 * `isolateOrgState`. Every reader but the writer would then read empty, because
 * of an app-level flag set for an unrelated reason, with nothing at this layer
 * saying so. An explicit `false` short-circuits that promotion.
 */
const SHARED_ACROSS_FLOWS = false;

/**
 * The fields the collection's browser read publishes — every field its row
 * schema declares today, named rather than defaulted (BP-015). A key a later
 * change adds to a row stays server-side until it is added here too.
 */
const WORKER_INVENTORY_CLIENT_FIELDS = ["id", "kind", "door", "rules", "name", "teamName", "hired", "incarnation"] as const;

/**
 * The worker inventory — one row per registered worker, at `inventory/workers/*`.
 *
 * Install it under any block's `resources` map. Org-scoped: every flow in the
 * org reads the same rows, and a flow under a different `orgId` reads none.
 *
 * Takes no options. The prefix, the scope, the sharing and the browser read
 * (see the module header) are the contract other layers join against, not app
 * settings.
 *
 * @example
 *   resources: { workers: defineWorkerInventoryCollection() }
 */
export function defineWorkerInventoryCollection() {
  return defineResourceCollection({
    pattern: "inventory/workers/*",
    scope: "org",
    flowIsolation: SHARED_ACROSS_FLOWS,
    stateSchema: workerInventoryRowSchema,
    client: { state: { read: true }, expose: WORKER_INVENTORY_CLIENT_FIELDS },
  });
}
