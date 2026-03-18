import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOffsetLimit } from "../shared";
import { sortByUpdatedAtDesc } from "../../utils/sort";

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
};

export type FilesystemRecordStore<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
> = {
  get(id: string): Promise<TRecord | undefined>;
  set(id: string, value: TRecord): Promise<void>;
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

export function createFilesystemRecordStore<
  TRecord extends RecordWithIdentity,
  TListOptions extends StoreListOptions
>(
  options: CreateFilesystemRecordStoreOptions<TRecord, TListOptions>
): FilesystemRecordStore<TRecord, TListOptions> {
  const { rootDir } = options;
  const filter = options.filter;
  const sort = options.sort ?? sortByUpdatedAtDesc;

  return {
    get: async (id: string): Promise<TRecord | undefined> =>
      readRecord<TRecord>(rootDir, id),

    set: async (id: string, value: TRecord): Promise<void> => {
      await writeRecord(rootDir, id, value);
    },

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
