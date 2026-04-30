import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOffsetLimit } from "../shared";
import { sortByUpdatedAtDesc } from "../../utils/sort";
import type { ExpectedVersion, SetResult } from "../types";

function toFileName(id: string): string {
  return `${encodeURIComponent(id)}.json`;
}

export function toRecordPath(rootDir: string, id: string): string {
  return path.join(rootDir, toFileName(id));
}

export async function ensureDirectory(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
}

export async function readRecord<TValue>(
  rootDir: string,
  id: string
): Promise<TValue | undefined> {
  const filePath = toRecordPath(rootDir, id);

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as TValue;
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeRecord<TValue>(
  rootDir: string,
  id: string,
  value: TValue
): Promise<void> {
  await ensureDirectory(rootDir);

  const targetPath = toRecordPath(rootDir, id);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  const serialized = JSON.stringify(value, null, 2);
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, targetPath);
}

export async function deleteRecord(rootDir: string, id: string): Promise<void> {
  const filePath = toRecordPath(rootDir, id);

  try {
    await rm(filePath);
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function listRecords<TValue>(rootDir: string): Promise<TValue[]> {
  await ensureDirectory(rootDir);

  const entries = await readdir(rootDir, { withFileTypes: true });
  const values: TValue[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(rootDir, entry.name);
    const raw = await readFile(filePath, "utf8");
    values.push(JSON.parse(raw) as TValue);
  }

  return values;
}

type StoreListOptions = {
  offset?: number;
  limit?: number;
};

type RecordWithIdentity = {
  id: string;
  updatedAt: number;
  version: number;
};

export type FilesystemRecordStore<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
> = {
  get(id: string): Promise<TRecord | undefined>;
  set(
    id: string,
    value: TRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<TRecord>>;
  /**
   * Atomically read-modify-write a record under the per-id write lock.
   *
   * Use this when the caller needs to merge new fields into the existing
   * record without clobbering concurrent writes. The merge function runs
   * inside the lock against the freshest on-disk state, so a CAS state
   * write that lands while the merge is pending is observed by `current`
   * here and preserved by the merge.
   *
   * Returns the new record, or `undefined` if the record does not exist.
   */
  update(
    id: string,
    merge: (current: TRecord) => TRecord
  ): Promise<TRecord | undefined>;
  delete(id: string): Promise<void>;
  list(options?: TListOptions): Promise<TRecord[]>;
};

export type CreateFilesystemRecordStoreOptions<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
> = {
  rootDir: string;
  filter?: (record: TRecord, options?: TListOptions) => boolean;
  sort?: (left: TRecord, right: TRecord) => number;
};

/** Per-id serialization so the read-check-write sequence below is atomic within one process. */
function createWriteLock(): <T>(id: string, fn: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<unknown>>();
  return <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prior = inflight.get(id) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    const tracked = next.finally(() => {
      if (inflight.get(id) === tracked) {
        inflight.delete(id);
      }
    });
    inflight.set(id, tracked);
    return next;
  };
}

export function createFilesystemRecordStore<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
>(
  options: CreateFilesystemRecordStoreOptions<TRecord, TListOptions>
): FilesystemRecordStore<TRecord, TListOptions> {
  const { rootDir } = options;
  const filter = options.filter;
  const sort = options.sort ?? sortByUpdatedAtDesc;
  const withLock = createWriteLock();

  return {
    get: async (id: string): Promise<TRecord | undefined> =>
      readRecord<TRecord>(rootDir, id),

    set: (
      id: string,
      value: TRecord,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<TRecord>> =>
      withLock(id, async () => {
        if (expectedVersion !== "any") {
          const current = await readRecord<TRecord>(rootDir, id);
          const currentVersion = current?.version ?? 0;
          if (currentVersion !== expectedVersion) {
            return {
              ok: false,
              conflict: { currentValue: current, currentVersion }
            };
          }
        }
        await writeRecord(rootDir, id, value);
        return { ok: true, version: value.version };
      }),

    update: (
      id: string,
      merge: (current: TRecord) => TRecord
    ): Promise<TRecord | undefined> =>
      withLock(id, async () => {
        // Re-read inside the lock so concurrent CAS writes (which take the
        // same lock for `set`) are visible. Without this, `update` would race
        // with state-mutation writes and silently overwrite the state field.
        const current = await readRecord<TRecord>(rootDir, id);
        if (current === undefined) return undefined;
        const next = merge(current);
        await writeRecord(rootDir, id, next);
        return next;
      }),

    delete: async (id: string): Promise<void> => {
      await deleteRecord(rootDir, id);
    },

    list: async (listOptions?: TListOptions): Promise<TRecord[]> => {
      const all = await listRecords<TRecord>(rootDir);
      const filtered =
        filter === undefined
          ? all
          : all.filter((record) => filter(record, listOptions));

      filtered.sort(sort);
      return applyOffsetLimit(filtered, listOptions);
    }
  };
}
