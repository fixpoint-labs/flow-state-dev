/**
 * The SQLite store's size on disk: the database file plus its `-wal` and
 * `-shm` companions, which hold committed pages not yet checkpointed into the
 * main file (the store runs in WAL mode). Read on demand by
 * `StoreRegistry.storageSize`.
 */
import { statSync } from "node:fs";
import path from "node:path";
import type { StorageSize } from "@flow-state-dev/engine/host";

/** The files SQLite keeps for the database at `filename`. */
const COMPANION_SUFFIXES = ["", "-wal", "-shm"] as const;

/**
 * Whether `filename` names a file on disk. `:memory:` and the empty string
 * (better-sqlite3's anonymous temporary database) keep nothing a person could
 * find, so the registry offers no size for them.
 */
export function isOnDisk(filename: string): boolean {
  return filename !== ":memory:" && filename !== "";
}

/** Measure the database at `filename`. A companion that isn't there counts 0. */
export function sqliteStorageSize(filename: string): StorageSize {
  let bytes = 0;
  for (const suffix of COMPANION_SUFFIXES) {
    try {
      bytes += statSync(filename + suffix).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { kind: "sqlite", bytes, location: path.resolve(filename) };
}
