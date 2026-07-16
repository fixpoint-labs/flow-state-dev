/**
 * Filesystem-backed resource state store — the state-layer twin of the
 * filesystem content store.
 *
 * Thin config over the generic {@link createFilesystemResourceStore} factory:
 * `.json` leaf extension and JSON serialize/deserialize. A resource key maps to
 * a nested on-disk path with the extension on the leaf —
 * `set("session","s1","todos/a", state)` writes
 * `rootDir/state/session/s1/todos/a.json`.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { ResourceStateStore } from "../types";
import { createFilesystemResourceStore } from "./filesystem-resource-store";

/**
 * Create a filesystem-backed {@link ResourceStateStore} rooted at
 * `rootDir/state`.
 */
export function createFilesystemResourceStateStore(rootDir: string): ResourceStateStore {
  return createFilesystemResourceStore<JsonObject>({
    rootDir,
    subdir: "state",
    ext: ".json",
    serialize: (value) => JSON.stringify(value),
    deserialize: (raw) => JSON.parse(raw) as JsonObject
  });
}
