/**
 * Handler block factory for bash tool blocks.
 *
 * Creates `bashCommand`, `bashReadFile`, and `bashWriteFile` handler blocks
 * that participate in the framework's block system (lifecycle hooks, middleware,
 * items log) rather than running as opaque AI SDK tools inside a generator.
 *
 * The blocks manage a per-session sandbox, hydrate files from a resource
 * collection on first access, and flush changes back after every mutation.
 *
 * @example
 * ```ts
 * import { createBashBlocks } from "@flow-state-dev/tools/bash";
 *
 * const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
 *   sessionResources: artifactResources,
 *   collectionKey: "artifacts",
 *   provider: { type: "local" },
 *   createState: (relativePath) => ({
 *     title: path.basename(relativePath),
 *     updatedAt: Date.now(),
 *   }),
 * });
 * ```
 */

import { handler } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import type {
  ResourceCollectionRef,
  DeclaredResourceEntry,
  JsonObject,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Sandbox, SandboxProvider, WorkspaceScope } from "./types";
import { resolveSandbox } from "./resolve-sandbox";
import { hashContent } from "./hash";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBashBlocksOptions {
  /**
   * Session resource definitions. Each block declares these via `sessionResources`
   * so the framework auto-installs them when the block runs.
   */
  sessionResources: Record<string, DeclaredResourceEntry>;

  /**
   * Key in `sessionResources` for the file collection used to persist workspace
   * files. The collection must support `readContent`/`writeContent` on its refs.
   */
  collectionKey: string;

  /** Sandbox provider. Default: `{ type: "local" }`. */
  provider?: SandboxProvider;

  /** Virtual workspace root visible to the LLM. Default: `"/workspace"`. */
  destination?: string;

  /**
   * Creates initial resource state for files discovered in the sandbox that
   * don't yet have a corresponding resource entry. Called during flush when
   * a new file is found.
   *
   * Default: `() => ({})` — relies on schema defaults.
   */
  createState?: (relativePath: string) => Partial<JsonObject>;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const bashCommandInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

const bashCommandOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

const bashReadFileInputSchema = z.object({
  path: z.string().describe("Path to the file, relative to workspace root"),
});

const bashReadFileOutputSchema = z.object({
  content: z.string(),
});

const bashWriteFileInputSchema = z.object({
  path: z
    .string()
    .describe("Path where the file should be written, relative to workspace root"),
  content: z.string().describe("Content to write to the file"),
});

const bashWriteFileOutputSchema = z.object({
  success: z.boolean(),
});

// ---------------------------------------------------------------------------
// Per-scope sandbox registry
// ---------------------------------------------------------------------------

interface SandboxEntry {
  sandbox: Sandbox;
  hydrated: boolean;
  /** In-memory content hashes for diff-based flush. */
  contentHashes: Map<string, string>;
}

// Module-level registry keyed by scope+scopeId. Entries are lightweight and
// cleaned up implicitly when the process ends. Long-lived deployments
// should use the `persist` option on `createBashTool` instead.
const registry = new Map<string, SandboxEntry>();

/** Identity fields available on the block execution context. */
interface ScopeIdentity {
  sessionId: string;
  userId: string;
  projectId?: string;
}

/**
 * Resolve the workspace scope ID and registry key from context identity.
 *
 * For the `local` provider, also resolves the `cwd` when not explicitly set:
 * `.fsdev/workspaces/{scope}/{scopeId}/`
 */
function resolveScopeKey(scope: WorkspaceScope, identity: ScopeIdentity): { key: string; scopeId: string } {
  switch (scope) {
    case "user":
      return { key: `user:${identity.userId}`, scopeId: identity.userId };
    case "project": {
      const id = identity.projectId ?? identity.sessionId;
      return { key: `project:${id}`, scopeId: id };
    }
    case "session":
    default:
      return { key: `session:${identity.sessionId}`, scopeId: identity.sessionId };
  }
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Create a sandbox for the given provider, resolving the workspace path
 * from the scope identity when no explicit cwd is set.
 */
async function createScopedSandbox(
  provider: SandboxProvider,
  identity: ScopeIdentity,
  destination: string,
): Promise<Sandbox> {
  // For local provider, resolve scoped cwd if not explicitly set
  let cwd: string | undefined;
  if (provider.type === "local" && !provider.cwd) {
    const scope = provider.scope ?? "session";
    const { scopeId } = resolveScopeKey(scope, identity);
    cwd = path.join(process.cwd(), ".fsdev", "workspaces", scope, scopeId);
  }

  const { sandbox } = await resolveSandbox(provider, { destination, cwd });
  return sandbox;
}

/**
 * Strip the collection pattern prefix from a storage key.
 *
 * `ref.name` returns the full storage key (e.g. `"artifacts/my-doc"`).
 * Collection API methods auto-prepend the prefix, so we need bare keys
 * (e.g. `"my-doc"`) for `get`/`create`/`delete` calls and for sandbox paths.
 */
function stripPrefix(name: string, prefix: string): string {
  if (prefix && name.startsWith(prefix + "/")) {
    return name.slice(prefix.length + 1);
  }
  return name;
}

/**
 * Hydrate: materialize all resource entries into the sandbox filesystem.
 *
 * Reads content from each resource ref and writes it to the sandbox under
 * the destination path. The collection pattern prefix is stripped so files
 * live at the workspace root (e.g. `"my-doc.md"` not `"artifacts/my-doc.md"`).
 */
async function hydrate(
  entry: SandboxEntry,
  collection: ResourceCollectionRef<JsonObject>,
  destination: string,
): Promise<void> {
  const prefix = getPatternPrefix(collection.pattern);
  const refs = collection.list();
  for (const ref of refs) {
    const content = await ref.readContent();
    if (content === null) continue;
    const bareKey = stripPrefix(ref.name, prefix);
    const fullPath = path.join(destination, bareKey);
    await entry.sandbox.writeFile(fullPath, content);
    entry.contentHashes.set(bareKey, hashContent(content));
  }
}

/**
 * Flush: sync sandbox filesystem changes back to the resource collection.
 *
 * Walks the workspace via `find`, hashes each file's content, and compares
 * against the in-memory hash map. Changed or new files are upserted;
 * deleted files are removed from the collection.
 */
async function flush(
  entry: SandboxEntry,
  collection: ResourceCollectionRef<JsonObject>,
  destination: string,
  createState: (relativePath: string) => Partial<JsonObject>,
): Promise<void> {

  // Use `find .` so the command works regardless of whether `destination`
  // is a real path (just-bash, Vercel) or a virtual prefix (local-fs).
  const result = await entry.sandbox.executeCommand(
    `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
  );

  // If find fails, skip entirely — do NOT proceed to the deletion loop
  // with an empty currentPaths set, as that would delete all resources.
  if (result.exitCode !== 0) return;

  const currentPaths = new Set<string>();

  if (result.stdout.trim()) {
    const filePaths = result.stdout.trim().split("\n").filter(Boolean);

    for (const foundPath of filePaths) {
      const relativePath = foundPath.startsWith("./")
        ? foundPath.slice(2)
        : foundPath;

      // Skip empty segments (e.g. find returns ".")
      if (!relativePath || relativePath === ".") continue;

      currentPaths.add(relativePath);

      try {
        const fullPath = path.join(destination, relativePath);
        const content = await entry.sandbox.readFile(fullPath);
        const newHash = hashContent(content);
        const oldHash = entry.contentHashes.get(relativePath);

        if (newHash !== oldHash) {
          const existing = collection.getOptional(relativePath);
          if (existing) {
            await existing.writeContent(content);
          } else {
            const ref = await collection.create(
              relativePath,
              createState(relativePath),
            );
            await ref.writeContent(content);
          }
          entry.contentHashes.set(relativePath, newHash);
        }
      } catch {
        // File removed between walk and read — skip
      }
    }
  }

  // Remove resources for files deleted from the sandbox.
  // Strip prefix from ref.name to get the bare key for both the
  // currentPaths lookup and the collection.delete() call.
  const prefix = getPatternPrefix(collection.pattern);
  for (const ref of collection.list()) {
    const bareKey = stripPrefix(ref.name, prefix);
    if (!currentPaths.has(bareKey)) {
      await collection.delete(bareKey);
      entry.contentHashes.delete(bareKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates bash handler blocks backed by a sandbox and synced with a resource
 * collection. Returns three blocks: `bashCommand`, `bashReadFile`, `bashWriteFile`.
 *
 * Each block declares the provided `sessionResources` so the framework
 * auto-installs them. The sandbox is created lazily per session and files
 * are hydrated from the collection on first access.
 */
export function createBashBlocks(options: CreateBashBlocksOptions) {
  const {
    sessionResources,
    collectionKey,
    provider = { type: "local" },
    destination = "/workspace",
    createState = () => ({}) as Partial<JsonObject>,
  } = options;

  /** Extract scope identity from the block execution context. */
  function getIdentity(ctx: any): ScopeIdentity {
    return {
      sessionId: ctx.session.identity.id,
      userId: ctx.session.identity.userId,
      projectId: ctx.session.identity.projectId,
    };
  }

  /**
   * Lazily creates (or retrieves) the sandbox, hydrating resource files
   * on first access. The registry key is scope-dependent (session/user/project).
   */
  async function getOrCreate(
    identity: ScopeIdentity,
    collection: ResourceCollectionRef<JsonObject>,
  ): Promise<SandboxEntry> {
    // Resolve the registry key first to avoid creating a sandbox we already have
    const scope = provider.type === "local" ? (provider.scope ?? "session") : "session";
    const { key: registryKey } = resolveScopeKey(scope, identity);

    let entry = registry.get(registryKey);
    if (!entry) {
      const sandbox = await createScopedSandbox(provider, identity, destination);
      entry = { sandbox, hydrated: false, contentHashes: new Map() };
      registry.set(registryKey, entry);
    }

    if (!entry.hydrated) {
      await hydrate(entry, collection, destination);
      entry.hydrated = true;
    }

    return entry;
  }

  /** Resolves the file collection from the block's execution context. */
  function getCollection(ctx: { session: { resources: Record<string, unknown> } }) {
    return ctx.session.resources[collectionKey] as ResourceCollectionRef<JsonObject>;
  }

  const bashCommand = handler({
    name: "bash",
    description: [
      "Execute a bash command in the workspace.",
      "The workspace is a persistent filesystem scoped to this session.",
      "Use ls or find to explore files.",
      "Files created or modified are automatically saved.",
    ].join(" "),
    inputSchema: bashCommandInputSchema,
    outputSchema: bashCommandOutputSchema,
    sessionResources,

    execute: async (input: z.infer<typeof bashCommandInputSchema>, ctx: any) => {
      const collection = getCollection(ctx);
      const entry = await getOrCreate(getIdentity(ctx), collection);
      const result = await entry.sandbox.executeCommand(input.command);
      await flush(entry, collection, destination, createState);
      return result;
    },
  });

  const bashReadFile = handler({
    name: "bash-read-file",
    description:
      "Read the contents of a file from the workspace filesystem.",
    inputSchema: bashReadFileInputSchema,
    outputSchema: bashReadFileOutputSchema,
    sessionResources,

    execute: async (input: z.infer<typeof bashReadFileInputSchema>, ctx: any) => {
      const collection = getCollection(ctx);
      const entry = await getOrCreate(getIdentity(ctx), collection);
      const fullPath = path.join(destination, input.path);
      const content = await entry.sandbox.readFile(fullPath);
      return { content };
    },
  });

  const bashWriteFile = handler({
    name: "bash-write-file",
    description:
      "Write content to a file in the workspace. Creates parent directories if needed. The file is automatically saved.",
    inputSchema: bashWriteFileInputSchema,
    outputSchema: bashWriteFileOutputSchema,
    sessionResources,

    execute: async (input: z.infer<typeof bashWriteFileInputSchema>, ctx: any) => {
      const collection = getCollection(ctx);
      const entry = await getOrCreate(getIdentity(ctx), collection);
      const fullPath = path.join(destination, input.path);
      await entry.sandbox.writeFile(fullPath, input.content);
      await flush(entry, collection, destination, createState);
      return { success: true };
    },
  });

  return { bashCommand, bashReadFile, bashWriteFile };
}
