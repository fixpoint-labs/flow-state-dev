/**
 * Control `in-memory`: the DevTeam profile's store as it was before it was
 * kept on disk.
 *
 * Loaded into the served Lab in place of `packages/store-sqlite/src/index.ts`
 * (`swap-loader.mjs`), so the profile's `sqliteStores({ filename })` hands back
 * stores that live only as long as the process. Everything else the module
 * exports is the real one, for the other importers in the process. Everything
 * before the restart passes; after it, the projects, their talk links and the
 * rooms' lines are gone.
 */
import { inMemoryStores } from "@flow-state-dev/engine";

export * from "../../../../packages/store-sqlite/src/index.ts";

/** The profile's call, answered with stores that die with the process. */
export function sqliteStores(_options: { filename: string }) {
  return inMemoryStores();
}
