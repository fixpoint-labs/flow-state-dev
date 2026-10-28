/**
 * The local store a no-config `fsdev run` and `fsdev dev` share (FIX-2063 D1).
 *
 * By default both open `.fsdev/data/fsdev.db` (SQLite), so a stop a terminal run
 * makes is listed and answered by the `fsdev dev` that reads the same file.
 * SQLite's WAL mode and busy timeout let a run write beside a running server.
 * `--store filesystem` keeps a run's state as JSON files under `.fsdev/data`
 * instead: single-process, so `fsdev run` and `fsdev dev` can't share it at the
 * same time. A command with an app config uses the app's stores and refuses
 * the flag.
 */
import { mkdir } from "node:fs/promises";
import { createFilesystemStores, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { CliError } from "./resolve-block";
import { EXIT_INVALID_ARGS } from "./exit-codes";

/** The local stores a no-config command can open. */
export type LocalStoreKind = "sqlite" | "filesystem";

/** Where the local stores live, relative to the working directory. */
const LOCAL_DATA_DIR = ".fsdev/data";
/** The SQLite file `fsdev dev`, `fsdev run` and `fsdev chat` share. */
const LOCAL_DB_FILE = `${LOCAL_DATA_DIR}/fsdev.db`;

/** Help text for the `--store` flag, the same on every command that takes it. */
export const STORE_FLAG_HELP =
  "Local store without an app config: sqlite (default, .fsdev/data/fsdev.db, shared by fsdev run and fsdev dev) " +
  "or filesystem (JSON files under .fsdev/data; single-process, so run and dev can't use it at the same time)";

/** One opened local store, with the line a command prints for it and how to close it. */
export interface LocalStores {
  stores: StoreRegistry;
  kind: LocalStoreKind;
  /** Where the data is, as a person reads it. */
  dataLine: string;
  close(): void;
}

/**
 * Check a `--store` value. `undefined` stays `undefined`, so a command can tell
 * "not given" from the default. Refused beside an app config, whose stores are
 * the app's own.
 */
export function parseStoreFlag(value: string | undefined, hasConfig: boolean): LocalStoreKind | undefined {
  if (value === undefined) return undefined;
  if (hasConfig) {
    throw new CliError(
      `--store chooses the local store when there is no app config; this command loaded one, and its stores ` +
        `are the app's. Drop --store, or pass --no-config.`,
      EXIT_INVALID_ARGS,
    );
  }
  if (value !== "sqlite" && value !== "filesystem") {
    throw new CliError(`--store must be sqlite or filesystem, not "${value}".`, EXIT_INVALID_ARGS);
  }
  return value;
}

/** Open the local store of `kind` (default SQLite) under the working directory. */
export async function openLocalStores(kind: LocalStoreKind = "sqlite"): Promise<LocalStores> {
  // better-sqlite3 won't create parent dirs.
  await mkdir(LOCAL_DATA_DIR, { recursive: true });
  if (kind === "filesystem") {
    return {
      stores: createFilesystemStores({ rootDir: LOCAL_DATA_DIR, developmentOnly: true }),
      kind,
      dataLine: `${LOCAL_DATA_DIR} (filesystem, single-process)`,
      close: () => {},
    };
  }
  const stores = createSQLiteStores({ filename: LOCAL_DB_FILE });
  return { stores, kind, dataLine: `${LOCAL_DB_FILE} (SQLite)`, close: () => stores.close() };
}
