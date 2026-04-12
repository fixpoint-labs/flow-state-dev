/**
 * Bash tool blocks — execute commands and manage files in a sandbox workspace.
 *
 * Uses the framework's `createBashBlocks` factory from `@flow-state-dev/tools/bash`.
 * The blocks hydrate from the session's artifacts collection on first access
 * and sync changes back after mutations, so workspace files persist as artifacts.
 */
import { createBashBlocks } from "@flow-state-dev/tools/bash";
import { artifactResources } from "../schemas";
import path from "node:path";

export const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
  sessionResources: artifactResources,
  collectionKey: "artifacts",
  provider: {
    type: "local",
  },
  createState: (relativePath) => ({
    title: path.basename(relativePath),
    updatedAt: Date.now(),
  }),
});
