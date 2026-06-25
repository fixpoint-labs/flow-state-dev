/**
 * Atomic file write utility using write-to-temp + rename.
 *
 * On POSIX systems, rename() is atomic — a crash mid-write leaves
 * the previous valid file intact (or no file if it didn't exist yet).
 */
import { open, rename, writeFile } from "node:fs/promises";

export type AtomicWriteFileOptions = {
  /** Whether to fsync before rename. Default: false. */
  fsync?: boolean;
  /** Suffix for the temp file. Default: '.tmp' */
  tmpSuffix?: string;
};

export async function atomicWriteFile(
  targetPath: string,
  content: string | Buffer,
  options?: AtomicWriteFileOptions
): Promise<void> {
  const suffix = options?.tmpSuffix ?? ".tmp";
  const tempPath = `${targetPath}${suffix}-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  await writeFile(tempPath, content, typeof content === "string" ? "utf8" : undefined);

  if (options?.fsync === true) {
    const fd = await open(tempPath, "r");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  }

  await rename(tempPath, targetPath);
}
