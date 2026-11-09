/**
 * The local-disk blob store, and `localBlobStores`, the adapter that names it
 * for a profile's `blobs` slot.
 *
 * Each file is two entries in one folder: `<id>.bin` holds the bytes and
 * `<id>.json` the record. The record is written last, so a file exists once
 * its record does; a crash between the two leaves a `.bin` nothing reads,
 * which the sweep takes. Ids are checked against the blob-id shape before
 * any path is built from one.
 *
 * Single-server by design: a host whose disk does not last, or a deploy on
 * more than one machine, configures a hosted adapter instead.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ATTACHMENT_LIMITS, isBlobId } from "@flow-state-dev/core/attachments";
import type { StoreAdapter } from "../stores/store-adapter";
import { createKeyedLock, decideClaim, isSweepable, uploadedBy } from "./shared";
import type { BlobRecord, BlobStore } from "./types";

/** Options for {@link localBlobStores} and {@link createLocalBlobStore}. */
export type LocalBlobStoreOptions = {
  /** The folder the files go in. Made on the first upload. */
  rootDir: string;
  /** The clock, for tests that move it. */
  now?: () => number;
};

/** Build a blob store over a folder on this server's disk. */
export function createLocalBlobStore(options: LocalBlobStoreOptions): BlobStore {
  const rootDir = path.resolve(options.rootDir);
  const now = options.now ?? Date.now;
  const locked = createKeyedLock();
  let opened: Promise<void> | undefined;

  const binPath = (id: string): string => path.join(rootDir, `${id}.bin`);
  const recordPath = (id: string): string => path.join(rootDir, `${id}.json`);

  const readRecord = async (id: string): Promise<BlobRecord | undefined> => {
    if (!isBlobId(id)) return undefined;
    try {
      return JSON.parse(await readFile(recordPath(id), "utf8")) as BlobRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  /** Write a file whole or not at all: a reader never sees half a record. */
  const writeWhole = async (file: string, data: string | Uint8Array): Promise<void> => {
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, data);
    await rename(temp, file);
  };

  const removeBlob = async (id: string): Promise<void> => {
    // Record first, so a file stops existing before its bytes go.
    await rm(recordPath(id), { force: true });
    await rm(binPath(id), { force: true });
  };

  /**
   * The folder's entries; none while no upload has made it. Only `put` makes
   * the folder: the default store sits on every server with persistent
   * sessions, and a session create or delete reaches it, so a read-only working
   * folder must fail an upload and nothing else.
   */
  const entries = async (): Promise<string[]> => {
    try {
      return await readdir(rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };

  const sweep = async (): Promise<void> => {
    const at = now();
    const names = await entries();
    const recorded = new Set<string>();
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      const record = await readRecord(id);
      if (record === undefined) continue;
      recorded.add(id);
      if (isSweepable(record, at)) await locked(id, async () => {
        const current = await readRecord(id);
        if (current !== undefined && isSweepable(current, now())) await removeBlob(id);
      });
    }
    // Bytes whose record was never written (a crash mid-upload), and temp
    // files a crash left, once they are as old as an unclaimed upload.
    for (const name of names) {
      const id = name.endsWith(".bin") ? name.slice(0, -".bin".length) : undefined;
      const orphan = (id !== undefined && !recorded.has(id)) || name.endsWith(".tmp");
      if (!orphan) continue;
      const file = path.join(rootDir, name);
      const info = await stat(file).catch(() => undefined);
      if (info !== undefined && at - info.mtimeMs >= ATTACHMENT_LIMITS.unclaimedTtlMs) {
        await rm(file, { force: true });
      }
    }
  };

  /** Sweep once, when the store is first used. A failed sweep is tried again on the next use. */
  const open = (): Promise<void> => {
    opened ??= sweep().catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };

  return {
    local: true,
    persists: true,
    async put(input) {
      if (!isBlobId(input.id)) throw new TypeError(`"${input.id}" is not a blob id`);
      await mkdir(rootDir, { recursive: true });
      await open();
      await sweep();
      const record: BlobRecord = {
        id: input.id,
        mediaType: input.mediaType,
        ...(input.filename === undefined ? {} : { filename: input.filename }),
        size: input.bytes.byteLength,
        uploader: { ...input.uploader },
        createdAt: now()
      };
      await writeWhole(binPath(input.id), input.bytes);
      await writeWhole(recordPath(input.id), JSON.stringify(record));
      return record;
    },
    async head(id) {
      await open();
      return readRecord(id);
    },
    async read(id) {
      await open();
      const record = await readRecord(id);
      if (record === undefined) return undefined;
      try {
        return { record, bytes: new Uint8Array(await readFile(binPath(id))) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async claim(id, claim) {
      await open();
      return locked(id, async () => {
        const { result, next } = decideClaim(await readRecord(id), claim);
        if (next !== undefined) await writeWhole(recordPath(id), JSON.stringify(next));
        return result;
      });
    },
    async release(id, owner) {
      await open();
      await locked(id, async () => {
        const record = await readRecord(id);
        if (record === undefined || record.owner !== owner) return;
        const { owner: _released, ...held } = record;
        await writeWhole(recordPath(id), JSON.stringify(held));
      });
    },
    async deleteOwner(owner, options) {
      await open();
      let deleted = 0;
      for (const name of await entries()) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        const gone = await locked(id, async () => {
          const record = await readRecord(id);
          if (record?.owner !== owner || uploadedBy(record, options?.keepUploader)) return false;
          await removeBlob(id);
          return true;
        });
        if (gone) deleted += 1;
      }
      return deleted;
    },
    async delete(id) {
      await open();
      return locked(id, async () => {
        if ((await readRecord(id)) === undefined) return false;
        await removeBlob(id);
        return true;
      });
    }
  };
}

/**
 * The local-disk blob store as a profile's `blobs` adapter. The default when a
 * profile with persistent sessions names none is this, under
 * `.fsdev/blobs` in the server's working directory; name it to choose
 * another folder:
 *
 * ```ts
 * stores: { default: { primary: sqliteStores({ filename }), blobs: localBlobStores({ rootDir: "/var/lib/myapp/blobs" }) } }
 * ```
 *
 * A database backup does not include these files; back the folder up too.
 */
export function localBlobStores(options: LocalBlobStoreOptions): StoreAdapter {
  let store: BlobStore | undefined;
  return {
    capabilities: ["blobs"],
    resolve() {
      store ??= createLocalBlobStore(options);
      return Promise.resolve({ blobs: store });
    }
  };
}
