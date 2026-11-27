/**
 * The filesystem store's size: the bytes of every file under its root folder,
 * which holds all it keeps (attachments too, when `filesystemStores` backs
 * the `blobs` slot). Read on demand by `StoreRegistry.storageSize`.
 */
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { StorageSize } from "../types";

/**
 * Measure the store rooted at `rootDir`. A root that does not exist yet (no
 * write has landed) measures 0. Symbolic links count as the link itself, never
 * their target, so a link out of the folder can't inflate the number.
 */
export async function filesystemStorageSize(rootDir: string): Promise<StorageSize> {
  return { kind: "filesystem", bytes: await folderBytes(rootDir), location: path.resolve(rootDir) };
}

async function folderBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isGone(error)) return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await folderBytes(full);
      continue;
    }
    try {
      total += (await lstat(full)).size;
    } catch (error) {
      // A file removed between the listing and the stat (a trace trimmed
      // mid-walk) no longer takes space.
      if (!isGone(error)) throw error;
    }
  }
  return total;
}

function isGone(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
