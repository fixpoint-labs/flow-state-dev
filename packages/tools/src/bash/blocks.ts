/**
 * Handler block factory for bash tool blocks.
 *
 * Creates `bashCommand`, `bashReadFile`, and `bashWriteFile` handler blocks
 * that participate in the framework's block system (lifecycle hooks, middleware,
 * items log) rather than running as opaque AI SDK tools inside a generator.
 *
 * The blocks manage a per-session sandbox. On first access the sandbox is
 * auto-populated from the block's resource context: every
 * `ResourceCollectionRef` present on the unified `ctx.resources` registry
 * is mounted at its pattern prefix (e.g. `artifacts/**` at
 * `/workspace/artifacts/`, `skills/**` at `/workspace/skills/`). Writes
 * are routed back to the owning collection on flush based on longest
 * path-prefix match.
 *
 * Files written outside any mount's prefix, except for the conventional
 * scratch directory `./tmp/`, are dropped on flush with a console warning.
 *
 * @example
 * ```ts
 * import { createBashBlocks } from "@flow-state-dev/tools/bash";
 *
 * // Zero config — discovers whatever collections are installed on the block.
 * const { bashCommand } = createBashBlocks({
 *   provider: { type: "local" },
 * });
 *
 * // Or narrow explicitly:
 * const { bashCommand } = createBashBlocks({
 *   provider: { type: "local" },
 *   collections: ["artifacts", { key: "skills", writable: false }],
 * });
 * ```
 */

import { handler } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import type {
  ResourceCollectionRef,
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

/**
 * A collection selection entry. A bare string is shorthand for `{ key, writable: true }`.
 */
export type BashCollectionSpec = string | { key: string; writable?: boolean };

export interface CreateBashBlocksOptions {
  /**
   * Explicit list of collections to mount. Each entry is either a key (string)
   * or `{ key, writable }`. When provided, ONLY these collections are mounted
   * and `exclude` is ignored.
   *
   * When omitted (the default), bash auto-discovers every collection present
   * on the block's runtime resource context — any `ResourceCollectionRef` on
   * `ctx.resources` is mounted at its pattern prefix.
   */
  collections?: BashCollectionSpec[];

  /**
   * Keys to skip during auto-discovery. Useful when you want "everything
   * except X". Ignored when `collections` is set explicitly.
   */
  exclude?: string[];

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

/** A single mounted collection inside the bash workspace. */
interface Mount {
  collection: ResourceCollectionRef<JsonObject>;
  /** Registered accessor key on ctx.resources. Used for logging/diagnostics. */
  key: string;
  /** Pattern prefix — the collection's natural path inside the workspace. */
  prefix: string;
  /** Flush behavior. Default true. */
  writable: boolean;
}

interface SandboxEntry {
  sandbox: Sandbox;
  hydrated: boolean;
  /** Content hashes keyed by sandbox-relative path (e.g. "artifacts/foo.md"). */
  contentHashes: Map<string, string>;
  /** Mounts resolved at hydrate time, ordered longest-prefix-first. */
  mounts: Mount[];
}

// Module-level registry keyed by scope+scopeId. Entries are lightweight and
// cleaned up implicitly when the process ends.
const registry = new Map<string, SandboxEntry>();

/** Identity fields available on the block execution context. */
interface ScopeIdentity {
  sessionId: string;
  userId: string;
  orgId?: string;
}

/** Reserved workspace subdirectory for agent scratch space. Never persisted. */
const TMP_DIR = "tmp";

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
    case "org": {
      const id = identity.orgId ?? identity.sessionId;
      return { key: `org:${id}`, scopeId: id };
    }
    case "session":
    default:
      return { key: `session:${identity.sessionId}`, scopeId: identity.sessionId };
  }
}

// ---------------------------------------------------------------------------
// Mount discovery
// ---------------------------------------------------------------------------

/** Duck-type check: is this entry on ctx.*.resources a collection ref? */
function isCollectionRef(value: unknown): value is ResourceCollectionRef<JsonObject> {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pattern === "string" && typeof v.list === "function";
}

/**
 * Discover every `ResourceCollectionRef` installed on the block context,
 * optionally narrowed by an explicit `collections` spec or an `exclude` list.
 *
 * Ordering matters for longest-prefix-first matching at flush time: nested
 * prefixes (e.g. `a/b/**`) must be checked before their parents (`a/**`).
 * Sort descending by prefix length.
 */
function discoverMounts(
  ctx: any,
  explicit: BashCollectionSpec[] | undefined,
  exclude: string[] | undefined,
): Mount[] {
  const excludeSet = new Set(exclude ?? []);
  const specs = explicit?.map(normalizeSpec);
  const wantByKey = specs ? new Map(specs.map((s) => [s.key, s])) : undefined;

  const seen = new Set<string>();
  const mounts: Mount[] = [];

  const bag = ctx?.resources;
  if (bag && typeof bag === "object") {
    for (const [key, value] of Object.entries(bag)) {
      // Skip the registry's own helper functions (`get`, `list`).
      if (typeof value === "function") continue;
      if (wantByKey) {
        if (!wantByKey.has(key)) continue;
      } else if (excludeSet.has(key)) {
        continue;
      }
      if (seen.has(key)) continue;
      if (!isCollectionRef(value)) continue;
      const prefix = getPatternPrefix(value.pattern);
      // Collections without a meaningful prefix (e.g. pattern "*" at root)
      // would collide with orphan writes — require a prefix to mount.
      if (!prefix || prefix === TMP_DIR) continue;
      const spec = wantByKey?.get(key);
      mounts.push({
        collection: value,
        key,
        prefix,
        writable: spec?.writable ?? true,
      });
      seen.add(key);
    }
  }

  if (wantByKey) {
    // Warn on explicit keys that weren't found in ctx — usually a config mistake.
    for (const [key] of wantByKey) {
      if (!seen.has(key)) {
        console.warn(
          `[bash] collection "${key}" was requested but not found on ctx.resources — skipped`,
        );
      }
    }
  }

  // Longest-prefix-first so nested mounts match before their parent.
  mounts.sort((a, b) => b.prefix.length - a.prefix.length);
  return mounts;
}

function normalizeSpec(spec: BashCollectionSpec): { key: string; writable?: boolean } {
  return typeof spec === "string" ? { key: spec } : spec;
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle helpers
// ---------------------------------------------------------------------------

async function createScopedSandbox(
  provider: SandboxProvider,
  identity: ScopeIdentity,
  destination: string,
): Promise<Sandbox> {
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
 * Strip a mount's pattern prefix from a resource ref's full storage key.
 * `ref.name` is `"artifacts/foo.md"`; stripping `"artifacts"` gives `"foo.md"`.
 */
function stripMountPrefix(name: string, prefix: string): string {
  if (prefix && name.startsWith(prefix + "/")) {
    return name.slice(prefix.length + 1);
  }
  return name;
}

/** Match a sandbox-relative path to a mount via prefix. Mounts are pre-sorted longest-first. */
function findMount(relativePath: string, mounts: Mount[]): Mount | undefined {
  for (const mount of mounts) {
    if (relativePath === mount.prefix) return mount;
    if (relativePath.startsWith(mount.prefix + "/")) return mount;
  }
  return undefined;
}

function isUnderTmp(relativePath: string): boolean {
  return relativePath === TMP_DIR || relativePath.startsWith(TMP_DIR + "/");
}

// ---------------------------------------------------------------------------
// Hydrate / flush
// ---------------------------------------------------------------------------

/**
 * Hydrate: materialize every mount's resource entries into the sandbox.
 *
 * Files are written at `<destination>/<mount.prefix>/<bare-key>`. Content
 * hashes are recorded against the sandbox-relative path so flush can detect
 * in-place edits later.
 *
 * Also seeds the scratch directory `<destination>/tmp/` with an empty marker
 * so the agent has a well-known place to drop files it doesn't want persisted.
 */
async function hydrate(entry: SandboxEntry, destination: string): Promise<void> {
  // Seed the scratch directory. Empty marker file keeps the dir visible to
  // `ls` and makes guidance text honest — `./tmp/` really exists.
  const tmpMarker = path.join(destination, TMP_DIR, ".keep");
  await entry.sandbox.writeFile(tmpMarker, "");

  for (const mount of entry.mounts) {
    const refs = mount.collection.list();
    for (const ref of refs) {
      const bareKey = stripMountPrefix(ref.name, mount.prefix);
      // Skip collection-level metadata entries (e.g. _meta in skills).
      if (bareKey.startsWith("_")) continue;
      const content = await ref.readContent();
      if (content === null) continue;
      const mountedKey = path.posix.join(mount.prefix, bareKey);
      const fullPath = path.join(destination, mountedKey);
      await entry.sandbox.writeFile(fullPath, content);
      if (mount.writable) {
        entry.contentHashes.set(mountedKey, hashContent(content));
      }
    }
  }
}

/**
 * Flush: sync sandbox changes back to their owning collections.
 *
 * Routes each found file to the mount whose prefix it lives under:
 *   - Matching writable mount → upsert with prefix stripped.
 *   - Matching read-only mount → skip (edits stay local to the sandbox).
 *   - `./tmp/...` → skip silently (scratch space).
 *   - No matching mount → drop, collected and logged at the end.
 *
 * Per-mount deletion: refs whose bare key isn't in the current sandbox walk
 * are removed from their collection.
 */
async function flush(
  entry: SandboxEntry,
  destination: string,
  createState: (relativePath: string) => Partial<JsonObject>,
): Promise<void> {
  const result = await entry.sandbox.executeCommand(
    `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
  );

  // If find fails, skip entirely — NEVER proceed to the deletion loop with
  // an empty set, which would drop everything.
  if (result.exitCode !== 0) return;

  // Track which sandbox-relative paths we saw, keyed by mount prefix for
  // the per-mount deletion pass below.
  const seenByMountKey = new Map<string, Set<string>>();
  for (const mount of entry.mounts) seenByMountKey.set(mount.key, new Set());

  const orphans: string[] = [];

  if (result.stdout.trim()) {
    const filePaths = result.stdout.trim().split("\n").filter(Boolean);

    for (const foundPath of filePaths) {
      const relativePath = foundPath.startsWith("./")
        ? foundPath.slice(2)
        : foundPath;
      if (!relativePath || relativePath === ".") continue;
      if (isUnderTmp(relativePath)) continue;

      const mount = findMount(relativePath, entry.mounts);
      if (!mount) {
        orphans.push(relativePath);
        continue;
      }

      const bareKey = stripMountPrefix(relativePath, mount.prefix);
      seenByMountKey.get(mount.key)!.add(bareKey);

      if (!mount.writable) continue;

      try {
        const fullPath = path.join(destination, relativePath);
        const content = await entry.sandbox.readFile(fullPath);
        const newHash = hashContent(content);
        const oldHash = entry.contentHashes.get(relativePath);

        if (newHash !== oldHash) {
          const existing = mount.collection.getOptional(bareKey);
          if (existing) {
            await existing.writeContent(content);
          } else {
            const ref = await mount.collection.create(
              bareKey,
              createState(relativePath),
            );
            await ref.writeContent(content);
          }
          entry.contentHashes.set(relativePath, newHash);
        }
      } catch {
        // File removed between walk and read — skip.
      }
    }
  }

  // Per-mount deletion pass.
  for (const mount of entry.mounts) {
    if (!mount.writable) continue;
    const seen = seenByMountKey.get(mount.key)!;
    for (const ref of mount.collection.list()) {
      const bareKey = stripMountPrefix(ref.name, mount.prefix);
      // Skip collection metadata — never deletable via bash sweep.
      if (bareKey.startsWith("_")) continue;
      if (!seen.has(bareKey)) {
        await mount.collection.delete(bareKey);
        entry.contentHashes.delete(path.posix.join(mount.prefix, bareKey));
      }
    }
  }

  if (orphans.length > 0) {
    console.warn(
      `[bash] dropped ${orphans.length} orphan file(s) not under any mounted collection (or ./${TMP_DIR}/): ${orphans.join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates bash handler blocks backed by a sandbox and synced with collections
 * auto-discovered from the block's resource context. Returns three blocks:
 * `bashCommand`, `bashReadFile`, `bashWriteFile`.
 *
 * The sandbox is created lazily per session and collections are mounted at
 * their pattern prefixes on first access. See the module docstring for the
 * full path layout and write-back rules.
 */
export function createBashBlocks(options: CreateBashBlocksOptions = {}) {
  const {
    collections,
    exclude,
    provider = { type: "local" },
    destination = "/workspace",
    createState = () => ({}) as Partial<JsonObject>,
  } = options;

  function getIdentity(ctx: any): ScopeIdentity {
    return {
      sessionId: ctx.session.identity.id,
      userId: ctx.session.identity.userId,
      orgId: ctx.session.identity.orgId,
    };
  }

  async function getOrCreate(ctx: any): Promise<SandboxEntry> {
    const identity = getIdentity(ctx);
    const scope = provider.type === "local" ? (provider.scope ?? "session") : "session";
    const { key: registryKey } = resolveScopeKey(scope, identity);

    let entry = registry.get(registryKey);
    if (!entry) {
      const sandbox = await createScopedSandbox(provider, identity, destination);
      const mounts = discoverMounts(ctx, collections, exclude);
      entry = {
        sandbox,
        hydrated: false,
        contentHashes: new Map(),
        mounts,
      };
      registry.set(registryKey, entry);
    }

    if (!entry.hydrated) {
      await hydrate(entry, destination);
      entry.hydrated = true;
    }

    return entry;
  }

  const bashCommand = handler({
    name: "bash",
    description: [
      "Execute a bash command in the workspace.",
      "The workspace is a persistent filesystem scoped to this session.",
      "Use ls or find to explore files.",
      "Files created or modified under a mounted collection's directory are automatically saved;",
      `files under ./${TMP_DIR}/ are scratch space and are never saved.`,
    ].join(" "),
    inputSchema: bashCommandInputSchema,
    outputSchema: bashCommandOutputSchema,

    execute: async (input: z.infer<typeof bashCommandInputSchema>, ctx: any) => {
      const entry = await getOrCreate(ctx);
      const result = await entry.sandbox.executeCommand(input.command);
      await flush(entry, destination, createState);
      return result;
    },
  });

  const bashReadFile = handler({
    name: "bash-read-file",
    description: "Read the contents of a file from the workspace filesystem.",
    inputSchema: bashReadFileInputSchema,
    outputSchema: bashReadFileOutputSchema,

    execute: async (input: z.infer<typeof bashReadFileInputSchema>, ctx: any) => {
      const entry = await getOrCreate(ctx);
      const fullPath = path.join(destination, input.path);
      const content = await entry.sandbox.readFile(fullPath);
      return { content };
    },
  });

  const bashWriteFile = handler({
    name: "bash-write-file",
    description: [
      "Write content to a file in the workspace.",
      "Creates parent directories if needed.",
      "Files under a mounted collection's directory are saved automatically;",
      `files under ./${TMP_DIR}/ are scratch; files anywhere else are dropped.`,
    ].join(" "),
    inputSchema: bashWriteFileInputSchema,
    outputSchema: bashWriteFileOutputSchema,

    execute: async (input: z.infer<typeof bashWriteFileInputSchema>, ctx: any) => {
      const entry = await getOrCreate(ctx);
      const fullPath = path.join(destination, input.path);
      await entry.sandbox.writeFile(fullPath, input.content);
      await flush(entry, destination, createState);
      return { success: true };
    },
  });

  return { bashCommand, bashReadFile, bashWriteFile };
}
