/**
 * Bash tool blocks — execute commands and manage files in a sandbox workspace.
 *
 * Provides three LLM-callable handler blocks (bashCommand, bashReadFile,
 * bashWriteFile) that operate on a per-session sandbox. The sandbox is
 * hydrated from the session's artifacts collection on first access and
 * synced back after mutations, so file changes persist as artifacts.
 */
import { handler } from "@flow-state-dev/core";
import { createLocalFsSandbox } from "@flow-state-dev/tools/bash";
import type { Sandbox, CommandResult } from "@flow-state-dev/tools/bash";
import { hashContent } from "@flow-state-dev/tools/bash";
import { z } from "zod";
import { artifactResources, artifactStateSchema } from "../schemas";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import path from "node:path";

// ---------------------------------------------------------------------------
// Sandbox registry — one sandbox per session, lazily created
// ---------------------------------------------------------------------------

type ArtifactState = z.infer<typeof artifactStateSchema>;

const sandboxes = new Map<string, { sandbox: Sandbox; hydrated: boolean }>();
const WORKSPACE_ROOT = "/workspace";

async function getOrCreateSandbox(
  sessionId: string,
  artifacts: ResourceCollectionRef<ArtifactState>,
): Promise<Sandbox> {
  let entry = sandboxes.get(sessionId);
  if (!entry) {
    const cwd = path.join("/tmp", "ks-workspace", sessionId);
    const sandbox = createLocalFsSandbox({ cwd });
    entry = { sandbox, hydrated: false };
    sandboxes.set(sessionId, entry);
  }

  // Hydrate from artifacts on first access
  if (!entry.hydrated) {
    const refs = artifacts.list();
    for (const ref of refs) {
      const content = await ref.readContent();
      if (content === null) continue;
      const filePath = path.join(WORKSPACE_ROOT, ref.name);
      await entry.sandbox.writeFile(filePath, content);
    }
    entry.hydrated = true;
  }

  return entry.sandbox;
}

/**
 * Flush sandbox changes back to the artifacts collection.
 *
 * Walks the workspace, compares content hashes against existing artifacts,
 * and upserts changed files. Deleted files are removed from the collection.
 */
async function flushToArtifacts(
  sandbox: Sandbox,
  artifacts: ResourceCollectionRef<ArtifactState>,
): Promise<void> {
  const result = await sandbox.executeCommand(
    `find ${WORKSPACE_ROOT} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
  );

  const currentPaths = new Set<string>();

  if (result.exitCode === 0 && result.stdout.trim()) {
    const filePaths = result.stdout.trim().split("\n").filter(Boolean);

    for (const fullPath of filePaths) {
      try {
        const content = await sandbox.readFile(fullPath);
        const relativePath = path.relative(WORKSPACE_ROOT, fullPath);
        currentPaths.add(relativePath);

        const existing = artifacts.getOptional(relativePath);
        if (existing) {
          const existingContent = await existing.readContent();
          if (existingContent !== content) {
            await existing.writeContent(content);
            await existing.patchState({ updatedAt: Date.now() });
          }
        } else {
          // New file — create artifact
          const title = path.basename(relativePath);
          const ref = await artifacts.create(relativePath, {
            title,
            summary: "",
            updatedAt: Date.now(),
          });
          await ref.writeContent(content);
        }
      } catch {
        // File may have been removed between walk and read
      }
    }
  }

  // Remove artifacts for files deleted from the sandbox
  for (const ref of artifacts.list()) {
    if (!currentPaths.has(ref.name)) {
      await artifacts.delete(ref.name);
    }
  }
}

// ---------------------------------------------------------------------------
// LLM-callable handler blocks
// ---------------------------------------------------------------------------

export const bashCommandInputSchema = z.object({
  command: z.string().describe("The bash command to execute in the workspace"),
});

export const bashCommandOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

/** Execute a bash command in the session's workspace sandbox. */
export const bashCommand = handler({
  name: "bash",
  description: [
    "Execute a bash command in the workspace.",
    "The workspace is a persistent filesystem scoped to this session.",
    "Files created or modified here are saved as artifacts.",
    "Common uses: run scripts, install packages, compile code, inspect files.",
  ].join(" "),
  inputSchema: bashCommandInputSchema,
  outputSchema: bashCommandOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const sandbox = await getOrCreateSandbox(
      ctx.session.identity.id,
      ctx.session.resources.artifacts,
    );

    const result = await sandbox.executeCommand(
      `cd ${WORKSPACE_ROOT} && ${input.command}`,
    );

    // Sync changes back to artifacts after every command
    await flushToArtifacts(sandbox, ctx.session.resources.artifacts);

    return result;
  },
});

export const bashReadFileInputSchema = z.object({
  path: z.string().describe("Path to the file to read, relative to workspace root"),
});

export const bashReadFileOutputSchema = z.object({
  content: z.string(),
});

/** Read a file from the workspace sandbox. */
export const bashReadFile = handler({
  name: "bash-read-file",
  description: "Read the contents of a file from the workspace filesystem.",
  inputSchema: bashReadFileInputSchema,
  outputSchema: bashReadFileOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const sandbox = await getOrCreateSandbox(
      ctx.session.identity.id,
      ctx.session.resources.artifacts,
    );

    const fullPath = path.join(WORKSPACE_ROOT, input.path);
    const content = await sandbox.readFile(fullPath);
    return { content };
  },
});

export const bashWriteFileInputSchema = z.object({
  path: z.string().describe("Path where the file should be written, relative to workspace root"),
  content: z.string().describe("Content to write to the file"),
});

export const bashWriteFileOutputSchema = z.object({
  success: z.boolean(),
});

/** Write a file to the workspace sandbox. Creates parent directories if needed. */
export const bashWriteFile = handler({
  name: "bash-write-file",
  description: "Write content to a file in the workspace. Creates parent directories if needed. The file is automatically saved as an artifact.",
  inputSchema: bashWriteFileInputSchema,
  outputSchema: bashWriteFileOutputSchema,
  sessionResources: artifactResources,

  execute: async (input, ctx) => {
    const sandbox = await getOrCreateSandbox(
      ctx.session.identity.id,
      ctx.session.resources.artifacts,
    );

    const fullPath = path.join(WORKSPACE_ROOT, input.path);
    await sandbox.writeFile(fullPath, input.content);

    // Sync changes back to artifacts
    await flushToArtifacts(sandbox, ctx.session.resources.artifacts);

    return { success: true };
  },
});
