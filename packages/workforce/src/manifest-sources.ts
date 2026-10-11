/**
 * The workers manifest source (FIX-817) — the workforce's projection into the
 * discovery door.
 *
 * ## Two layers, joined, because neither one alone is an honest answer
 *
 * The **declared** layer (a tree of `WORKER.md` files) is the only place a
 * *purpose* is written: a worker's `description:` is what an orchestrator picks
 * on. It cannot say what is live — a file has no idea whether its worker was
 * ever registered.
 *
 * The **live** layer (FIX-1405's `inventory/workers/*`) knows what actually got
 * registered in this org. It cannot say what anything is for: a row carries an
 * id, a worker flow and a door. And it is
 * **append-only** — `open-inventory.ts` is explicit that "a row means *was
 * registered in this org*, not *still declared*", and nothing reconciles or
 * deletes a row for going missing. So a row on its own cannot mean *open*.
 *
 * An entry is therefore projected only where BOTH layers answer. That is the
 * liveness filter (BR-12a) and it is also what makes a well-formed entry
 * possible at all: a row with no declaration behind it has no purpose line, and
 * an entry whose purpose reads "unknown" is exactly the entry an orchestrator
 * must not plan against. An orchestrator is never handed a worker whose file
 * was removed — the row alone no longer qualifies.
 *
 * The direction of the error is deliberate. A partial roster (one boot's view
 * of a tree another process also writes to) under-reports rather than
 * over-reports, and a missing worker costs a planner one `discover` call while a
 * phantom one costs it the task.
 *
 * ## Where the declared half is read
 *
 * From BOOT state, handed in once — the file tree — plus, when the app names
 * the roster key, from that collection at call time. A runtime hire has
 * no file; its roster row is the declared half so Discover can see it
 * (FIX-1526). `readDeclaredRoster` is a synchronous filesystem tree walk, and
 * this runs behind a tool a model may call on every step — so the file tree is
 * resolved where the app already resolves it and passed here as data. That is
 * also why this module is node-free and lives at the package root rather than
 * behind `./loader`.
 *
 * Neither reader is modified. The inventory's storage keys and row schemas are
 * a public surface with persisted data behind them; these sources read them and
 * write nothing. The roster is the same: this module reads it.
 */

import type { BlockManifestSource, ManifestEntry } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { resolveResourceCollection } from "@flow-state-dev/orchestration";
import type { WorkerManifest } from "./manifest";
import type { WorkerInventoryRow } from "./inventory/collections";

/**
 * The declared half, as the sources need it — a structural subset of
 * `DeclaredRoster`, so `readDeclaredRoster(...)`'s result satisfies it
 * directly.
 *
 * Typed this loosely on purpose: a hand-built roster is as valid a declaration
 * as a walked tree, and requiring the loader's exact return would drag a
 * node-only type into a node-free module.
 */
export interface DeclaredWorkforce {
  /** One record per declared worker. */
  workers: readonly WorkerManifest[];
}

/**
 * Which resource-registry key the live worker inventory is mounted under, on
 * the block that carries the door.
 *
 * A key is how a source finds its collection at call time; with the key
 * omitted the door registers no source at all and carries one domain fewer,
 * which reads as "nothing here" rather than as a fault.
 */
export interface InventoryKeys {
  /** Registry key for the worker inventory (`defineWorkerInventoryCollection`). */
  workers?: string;
}

export interface WorkforceManifestSourceOptions {
  /** What the tree declared, resolved at boot. */
  roster: DeclaredWorkforce;
  /** Where the live rows are mounted. A domain with no key gets no source. */
  inventory: InventoryKeys;
}

/**
 * One line saying what a declared record is for — its `description:`, or
 * for a runtime hire its instructions.
 *
 * Conventional on a `WORKER.md` (the hire step reserves the key). A record that carries none falls back to
 * its id, which is all the declaration actually says.
 */
function purposeOf(
  declared: Record<string, unknown>,
  id: string,
  noun: string,
  instructions?: string,
): string {
  const described = declared["description"];
  if (typeof described === "string" && described.trim() !== "") return described.trim();
  if (typeof instructions === "string" && instructions.trim() !== "") return instructions.trim();
  return `The ${noun} "${id}". Its file declares no description.`;
}

/**
 * List one collection's rows, or throw a message naming the key.
 *
 * A registered source pointed at a collection this scope does not hold is a
 * wiring mistake, not an empty domain — the door degrades it to a `problem` on
 * this domain and every other domain still answers.
 *
 * Resolved through `resolveResourceCollection` rather than a bare
 * `ctx.resources[key]`, so a key means the same thing here that it means to
 * every other collection consumer in the framework — including its `get()` and
 * pattern-prefix fallbacks.
 *
 * **This lists the whole collection and keeps a subset, which is the thing
 * BP-033 tells you not to do.** Stated here rather than left for a reader to
 * find: an inventory row is never deleted, so the listed set grows with every
 * worker ever registered in the org while the kept set stays bounded
 * by what the tree currently declares — and this sits behind a tool a model may
 * call on every step.
 *
 * It is still the right read today. The alternative is a `getOptional` per
 * declared record, which trades one list for N point reads and is only cheaper
 * once the dead rows outnumber the live ones. Nothing in the framework pushes
 * a filter into the store for these keys, so there is no third option. Revisit it when an org's
 * historical rows are an order of magnitude past its roster; until then the
 * list is one read and the join is in memory.
 */
async function listRows<T>(
  ctx: BlockContext,
  key: string,
  domain: string,
): Promise<{ state: T }[]> {
  const collection = resolveResourceCollection(ctx, key);
  if (collection === undefined) {
    throw new Error(
      `The ${domain} collection "${key}" is not registered on ctx.resources. ` +
        `Install it on the block that carries the discovery door, or drop that key ` +
        `from createWorkforceCapability.`,
    );
  }
  return ((await collection.list()) ?? []) as unknown as { state: T }[];
}

/**
 * The workers domain: registered workers that are still declared.
 *
 * `kind` on the entry is the manifest kind (`"worker"`), not the worker flow the
 * worker was hired into — that one is a fact about how it runs and belongs on the
 * contract line, where a planner reads it only when it asks for detail.
 */
function workersSource(
  roster: DeclaredWorkforce,
  key: string,
): BlockManifestSource {
  const files = new Map(roster.workers.map((worker) => [worker.id, worker]));
  return {
    domain: "workers",
    origin: "createWorkforceCapability",
    entries: async (ctx: BlockContext): Promise<ManifestEntry[]> => {
      const declared = files;
      const entries: ManifestEntry[] = [];
      for (const row of await listRows<WorkerInventoryRow>(ctx, key, "workers")) {
        // A row that lost its required fields reads back empty rather than
        // throwing (the collection's schema is closed and required) — guard it
        // the same way a row written before an optional field is guarded.
        const id = row.state?.id;
        if (typeof id !== "string" || id === "") continue;
        const worker = declared.get(id);
        if (worker === undefined) continue;
        const flow = row.state.kind;
        entries.push({
          id,
          kind: "worker",
          purpose: purposeOf(worker.declared, id, "worker", worker.body),
          contract:
            `Hired into the "${typeof flow === "string" && flow !== "" ? flow : "agent"}" ` +
            `worker flow. Hand it work by its id.`,
        });
      }
      return entries;
    },
  };
}

/**
 * The workforce's manifest sources — the workers domain, when its inventory key
 * was named.
 *
 * Exported beside `createWorkforceCapability` for an app that assembles its own
 * registry (a flow that is not a worker flow, say). The capability is the
 * ordinary door and calls this.
 *
 * @param options The boot-resolved roster and the inventory registry keys.
 * @returns No source, or the workers source.
 */
export function workforceManifestSources(
  options: WorkforceManifestSourceOptions,
): BlockManifestSource[] {
  const sources: BlockManifestSource[] = [];
  if (options.inventory.workers !== undefined) {
    sources.push(workersSource(options.roster, options.inventory.workers));
  }
  return sources;
}
