/**
 * Filesystem-backed content store.
 *
 * Thin config over the generic {@link createFilesystemResourceStore} factory:
 * `.md` leaf extension and identity (string) serialize/deserialize. A resource
 * key maps to a nested on-disk path with the extension on the leaf —
 * `set("session","s1","concepts/x/overview", body)` writes
 * `rootDir/content/session/s1/concepts/x/overview.md`, a browsable file tree.
 */
import type { ContentStore } from "../types";
import { createFilesystemResourceStore } from "./filesystem-resource-store";

/**
 * Create a filesystem-backed {@link ContentStore} rooted at `rootDir/content`.
 */
export function createFilesystemContentStore(rootDir: string): ContentStore {
  return createFilesystemResourceStore<string>({
    rootDir,
    subdir: "content",
    ext: ".md",
    serialize: (value) => value,
    deserialize: (raw) => raw
  });
}
