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

  /**
   * Additional read-only collections to materialize into the workspace at a
   * path prefix. Files from these collections are written on first hydrate
   * and then excluded from flush — changes inside a read-only mount don't
   * propagate back to the source collection. Used for bundling ancillary
   * content like the skills collection's supporting files (scripts,
   * references) at `/workspace/.fsdev/skills/<skill-name>/...`.
   *
   * Each mount's `resolve` function is called per-block-execution with the
   * block context; return the collection or `undefined` to skip the mount.
   * Keeps the bash capability decoupled from scope details — the caller
   * decides where the collection lives.
   */
  readOnlyMounts?: Array<ReadOnlyMount>;

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

/**
 * A read-only collection mounted at a path prefix inside the workspace.
 * Files written from this mount are NOT flushed back to the collection.
 */
export interface ReadOnlyMount {
  /**
   * Resolve the collection from the block context. Return `undefined` to
   * skip this mount for the current invocation (e.g. when the caller hasn't
   * installed the corresponding capability).
   */
  resolve: (ctx: any) => ResourceCollectionRef<JsonObject> | undefined;
  /**
   * Workspace path prefix for this mount, relative to `destination`.
   * E.g. `".fsdev/skills"` mounts at `/workspace/.fsdev/skills/`.
   * Leading/trailing slashes are normalized.
   */
  pathPrefix: string;
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
  /**
   * Normalized workspace path prefixes (without leading or trailing slash)
   * covering read-only mounts. Flush skips files whose relative path starts
   * with any entry here.
   */
  readOnlyPrefixes: string[];
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

/** Strip leading and trailing slashes so concatenation is unambiguous. */
function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

/**
 * Hydrate a read-only mount: materialize the mount's collection entries
 * into the sandbox under `<destination>/<pathPrefix>/<bare-key>`.
 *
 * Files are tracked by their full sandbox-relative path so flush's
 * prefix-exclusion check sees them. We deliberately do not add these paths
 * to `contentHashes` — they must not be flushed back, even on explicit
 * agent edits within the prefix (those edits stay in-sandbox for the
 * lifetime of the session but are not persisted).
 *
 * Entries whose keys begin with `_` are treated as collection-level
 * metadata and skipped (matches the convention of `META_KEY` in
 * `@flow-state-dev/skills`).
 */
async function hydrateReadOnly(
  entry: SandboxEntry,
  collection: ResourceCollectionRef<JsonObject>,
  destination: string,
  pathPrefix: string,
): Promise<void> {
  const collectionPrefix = getPatternPrefix(collection.pattern);
  const mountPrefix = normalizePrefix(pathPrefix);
  if (!mountPrefix) return;

  for (const ref of collection.list()) {
    const bareKey = stripPrefix(ref.name, collectionPrefix);
    // Skip collection metadata entries.
    if (bareKey.startsWith("_")) continue;
    const content = await ref.readContent();
    if (content === null) continue;
    const mountedKey = path.posix.join(mountPrefix, bareKey);
    const fullPath = path.join(destination, mountedKey);
    await entry.sandbox.writeFile(fullPath, content);
  }
}

/**
 * Whether a sandbox-relative path falls inside any configured read-only
 * mount. Matching is exact prefix: `mount/` or the mount itself.
 */
function isUnderReadOnlyMount(
  relativePath: string,
  readOnlyPrefixes: string[],
): boolean {
  for (const prefix of readOnlyPrefixes) {
    if (relativePath === prefix) return true;
    if (relativePath.startsWith(prefix + "/")) return true;
  }
  return false;
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

      // Files inside read-only mounts are hydrated from an external
      // collection and must not propagate back to the primary collection —
      // otherwise an agent reading a skill file and the flush sweep would
      // incorrectly treat it as an artifact.
      if (isUnderReadOnlyMount(relativePath, entry.readOnlyPrefixes)) continue;

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
  //
  // Paths under read-only mounts are excluded here too: we never added
  // them to currentPaths above, so without this guard any primary-
  // collection ref whose bare key falls inside a mount would be deleted
  // on every flush. That would silently drop artifacts the user placed
  // at a coincidentally-colliding path.
  const prefix = getPatternPrefix(collection.pattern);
  for (const ref of collection.list()) {
    const bareKey = stripPrefix(ref.name, prefix);
    if (isUnderReadOnlyMount(bareKey, entry.readOnlyPrefixes)) continue;
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
    readOnlyMounts = [],
    provider = { type: "local" },
    destination = "/workspace",
    createState = () => ({}) as Partial<JsonObject>,
  } = options;

  // Normalize once so hydrate/flush share the same shape.
  const normalizedReadOnlyPrefixes = readOnlyMounts
    .map((mount) => normalizePrefix(mount.pathPrefix))
    .filter((p) => p.length > 0);

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
   *
   * Read-only mounts are materialized after the primary collection so that
   * if a mount's path prefix somehow collides with an existing artifact,
   * the read-only copy wins (intentional — skill bundle files should be
   * stable per-session).
   */
  async function getOrCreate(
    identity: ScopeIdentity,
    collection: ResourceCollectionRef<JsonObject>,
    ctx: any,
  ): Promise<SandboxEntry> {
    // Resolve the registry key first to avoid creating a sandbox we already have
    const scope = provider.type === "local" ? (provider.scope ?? "session") : "session";
    const { key: registryKey } = resolveScopeKey(scope, identity);

    let entry = registry.get(registryKey);
    if (!entry) {
      const sandbox = await createScopedSandbox(provider, identity, destination);
      entry = {
        sandbox,
        hydrated: false,
        contentHashes: new Map(),
        readOnlyPrefixes: normalizedReadOnlyPrefixes,
      };
      registry.set(registryKey, entry);
    }

    if (!entry.hydrated) {
      await hydrate(entry, collection, destination);
      for (const mount of readOnlyMounts) {
        const mountedCollection = mount.resolve(ctx);
        if (!mountedCollection) continue;
        await hydrateReadOnly(entry, mountedCollection, destination, mount.pathPrefix);
      }
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
      const entry = await getOrCreate(getIdentity(ctx), collection, ctx);
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
      const entry = await getOrCreate(getIdentity(ctx), collection, ctx);
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
      const entry = await getOrCreate(getIdentity(ctx), collection, ctx);
      const fullPath = path.join(destination, input.path);
      await entry.sandbox.writeFile(fullPath, input.content);
      await flush(entry, collection, destination, createState);
      return { success: true };
    },
  });

  return { bashCommand, bashReadFile, bashWriteFile };
}
