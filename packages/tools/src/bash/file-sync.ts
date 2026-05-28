/**
 * FileSync — bidirectional bridge between resource collections and the sandbox filesystem.
 *
 * Handles two operations:
 * - **hydrate**: reads all entries from the passed resource collections and writes
 *   them into the sandbox filesystem under the configured destination.
 * - **flush**: walks the sandbox workspace, diffs file contents via SHA-256 hash,
 *   upserts changed files back to the appropriate collection, and removes deleted entries.
 *
 * Sync is explicit: hydrate runs once on init, flush runs after every `bash` and
 * `writeFile` tool call. No filesystem watchers or polling.
 */

import path from "node:path";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { Sandbox, FileEntryState } from "./types";
import { hashContent } from "./hash";

interface FileSyncOptions {
  destination: string;
  syncMode: "full" | "diff";
  fileFilter?: (path: string) => boolean;
}

/**
 * Bidirectional sync between resource collections and the sandbox filesystem.
 *
 * Each file in the workspace maps back to exactly one resource collection.
 * Files that don't match any passed collection are ignored during flush (they
 * stay in the sandbox but aren't persisted to resources).
 */
export class FileSync {
  constructor(
    private sandbox: Sandbox,
    private collections: Record<string, ResourceCollectionRef<FileEntryState>>,
    private options: FileSyncOptions,
  ) {}

  /**
   * Hydrate: materialize all resource collection entries into the sandbox filesystem.
   *
   * Iterates every passed collection, reads each entry's content, and writes it
   * to the corresponding path under the workspace destination.
   */
  async hydrate(): Promise<void> {
    for (const collection of Object.values(this.collections)) {
      for await (const entry of collection.scan()) {
        const content = await entry.readContent();
        if (content === null) continue;

        const state = await entry.state();
        const fullPath = path.join(this.options.destination, state.path);
        await this.sandbox.writeFile(fullPath, content);
      }
    }
  }

  /**
   * Flush: sync sandbox filesystem changes back to resource collections.
   *
   * Walks the workspace, hashes each file, and compares against existing
   * resource state. Changed files are upserted; files deleted from the sandbox
   * are removed from their owning collection.
   */
  async flush(): Promise<void> {
    const currentFiles = await this.walkWorkspace();

    // Build a set of all paths that exist in the sandbox for quick lookup
    const currentPaths = new Set(currentFiles.map((f) => f.path));

    // Upsert changed or new files
    for (const file of currentFiles) {
      if (this.options.fileFilter && !this.options.fileFilter(file.path)) {
        continue;
      }

      // Find which collection owns this path
      const owner = await this.findOwner(file.path);
      if (!owner) continue;

      const existing = await owner.collection.getOptional(file.path);
      const existingHash = existing ? (await existing.state()).hash : undefined;

      if (!existing || this.options.syncMode === "full" || existingHash !== file.hash) {
        const ref = await owner.collection.getOrCreate(file.path, {
          path: file.path,
          hash: file.hash,
          updatedAt: new Date().toISOString(),
        });

        // Update state if the hash changed
        if ((await ref.state()).hash !== file.hash) {
          await ref.patchState({
            hash: file.hash,
            updatedAt: new Date().toISOString(),
          });
        }

        // Write file content to the resource
        await ref.writeContent(file.content);
      }
    }

    // Remove entries for files deleted from the sandbox
    for (const collection of Object.values(this.collections)) {
      for await (const entry of collection.scan()) {
        const entryPath = (await entry.state()).path;
        if (!currentPaths.has(entryPath)) {
          await collection.delete(entryPath);
        }
      }
    }
  }

  /**
   * Determines which collection owns a given workspace path.
   *
   * For v1, ownership uses a simple strategy: check each collection for an
   * existing entry at the path. If no existing entry, the first collection
   * is used as the default owner for new files.
   */
  private async findOwner(
    filePath: string,
  ): Promise<{ name: string; collection: ResourceCollectionRef<FileEntryState> } | undefined> {
    const entries = Object.entries(this.collections);
    if (entries.length === 0) return undefined;

    // Check if any collection already owns this path
    for (const [name, collection] of entries) {
      if (await collection.getOptional(filePath)) {
        return { name, collection };
      }
    }

    // Default: first collection owns new files
    const [name, collection] = entries[0];
    return { name, collection };
  }

  /**
   * Walks the workspace directory and returns metadata for every file found.
   *
   * Excludes common non-content directories (node_modules, .git) via the
   * find command.
   */
  private async walkWorkspace(): Promise<
    Array<{ path: string; content: string; hash: string }>
  > {
    const dest = this.options.destination;

    const result = await this.sandbox.executeCommand(
      `find ${dest} -type f -not -path '*/node_modules/*' -not -path '*/.git/*'`,
    );

    if (result.exitCode !== 0) return [];

    const paths = result.stdout.trim().split("\n").filter(Boolean);
    const entries: Array<{ path: string; content: string; hash: string }> = [];

    for (const fullPath of paths) {
      try {
        const content = await this.sandbox.readFile(fullPath);
        const relativePath = path.relative(dest, fullPath);
        entries.push({
          path: relativePath,
          content,
          hash: hashContent(content),
        });
      } catch {
        // File may have been removed between walk and read — skip it
      }
    }

    return entries;
  }
}
