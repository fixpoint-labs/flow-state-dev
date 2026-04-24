/**
 * Bash tool blocks — execute commands and manage files in a sandbox workspace.
 *
 * Uses the framework's `createBashBlocks` factory. No explicit collection
 * config — the blocks auto-discover every `ResourceCollectionRef` installed
 * on the block's runtime context (artifacts, skills, etc.) and mount each
 * at its pattern prefix. Writes route back per-collection; files under
 * `/workspace/tmp/` are scratch; anything else is dropped with a warning.
 */
import { createBashBlocks } from "@flow-state-dev/tools/bash";
import path from "node:path";

export const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
  provider: {
    type: "local",
  },
  createState: (relativePath) => ({
    title: path.basename(relativePath),
    updatedAt: Date.now(),
  }),
});
