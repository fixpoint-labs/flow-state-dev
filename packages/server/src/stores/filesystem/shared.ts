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

/**
 * Crash-safe write of `content` to `target` via a unique temp file plus
 * `rename`. The temp suffix carries `pid + Date.now() + random hex` so
 * concurrent writers (within or across processes) don't collide on the
 * staging path. Used by every filesystem store that needs torn-write
 * resilience.
 */
export async function atomicWrite(
  target: string,
  content: string | Buffer
): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  await writeFile(tmp, content);
  await rename(tmp, target);
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

/**
 * Sidecar files the request store writes alongside the primary record:
 * the append-only NDJSON event log (`.events.json`) and runOnce result
 * files (`.runonce.json` legacy single-map, `.runonce.<key>.json` per-key).
 * `listRecords` must skip these — they are not record documents and the
 * NDJSON event log is not even valid standalone JSON.
 *
 * This suffix match is a heuristic: `encodeURIComponent` does not escape `.`,
 * so an arbitrary record id ending in `.events`/`.runonce` would collide. It
 * is therefore opt-in (`skipSidecars`) and used only by the request store,
 * whose ids are framework-generated (`req_*`) and never carry those suffixes.
 * Scope stores (session/user/org) live in sidecar-free directories and must
 * not enable it, or a caller-supplied id could be silently dropped.
 */
function isSidecarFile(name: string): boolean {
  return (
    name.endsWith(".events.json") ||
    name.endsWith(".runonce.json") ||
    /\.runonce\..+\.json$/.test(name)
  );
}

export async function listRecords<TValue>(
  rootDir: string,
  skipSidecars = false
): Promise<TValue[]> {
  await ensureDirectory(rootDir);

  const entries = await readdir(rootDir, { withFileTypes: true });
  const values: TValue[] = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      (skipSidecars && isSidecarFile(entry.name))
    ) {
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
  state?: Record<string, unknown>;
};

/**
 * Mutator for `casUpdate`: receives the current record and returns the next
 * record body MINUS the `version`/`updatedAt` fields, which `casUpdate`
 * stamps. Keeps the version-bump logic in one place so callers can't drift.
 */
export type CasUpdateMutator<TRecord> = (
  current: TRecord
) => Omit<TRecord, "version" | "updatedAt">;

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
  /**
   * Version-predicated read-modify-write under the per-id lock. Unlike
   * `update` (which always writes), `casUpdate` aborts with a conflict when
   * the record is missing or its version doesn't match `expectedVersion`
   * (unless `"any"`). Returns the standard `SetResult`. Backs the delta verbs.
   */
  casUpdate<T extends TRecord>(
    id: string,
    expectedVersion: ExpectedVersion,
    mutate: CasUpdateMutator<TRecord>,
    updatedAt: number
  ): Promise<SetResult<T>>;
  /** Replace a single depth-1 field inside the record's `state` slice (CAS). */
  patchField<T extends TRecord>(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<T>>;
  /** Add `delta` to a depth-1 numeric `state` field; missing/non-numeric → 0 (CAS). */
  incField<T extends TRecord>(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<T>>;
  /** Append to a depth-1 `state` array; missing/non-array → replace (CAS). */
  pushToArray<T extends TRecord>(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<T>>;
  delete(id: string): Promise<void>;
  list(options?: TListOptions): Promise<TRecord[]>;
};

export type CreateFilesystemRecordStoreOptions<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
> = {
  rootDir: string;
  filter?: (record: TRecord, options?: TListOptions) => boolean;
  /**
   * Comparator applied before offset/limit. Receives the list options so a
   * store can honor a per-call sort key (e.g. `orderBy`). Defaults to
   * `updatedAt` descending.
   */
  sort?: (left: TRecord, right: TRecord, options?: TListOptions) => number;
  /**
   * Skip `.events.json`/`.runonce.*.json` sidecar files in `list`. Only the
   * request store (which co-locates sidecars with records and uses
   * framework-generated `req_*` ids) should enable this; see `isSidecarFile`.
   */
  skipSidecars?: boolean;
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
  const skipSidecars = options.skipSidecars ?? false;
  const withLock = createWriteLock();

  const record: FilesystemRecordStore<TRecord, TListOptions> = {
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

    casUpdate: <T extends TRecord>(
      id: string,
      expectedVersion: ExpectedVersion,
      mutate: CasUpdateMutator<TRecord>,
      updatedAt: number
    ): Promise<SetResult<T>> =>
      withLock(id, async () => {
        const current = await readRecord<TRecord>(rootDir, id);
        if (current === undefined) {
          return {
            ok: false,
            conflict: { currentValue: undefined, currentVersion: 0 }
          };
        }
        if (expectedVersion !== "any" && current.version !== expectedVersion) {
          return {
            ok: false,
            conflict: { currentValue: current as T, currentVersion: current.version }
          };
        }
        const newVersion =
          (expectedVersion === "any" ? current.version : expectedVersion) + 1;
        const partialNext = mutate(current);
        const nextRecord = {
          ...partialNext,
          version: newVersion,
          updatedAt
        } as TRecord;
        await writeRecord(rootDir, id, nextRecord);
        return { ok: true, version: newVersion };
      }),

    patchField: <T extends TRecord>(
      id: string,
      path: string[],
      value: unknown,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<T>> => {
      assertDepthOne(path, "patchField");
      return record.casUpdate<T>(
        id,
        expectedVersion,
        (current) => ({
          ...current,
          state: { ...(current.state ?? {}), [path[0]]: value }
        }),
        updatedAt
      );
    },

    incField: <T extends TRecord>(
      id: string,
      path: string[],
      delta: number,
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<T>> => {
      assertDepthOne(path, "incField");
      return record.casUpdate<T>(
        id,
        expectedVersion,
        (current) => {
          const existing = current.state?.[path[0]];
          const baseline = typeof existing === "number" ? existing : 0;
          return {
            ...current,
            state: { ...(current.state ?? {}), [path[0]]: baseline + delta }
          };
        },
        updatedAt
      );
    },

    pushToArray: <T extends TRecord>(
      id: string,
      path: string[],
      values: unknown[],
      expectedVersion: ExpectedVersion,
      updatedAt: number
    ): Promise<SetResult<T>> => {
      assertDepthOne(path, "pushToArray");
      return record.casUpdate<T>(
        id,
        expectedVersion,
        (current) => {
          const existing = current.state?.[path[0]];
          const baseline = Array.isArray(existing) ? existing : [];
          return {
            ...current,
            state: { ...(current.state ?? {}), [path[0]]: [...baseline, ...values] }
          };
        },
        updatedAt
      );
    },

    delete: async (id: string): Promise<void> => {
      await deleteRecord(rootDir, id);
    },

    list: async (listOptions?: TListOptions): Promise<TRecord[]> => {
      const all = await listRecords<TRecord>(rootDir, skipSidecars);
      const filtered =
        filter === undefined
          ? all
          : all.filter((entry) => filter(entry, listOptions));

      filtered.sort((left, right) => sort(left, right, listOptions));
      return applyOffsetLimit(filtered, listOptions);
    }
  };

  return record;
}

/**
 * Delta verbs operate on a single depth-1 key inside `state`. Deeper paths
 * are pre-routed to `set` by the CAS persist layer; a direct adapter caller
 * passing a deep path is a bug we surface rather than silently mis-apply.
 */
function assertDepthOne(path: string[], verb: string): void {
  if (path.length !== 1) {
    throw new Error(
      `${verb} only supports depth-1 paths in v1; received path of length ${path.length}`
    );
  }
}
