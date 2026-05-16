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

import { handler, sequencer } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";
import type {
  BlockContext,
  ResourceCollectionRef,
  JsonObject,
} from "@flow-state-dev/core/types";
import { z } from "zod";
import type { Sandbox, SandboxProvider, WorkspaceScope } from "./types";
import { resolveSandbox } from "./resolve-sandbox";
import { hashContent } from "./hash";
import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { quote as shellQuote } from "shell-quote";
import { purgeOldRuns } from "./adapters/moat";

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
  path: z
    .string()
    .describe(
      "Path to the file, relative to workspace root (e.g. `artifacts/foo.md`). Don't prefix with `/workspace`.",
    ),
});

const bashReadFileOutputSchema = z.object({
  content: z.string(),
});

const bashWriteFileInputSchema = z.object({
  path: z
    .string()
    .describe(
      "Path where the file should be written, relative to workspace root (e.g. `artifacts/foo.md`). Don't prefix with `/workspace`.",
    ),
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

/**
 * Registry value: either a resolved entry or a pending-promise wrapper. The
 * pending wrapper closes a check-then-set race in `getOrCreate`: without it,
 * two concurrent callers for the same key both see a miss, both spawn a
 * sandbox, and the second `set` clobbers the first — leaking the original
 * (unreachable via `releaseBashSandbox`). Harmless for cheap adapters,
 * orphans whole containers under the MOAT adapter.
 */
type RegistryValue = SandboxEntry | { pending: Promise<SandboxEntry> };

// Module-level registry keyed by scope+scopeId. Entries are lightweight and
// cleaned up implicitly when the process ends — or eagerly via
// `releaseBashSandbox`, typically wired through the bash capability's
// `cleanupBlock` into `defineFlow({ request: { onFinished } })`.
const registry = new Map<string, RegistryValue>();

function isPending(value: RegistryValue): value is { pending: Promise<SandboxEntry> } {
  return (value as { pending?: Promise<SandboxEntry> }).pending !== undefined;
}

/** Identity fields available on the block execution context. */
interface ScopeIdentity {
  sessionId: string;
  userId: string;
  orgId?: string;
}

/** Reserved workspace subdirectory for agent scratch space. Never persisted. */
const TMP_DIR = "tmp";

/** Per-session host dir backing the container's `/workspace`, mirroring `local`'s layout. */
function defaultMoatWorkspace(sessionId: string): string {
  return path.join(process.cwd(), ".fsdev", "workspaces", "session", sessionId);
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

  // MOAT defaults: per-session runName + workspace + persist=true.
  // Workspace mirrors `local`'s layout. Persist avoids per-tool-call
  // cold boots (~10–30s) and the apple-runtime mount race that
  // surfaces as `ls` EPERM. `frameworkManaged` lets the resolver
  // overwrite our own yaml freely.
  let frameworkManaged = false;
  if (provider.type === "moat") {
    const sessionId = identity.sessionId;
    const overrides: Partial<typeof provider> = {};
    if (!provider.runName) overrides.runName = `fsdev-${sessionId}`;
    if (!provider.workspace) {
      overrides.workspace = defaultMoatWorkspace(sessionId);
      frameworkManaged = true;
    }
    if (provider.persist === undefined) overrides.persist = true;
    if (Object.keys(overrides).length > 0) {
      provider = { ...provider, ...overrides };
    }
    if (provider.workspace) {
      await fs.mkdir(provider.workspace, { recursive: true });
    }
  }

  const { sandbox } = await resolveSandbox(provider, {
    destination,
    cwd,
    frameworkManaged,
  });
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

/**
 * Provider types whose sandbox is *not* immediately reachable on every
 * call — they need an explicit "ensure the sandbox is up" step before
 * the first command can run. `local` and `just-bash` are always
 * reachable (host filesystem or in-process WASM); `moat`, `vercel`, and
 * `upstash` need to spin up a container or instance.
 *
 * Drives the block-factory decision: setup-needing providers compose
 * their blocks as `sequencer().tapIf(isCold, ensureSandbox).then(leaf)`
 * so the user sees status updates during the cold path. Other providers
 * return leaf handlers directly — no sequencer wrapper, no extra trace
 * node, no per-call probe.
 */
function providerNeedsSetup(provider: SandboxProvider): boolean {
  return (
    provider.type === "moat" ||
    provider.type === "vercel" ||
    provider.type === "upstash"
  );
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
    // Guarantee the mount-prefix directory exists even when the
    // collection has no refs yet — `flush`'s `find` is scoped to these
    // paths and would error on a missing one. The `.keep` marker is
    // stripped from the walk because flush skips dotfiles via its
    // existing mount-prefix matching (the marker has no bare key).
    const markerPath = path.join(destination, mount.prefix, ".keep");
    await entry.sandbox.writeFile(markerPath, "");

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
  // Discover the files currently present under each mount prefix. Two
  // walk implementations: host-fs (fast, no IPC) for bind-mount providers
  // that expose `hostMountSource`; `find` via `executeCommand` for the
  // others (Vercel, Upstash) where the only way to see the sandbox fs
  // is through the adapter's SDK.
  const filePaths = entry.sandbox.hostMountSource
    ? await walkMountsViaHostFs(entry, entry.sandbox.hostMountSource)
    : await walkMountsViaExec(entry);
  if (filePaths === null) return;

  // Diagnostic: a successful flush that sees ZERO files when writable
  // mounts are present often means the agent's writes landed at a
  // path the walk didn't visit — either MOAT's bind-mount target
  // mismatch, or the agent used absolute paths under a different
  // prefix. Without this log, "my artifact didn't appear" is an
  // invisible failure (no warn, no exception).
  if (filePaths.length === 0 && entry.mounts.some((m) => m.writable)) {
    const summary = entry.mounts
      .filter((m) => m.writable)
      .map((m) => m.prefix)
      .join(", ");
    const source = entry.sandbox.hostMountSource
      ? ` (host walk under ${entry.sandbox.hostMountSource})`
      : "";
    console.warn(
      `[bash] flush walk found 0 files under writable mounts (${summary})${source}. If the agent just wrote a file, check that it landed under one of these prefixes.`,
    );
  }

  // Track which sandbox-relative paths we saw, keyed by mount prefix for
  // the per-mount deletion pass below.
  const seenByMountKey = new Map<string, Set<string>>();
  for (const mount of entry.mounts) seenByMountKey.set(mount.key, new Set());

  const orphans: string[] = [];

  for (const relativePath of filePaths) {
    if (!relativePath || relativePath === ".") continue;
    if (isUnderTmp(relativePath)) continue;

    const mount = findMount(relativePath, entry.mounts);
    if (!mount) {
      orphans.push(relativePath);
      continue;
    }

    const bareKey = stripMountPrefix(relativePath, mount.prefix);
    // Skip framework-internal markers (e.g. the `.keep` seeded by
    // hydrate to guarantee the directory exists for the walk).
    if (bareKey === ".keep") continue;
    seenByMountKey.get(mount.key)!.add(bareKey);

    if (!mount.writable) continue;

    try {
      const fullPath = path.join(destination, relativePath);
      const content = await entry.sandbox.readFile(fullPath);
      const newHash = hashContent(content);
      const oldHash = entry.contentHashes.get(relativePath);

      if (newHash !== oldHash) {
        await upsertCollectionEntry(mount, bareKey, content, createState(relativePath));
        entry.contentHashes.set(relativePath, newHash);
      }
    } catch {
      // File removed between walk and read — skip.
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

/**
 * Mount-prefix walk via `find` through the sandbox's exec channel.
 * Returns `null` on failure — caller skips flush so a transient walk
 * error never triggers the deletion pass with an empty seen-set.
 */
async function walkMountsViaExec(entry: SandboxEntry): Promise<string[] | null> {
  const walkPrefixes = [...entry.mounts.map((m) => `./${m.prefix}`), `./${TMP_DIR}`];
  const result = await entry.sandbox.executeCommand(
    `find ${walkPrefixes.map((p) => JSON.stringify(p)).join(" ")} -type f 2>/dev/null`,
  );
  if (result.exitCode !== 0) return null;
  if (!result.stdout.trim()) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((p) => (p.startsWith("./") ? p.slice(2) : p));
}

/**
 * Mount-prefix walk via direct host fs. Faster than `find` through
 * `executeCommand` because there's no IPC round-trip — same filesystem
 * as the container sees through the bind mount. Reads every mount's
 * prefix dir under the host source.
 */
async function walkMountsViaHostFs(
  entry: SandboxEntry,
  hostMountSource: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const mount of entry.mounts) {
    const root = path.join(hostMountSource, mount.prefix);
    try {
      const dirents = await fs.readdir(root, { recursive: true, withFileTypes: true });
      for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        // `dirent.parentPath` is the absolute dir under `root`; build the
        // sandbox-relative path back from the mount prefix + remainder.
        const parent = (dirent as Dirent & { parentPath?: string }).parentPath
          ?? path.join(root, "");
        const rel = path.relative(root, path.join(parent, dirent.name));
        out.push(path.posix.join(mount.prefix, rel.split(path.sep).join("/")));
      }
    } catch (err) {
      // Mount dir missing — hydrate guarantees it, but treat as empty.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return out;
}

/**
 * Inline single-file routing — used by `bashWriteFile` under bind-mount
 * providers where the write went directly to the host filesystem and
 * we already know which file changed. No walk, no deletion pass, no
 * hash diff: route the one file to its owning mount and upsert.
 *
 * Drops the file silently if it's outside any mount prefix and not
 * under `./tmp/`, matching `flush`'s orphan behavior (with a log).
 */
/**
 * Upsert one collection entry: `getOrCreate` + `patchState` + `writeContent`,
 * matching the framework's `upsertResource` utility. Anything else (e.g.
 * `create` without `patchState`) doesn't reliably propagate content to
 * client snapshots.
 */
async function upsertCollectionEntry(
  mount: Mount,
  bareKey: string,
  content: string,
  initial: Partial<JsonObject>,
): Promise<void> {
  const ref = await mount.collection.getOrCreate(bareKey, initial);
  await ref.patchState(initial);
  await ref.writeContent(content);
}

async function routeWrittenFile(
  entry: SandboxEntry,
  relativePath: string,
  content: string,
  createState: (relativePath: string) => Partial<JsonObject>,
): Promise<void> {
  // The model often supplies `./artifacts/foo.md` even though the
  // schema says paths are workspace-relative. Strip the leading `./`
  // so `findMount`/`isUnderTmp` (which match bare prefixes) work.
  if (relativePath.startsWith("./")) {
    relativePath = relativePath.slice(2);
  }
  if (isUnderTmp(relativePath)) return;
  const mount = findMount(relativePath, entry.mounts);
  if (!mount) {
    console.warn(
      `[bash] dropped orphan write at "${relativePath}" — not under any mounted collection or ./${TMP_DIR}/`,
    );
    return;
  }
  if (!mount.writable) return;
  const bareKey = stripMountPrefix(relativePath, mount.prefix);
  if (bareKey === ".keep" || bareKey.startsWith("_")) return;
  const newHash = hashContent(content);
  if (entry.contentHashes.get(relativePath) === newHash) return;
  await upsertCollectionEntry(mount, bareKey, content, createState(relativePath));
  entry.contentHashes.set(relativePath, newHash);
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

  async function getOrCreate(ctx: any): Promise<SandboxEntry> {
    const identity = getIdentity(ctx);
    const scope = provider.type === "local" ? (provider.scope ?? "session") : "session";
    const { key: registryKey } = resolveScopeKey(scope, identity);

    const existing = registry.get(registryKey);
    let entry: SandboxEntry;
    if (existing) {
      entry = isPending(existing) ? await existing.pending : existing;
    } else {
      // Install a pending placeholder *before* awaiting so concurrent callers
      // for the same key share a single in-flight sandbox creation.
      const pending = (async () => {
        const sandbox = await createScopedSandbox(provider, identity, destination);
        const mounts = discoverMounts(ctx, collections, exclude);
        const created: SandboxEntry = {
          sandbox,
          hydrated: false,
          contentHashes: new Map(),
          mounts,
        };
        registry.set(registryKey, created);
        return created;
      })();
      registry.set(registryKey, { pending });
      try {
        entry = await pending;
      } catch (err) {
        // Clear the placeholder so a subsequent call can retry.
        registry.delete(registryKey);
        throw err;
      }
    }

    if (!entry.hydrated) {
      await hydrate(entry, destination);
      entry.hydrated = true;
    }

    return entry;
  }

  const needsSetup = providerNeedsSetup(provider);
  const isHostMountProvider = provider.type === "moat";

  // Cold-vs-warm predicate. Registry has no entry for this scope yet →
  // the next call must boot/connect the sandbox. Cheap: just a Map.has.
  const isCold = (_value: unknown, ctx: BlockContext): boolean => {
    const identity = getIdentity(ctx as any);
    const scope =
      provider.type === "local" ? (provider.scope ?? "session") : "session";
    return !registry.has(resolveScopeKey(scope, identity).key);
  };

  // Setup tap, gated by `tapIf(isCold, ...)` so it's invisible on
  // warm paths. The status message covers the worst case (cold image
  // build); reconnects complete fast enough that the user just sees a
  // brief "Preparing…" before the leaf runs.
  const ensureSandbox = needsSetup
    ? handler({
        name: "bash-ensure-sandbox",
        inputSchema: z.any(),
        outputSchema: z.any(),
        activeStatusMessage:
          provider.type === "moat"
            ? "Preparing bash sandbox (first run can take 30–60s while the image builds)…"
            : "Preparing bash sandbox…",
        execute: async (input: unknown, ctx: any) => {
          await getOrCreate(ctx);
          return input;
        },
      })
    : null;

  // Background purge of stale framework-managed MOAT containers.
  // Dispatched via `.workIf(isCold, ...)` so it runs in parallel with
  // the cold-boot ensureSandbox step and never appears on warm paths.
  // Bounded by `DEFAULT_MAX_CONTAINERS` (50); excess oldest-first.
  const purgeStaleContainers = provider.type === "moat"
    ? handler({
        name: "bash-purge-stale-containers",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (input: unknown, ctx: any) => {
          const runName =
            provider.runName ?? `fsdev-${getIdentity(ctx).sessionId}`;
          const { destroyed } = await purgeOldRuns({
            runName,
            bin: provider.bin,
            workspace: provider.workspace,
            runtime: provider.runtime,
          });
          if (destroyed.length > 0) {
            console.error(
              `[moat] purged ${destroyed.length} stale container(s): ${destroyed.join(", ")}`,
            );
          }
          return input;
        },
      })
    : null;

  // -------------------------------------------------------------------
  // Leaf handlers — the actual operations. Used directly for fast
  // providers (`local`, `just-bash`, `custom`) and wrapped under a
  // sequencer for setup-needing providers (MOAT, Vercel, Upstash).
  // -------------------------------------------------------------------

  const bashCommandDescription = [
    "Execute a bash command. Your current directory is the workspace root —",
    "use relative paths (`artifacts/foo.md`, `./tmp/scratch.txt`), not absolute",
    "paths under any special prefix. The workspace is a persistent filesystem",
    "scoped to this session. Files created or modified under a mounted",
    "collection's directory are automatically saved;",
    `files under ./${TMP_DIR}/ are scratch space and are never saved.`,
  ].join(" ");

  // Auto-prepend `cd <destination> &&` so PWD is always the workspace
  // root and the agent can use relative paths without knowing about
  // `/workspace`. Quoting via shell-quote handles paths with spaces.
  const cdPrefix = `${shellQuote(["cd", destination])} && `;

  const bashCommandLeaf = handler({
    name: needsSetup ? "bash-exec" : "bash",
    description: bashCommandDescription,
    inputSchema: bashCommandInputSchema,
    outputSchema: bashCommandOutputSchema,
    execute: async (input: z.infer<typeof bashCommandInputSchema>, ctx: any) => {
      const entry = await getOrCreate(ctx);
      const result = await entry.sandbox.executeCommand(cdPrefix + input.command);
      await flush(entry, destination, createState);
      return result;
    },
  });

  const bashReadFileLeaf = handler({
    name: needsSetup ? "bash-read-file-exec" : "bash-read-file",
    description: [
      "Read the contents of a file in the workspace.",
      "`path` is relative to the workspace root (e.g. `artifacts/foo.md`,",
      "`./tmp/notes.txt`). Don't prefix with `/workspace`.",
    ].join(" "),
    inputSchema: bashReadFileInputSchema,
    outputSchema: bashReadFileOutputSchema,
    execute: async (input: z.infer<typeof bashReadFileInputSchema>, ctx: any) => {
      const entry = await getOrCreate(ctx);
      const fullPath = path.join(destination, input.path);
      const content = await entry.sandbox.readFile(fullPath);
      return { content };
    },
  });

  const bashWriteFileDescription = [
    "Write content to a file in the workspace.",
    "`path` is relative to the workspace root (e.g. `artifacts/foo.md`,",
    "`./tmp/notes.txt`). Don't prefix with `/workspace`.",
    "Creates parent directories if needed.",
    "Files under a mounted collection's directory are saved automatically;",
    `files under ./${TMP_DIR}/ are scratch; files anywhere else are dropped.`,
  ].join(" ");

  // bashWriteFile fast-path for bind-mount providers: write directly
  // to host fs and route into the collection, without cold-booting
  // the container. The mount source must be resolvable from provider
  // config alone (no SandboxEntry required) — currently MOAT only.
  const bashWriteFileHostFsLeaf = handler({
    name: "bash-write-file",
    description: bashWriteFileDescription,
    inputSchema: bashWriteFileInputSchema,
    outputSchema: bashWriteFileOutputSchema,
    execute: async (
      input: z.infer<typeof bashWriteFileInputSchema>,
      ctx: any,
    ) => {
      const hostMountSource = resolveHostMountSourceForWrite(provider, ctx)!;
      const hostPath = path.join(hostMountSource, input.path);
      await fs.mkdir(path.dirname(hostPath), { recursive: true });
      await fs.writeFile(hostPath, input.content, "utf-8");
      // Build a routing-only `SandboxEntry` from ctx if no live one
      // exists. `routeWrittenFile` only reads `mounts`/`contentHashes`,
      // so the `sandbox` field is never dereferenced.
      const cached = registry.get(
        resolveScopeKey("session", getIdentity(ctx)).key,
      );
      const liveEntry = cached && !isPending(cached) ? cached : null;
      const mounts = liveEntry?.mounts ?? discoverMounts(ctx, collections, exclude);
      if (mounts.length === 0) {
        console.warn(
          `[bash] bash-write-file at "${input.path}" found no mounted collections on ctx.resources — file written to host fs but NOT routed into any collection. Wire the bash capability alongside the artifact/skills capabilities on this generator.`,
        );
      }
      const entry: SandboxEntry = liveEntry ?? {
        sandbox: {} as Sandbox,
        hydrated: false,
        contentHashes: new Map(),
        mounts,
      };
      await routeWrittenFile(entry, input.path, input.content, createState);
      return { success: true };
    },
  });

  const bashWriteFileSandboxLeaf = handler({
    name: needsSetup ? "bash-write-file-exec" : "bash-write-file",
    description: bashWriteFileDescription,
    inputSchema: bashWriteFileInputSchema,
    outputSchema: bashWriteFileOutputSchema,
    execute: async (
      input: z.infer<typeof bashWriteFileInputSchema>,
      ctx: any,
    ) => {
      const entry = await getOrCreate(ctx);
      const fullPath = path.join(destination, input.path);
      await entry.sandbox.writeFile(fullPath, input.content);
      await routeWrittenFile(entry, input.path, input.content, createState);
      return { success: true };
    },
  });

  if (!needsSetup) {
    return {
      bashCommand: bashCommandLeaf,
      bashReadFile: bashReadFileLeaf,
      bashWriteFile: bashWriteFileSandboxLeaf,
    };
  }

  // Setup-needing providers: `tapIf(isCold, ...)` only emits the
  // ensureSandbox node on the cold path. The purge sidechain (MOAT
  // only) runs in parallel via `.workIf(isCold, ...)` — fire-and-forget
  // so it never blocks the leaf.
  const withColdSetup = <T extends { workIf: any; tapIf: any }>(s: T): T => {
    const stepA = purgeStaleContainers
      ? s.workIf(isCold, purgeStaleContainers)
      : s;
    return stepA.tapIf(isCold, ensureSandbox!) as T;
  };

  const bashCommand = withColdSetup(
    sequencer({
      name: "bash",
      description: bashCommandDescription,
      inputSchema: bashCommandInputSchema,
      outputSchema: bashCommandOutputSchema,
    }),
  ).then(bashCommandLeaf);

  const bashReadFile = withColdSetup(
    sequencer({
      name: "bash-read-file",
      description: "Read the contents of a file from the workspace filesystem.",
      inputSchema: bashReadFileInputSchema,
      outputSchema: bashReadFileOutputSchema,
    }),
  ).then(bashReadFileLeaf);

  // MOAT can write to host-fs directly; Vercel/Upstash need the
  // sandbox up first.
  const bashWriteFile = isHostMountProvider
    ? bashWriteFileHostFsLeaf
    : withColdSetup(
        sequencer({
          name: "bash-write-file",
          description: bashWriteFileDescription,
          inputSchema: bashWriteFileInputSchema,
          outputSchema: bashWriteFileOutputSchema,
        }),
      ).then(bashWriteFileSandboxLeaf);

  return { bashCommand, bashReadFile, bashWriteFile };
}

/**
 * Pre-sandbox host-mount source for MOAT's `bashWriteFile` host-fs
 * leaf — same dir the resolver will land at once the container boots.
 * Returns `undefined` for non-MOAT providers (caller goes through the
 * sandbox instead).
 */
function resolveHostMountSourceForWrite(
  provider: SandboxProvider,
  ctx: any,
): string | undefined {
  if (provider.type !== "moat") return undefined;
  return provider.workspace ?? defaultMoatWorkspace(getIdentity(ctx).sessionId);
}

function getIdentity(ctx: any): ScopeIdentity {
  return {
    sessionId: ctx.session.identity.id,
    userId: ctx.session.identity.userId,
    orgId: ctx.session.identity.orgId,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Release the bash sandbox associated with the given context, if any.
 *
 * Resolves the same registry key the matching `createBashBlocks` call uses,
 * looks up the entry, calls `sandbox.stop?.()` (best-effort), and removes
 * it from the registry. Errors are logged, never thrown — `onFinished`
 * fires after the response is on its way back to the client and a throw
 * here would only show up in server logs.
 */
export async function releaseBashSandbox(
  provider: SandboxProvider,
  ctx: any,
): Promise<void> {
  const identity = getIdentity(ctx);
  const scope = provider.type === "local" ? (provider.scope ?? "session") : "session";
  const { key: registryKey } = resolveScopeKey(scope, identity);

  const value = registry.get(registryKey);
  if (!value) return;

  // If creation is still in flight, wait for it before stopping — otherwise
  // the in-flight resolver would re-`set` the entry after we deleted it,
  // resurrecting a sandbox we just released.
  let entry: SandboxEntry;
  try {
    entry = isPending(value) ? await value.pending : value;
  } catch {
    registry.delete(registryKey);
    return;
  }

  registry.delete(registryKey);

  try {
    await entry.sandbox.stop?.();
  } catch (err) {
    console.warn(`[bash] sandbox stop failed for ${registryKey}:`, (err as Error).message);
  }
}
