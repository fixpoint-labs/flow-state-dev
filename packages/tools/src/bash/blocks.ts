/**
 * Handler block factory for bash tool blocks.
 *
 * Creates `bashCommand`, `bashReadFile`, and `bashWriteFile` handler blocks
 * that participate in the framework's block system (lifecycle hooks, items
 * log) rather than running as opaque AI SDK tools inside a generator.
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
import { createProjection } from "@flow-state-dev/workspace";
import type {
  FlushOutcome,
  FlushReport,
  Mount as ProjectionMount,
  Projection,
} from "@flow-state-dev/workspace";
import { createSandboxPlace, KEEP_MARKER } from "./sandbox-place";
import path from "node:path";
import fs from "node:fs/promises";
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

  /**
   * Virtual workspace root visible to the LLM. Defaults to `"/workspace"`
   * for most providers; for the Vercel adapter the default is
   * `"/vercel/sandbox/workspace"` because the sandbox's `vercel-sandbox`
   * runtime user can't `mkdir` outside `/vercel/sandbox` (its home).
   * `writeFiles` extracts tarballs at `/`, so any absolute path outside
   * the user's home fails with `Cannot mkdir: Permission denied` at tar
   * extraction time.
   */
  destination?: string;

  /**
   * Extra resource state to stamp on each file written back to a collection.
   * Receives the workspace-relative path (e.g. `artifacts/notes.md`).
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
  /** Reconciles the sandbox against the mounted collections. */
  projection: Projection;
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
  requestId: string;
  userId?: string;
  orgId?: string;
}

/** Reserved workspace subdirectory for agent scratch space. Never persisted. */
const TMP_DIR = "tmp";

/** Per-session host dir backing the container's `/workspace`, mirroring `local`'s layout. */
function defaultMoatWorkspace(sessionId: string): string {
  return path.join(process.cwd(), ".fsdev", "workspaces", "session", sessionId);
}

/**
 * Provider-aware default for the virtual workspace root.
 *
 * Vercel Sandbox runs as the unprivileged `vercel-sandbox` user whose home
 * is `/vercel/sandbox`. The SDK's `writeFiles` extracts its tarball at `/`
 * (see `@vercel/sandbox`'s `Sandbox.writeFiles`), so any absolute path
 * outside the user's home triggers `tar: <dir>: Cannot mkdir: Permission
 * denied`. Anchor the workspace inside the home so tar's intermediate
 * `mkdir`s land somewhere the user owns. Subsequent shell commands run
 * with `cwd = /vercel/sandbox` so `cd /vercel/sandbox/workspace` works.
 *
 * Other providers default to `/workspace` to preserve the existing
 * convention.
 */
export function defaultDestinationFor(provider: SandboxProvider | undefined): string {
  if (provider?.type === "vercel") return "/vercel/sandbox/workspace";
  return "/workspace";
}

/**
 * Resolve the workspace scope ID and registry key from context identity.
 *
 * For the `local` provider, also resolves the `cwd` when not explicitly set:
 * `.fsdev/workspaces/{scope}/{scopeId}/`
 */
function resolveScopeKey(scope: WorkspaceScope, identity: ScopeIdentity): { key: string; scopeId: string } {
  switch (scope) {
    case "run": {
      // The request is the run. Narrower than a session on purpose: this is
      // the scope where two agents working at once cannot see each other's
      // half-finished files, and where the workspace goes away with the
      // request that made it.
      return { key: `run:${identity.requestId}`, scopeId: identity.requestId };
    }
    case "user": {
      const id = identity.userId ?? identity.sessionId;
      return { key: `user:${id}`, scopeId: id };
    }
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
  ctx: BlockContext,
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
 * `ref.path` is `"artifacts/foo.md"`; stripping `"artifacts"` gives `"foo.md"`.
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
 * their blocks as `sequencer().tapIf(isCold, ensureSandbox).step(leaf)`
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
 * Build the projection for a set of mounts over a sandbox.
 *
 * The prefixes the projection routes by are the same ones `discoverMounts`
 * resolved, so a nested collection still wins over its parent — the ordering
 * moves into `routePath`, which sorts longest-first on its own.
 */
function createSandboxProjection(
  sandbox: Sandbox,
  destination: string,
  mounts: Mount[],
  createState: (relativePath: string) => Partial<JsonObject>,
): Projection {
  return createProjection({
    place: createSandboxPlace(sandbox, destination),
    mounts: mounts.map((m) => ({
      prefix: m.prefix,
      collection: m.collection as unknown as ProjectionMount["collection"],
      writable: m.writable,
      // `createState` has always been handed the workspace-relative path, not
      // the collection key — the bash capability's default reads a title off
      // its basename. Rebuild it from the prefix rather than passing the key.
      entryState: (key: string) => createState(path.posix.join(m.prefix, key)),
    })),
  });
}

/**
 * Hydrate: seed the scratch and mount directories, then lay every mount's
 * entries into the sandbox.
 *
 * The markers exist so `ls` is honest — `./tmp/` really is there — and so the
 * walk has a directory to look in when a collection is empty. The place
 * filters them back out of its listing, so they never reach a collection.
 */
async function hydrate(entry: SandboxEntry, destination: string): Promise<void> {
  await entry.sandbox.writeFile(path.join(destination, TMP_DIR, KEEP_MARKER), "");
  for (const mount of entry.mounts) {
    await entry.sandbox.writeFile(path.join(destination, mount.prefix, KEEP_MARKER), "");
  }
  await entry.projection.hydrate();
}

/**
 * Flush: reconcile the sandbox back into its collections and report what the
 * projection decided.
 *
 * The decisions themselves belong to the projection. What stays here is the
 * translation into things a developer watching the server log can act on:
 * which files went nowhere, which were contested, and the case where a walk
 * succeeded but saw nothing.
 */
async function flush(entry: SandboxEntry): Promise<void> {
  let report: FlushReport;
  try {
    report = await entry.projection.flush();
  } catch (err) {
    // The walk failed. The projection refused to decide anything rather than
    // reading an unreadable workspace as an empty one, which is the whole
    // point of it throwing — a flush that no-ops is recoverable, one that
    // deletes is not.
    console.warn(`[bash] flush skipped — workspace walk failed: ${(err as Error).message}`);
    return;
  }

  reportOutcomes(entry, report.outcomes);
}

/**
 * Turn a flush report into the console diagnostics this tool has always
 * emitted, plus the one it could not: a contested path.
 */
function reportOutcomes(entry: SandboxEntry, outcomes: readonly FlushOutcome[]): void {
  const orphans = outcomes.filter((o) => o.kind === "orphan").map((o) => o.path);
  if (orphans.length > 0) {
    console.warn(
      `[bash] dropped ${orphans.length} orphan file(s) not under any mounted collection (or ./${TMP_DIR}/): ${orphans.join(", ")}`,
    );
  }

  const conflicts = outcomes.filter(
    (o): o is Extract<FlushOutcome, { kind: "conflict" }> => o.kind === "conflict",
  );
  if (conflicts.length > 0) {
    console.warn(
      `[bash] ${conflicts.length} file(s) changed in their collection while this run held them, and were NOT overwritten: ${conflicts
        .map((c) => (c.ours === null ? `${c.path} (deleted here)` : c.path))
        .join(", ")}`,
    );
  }

  // Named separately from conflicts, because the fix is different. A conflict
  // is somebody who already wrote — you reconcile it. A contested path is
  // somebody writing right now, so the answer is usually to run the two runs
  // against different paths, and knowing WHICH path is what makes that
  // possible.
  const contested = outcomes.filter((o) => o.kind === "contested").map((o) => o.path);
  if (contested.length > 0) {
    console.warn(
      `[bash] ${contested.length} file(s) are being written by another run and were NOT overwritten: ${contested.join(", ")}`,
    );
  }

  // A successful flush that reached zero files under writable mounts usually
  // means the agent's writes landed somewhere the walk never visited. Without
  // this there is no warn and no exception — just an artifact that never
  // appears.
  const writable = entry.mounts.filter((m) => m.writable);
  if (writable.length > 0 && outcomes.every((o) => o.kind === "orphan")) {
    const source = entry.sandbox.hostMountSource
      ? ` (host walk under ${entry.sandbox.hostMountSource})`
      : "";
    console.warn(
      `[bash] flush walk found 0 files under writable mounts (${writable
        .map((m) => m.prefix)
        .join(", ")})${source}. If the agent just wrote a file, check that it landed under one of these prefixes.`,
    );
  }
}

/**
 * Commit one file the write-file tool just wrote.
 *
 * Deliberately not a flush: the tool call names the one path that changed, and
 * a walk would both cost more and — with no baseline yet, on the bind-mount
 * fast path that never hydrated — read every pre-existing file as new.
 */
async function routeWrittenFile(
  entry: SandboxEntry,
  relativePath: string,
  content: string,
): Promise<void> {
  // The model often supplies `./artifacts/foo.md` even though the schema says
  // paths are workspace-relative. `isUnderTmp` matches bare prefixes.
  if (relativePath.startsWith("./")) relativePath = relativePath.slice(2);
  if (isUnderTmp(relativePath)) return;
  if (path.posix.basename(relativePath) === KEEP_MARKER) return;

  const outcome = await entry.projection.put(relativePath, content);
  if (outcome === undefined) return;
  if (outcome.kind === "orphan") {
    console.warn(
      `[bash] dropped orphan write at "${relativePath}" — not under any mounted collection or ./${TMP_DIR}/`,
    );
    return;
  }
  if (outcome.kind === "conflict") {
    console.warn(
      `[bash] "${relativePath}" changed in its collection while this run held it — the write was NOT applied.`,
    );
  }
  if (outcome.kind === "contested") {
    console.warn(
      `[bash] "${relativePath}" is being written by another run — the write was NOT applied.`,
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
    destination = defaultDestinationFor(options.provider),
    createState = () => ({}) as Partial<JsonObject>,
  } = options;

  async function getOrCreate(ctx: BlockContext): Promise<SandboxEntry> {
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
          mounts,
          projection: createSandboxProjection(sandbox, destination, mounts, createState),
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
        // Provider type in the block name so the trace makes it obvious
        // which sandbox a request is using (esp. helpful when diagnosing
        // "did the selector pick vercel or fall back to just-bash?").
        name: `bash-${provider.type}-ensure-sandbox`,
        inputSchema: z.any(),
        activeStatusMessage:
          provider.type === "moat"
            ? "Preparing bash sandbox (moat — first run can take 30–60s while the image builds)…"
            : `Preparing bash sandbox (${provider.type})…`,
        execute: async (_input: unknown, ctx) => {
          await getOrCreate(ctx);
        },
      })
    : null;

  // Background purge of stale framework-managed MOAT containers.
  // Dispatched via `.sideChainIf(isCold, ...)` so it runs in parallel with
  // the cold-boot ensureSandbox step and never appears on warm paths.
  // Bounded by `DEFAULT_MAX_CONTAINERS` (50); excess oldest-first.
  const purgeStaleContainers = provider.type === "moat"
    ? handler({
        name: "bash-purge-stale-containers",
        inputSchema: z.any(),
        execute: async (_input: unknown, ctx) => {
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
    name: needsSetup ? `bash-${provider.type}-exec` : "bash",
    description: bashCommandDescription,
    inputSchema: bashCommandInputSchema,
    outputSchema: bashCommandOutputSchema,
    execute: async (input: z.infer<typeof bashCommandInputSchema>, ctx) => {
      const entry = await getOrCreate(ctx);
      const result = await entry.sandbox.executeCommand(cdPrefix + input.command);
      await flush(entry);
      return result;
    },
  });

  const bashReadFileLeaf = handler({
    name: needsSetup ? `bash-${provider.type}-read-file-exec` : "bash-read-file",
    description: [
      "Read the contents of a file in the workspace.",
      "`path` is relative to the workspace root (e.g. `artifacts/foo.md`,",
      "`./tmp/notes.txt`). Don't prefix with `/workspace`.",
    ].join(" "),
    inputSchema: bashReadFileInputSchema,
    outputSchema: bashReadFileOutputSchema,
    execute: async (input: z.infer<typeof bashReadFileInputSchema>, ctx) => {
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
      ctx,
    ) => {
      const hostMountSource = resolveHostMountSourceForWrite(provider, ctx)!;
      const hostPath = path.join(hostMountSource, input.path);
      await fs.mkdir(path.dirname(hostPath), { recursive: true });
      await fs.writeFile(hostPath, input.content, "utf-8");
      // Build a routing-only `SandboxEntry` from ctx if no live one exists.
      // Its projection writes straight to the collections and never reaches
      // for the place, so the `sandbox` field is never dereferenced.
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
        mounts,
        projection: createSandboxProjection({} as Sandbox, destination, mounts, createState),
      };
      await routeWrittenFile(entry, input.path, input.content);
      return { success: true };
    },
  });

  const bashWriteFileSandboxLeaf = handler({
    name: needsSetup ? `bash-${provider.type}-write-file-exec` : "bash-write-file",
    description: bashWriteFileDescription,
    inputSchema: bashWriteFileInputSchema,
    outputSchema: bashWriteFileOutputSchema,
    execute: async (
      input: z.infer<typeof bashWriteFileInputSchema>,
      ctx,
    ) => {
      const entry = await getOrCreate(ctx);
      const fullPath = path.join(destination, input.path);
      await entry.sandbox.writeFile(fullPath, input.content);
      await routeWrittenFile(entry, input.path, input.content);
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
  // only) runs in parallel via `.sideChainIf(isCold, ...)` — fire-and-forget
  // so it never blocks the leaf.
  const withColdSetup = <T extends { sideChainIf: any; tapIf: any }>(s: T): T => {
    const stepA = purgeStaleContainers
      ? s.sideChainIf(isCold, purgeStaleContainers)
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
  ).step(bashCommandLeaf);

  const bashReadFile = withColdSetup(
    sequencer({
      name: "bash-read-file",
      description: "Read the contents of a file from the workspace filesystem.",
      inputSchema: bashReadFileInputSchema,
      outputSchema: bashReadFileOutputSchema,
    }),
  ).step(bashReadFileLeaf);

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
      ).step(bashWriteFileSandboxLeaf);

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
  ctx: BlockContext,
): string | undefined {
  if (provider.type !== "moat") return undefined;
  return provider.workspace ?? defaultMoatWorkspace(getIdentity(ctx).sessionId);
}

function getIdentity(ctx: BlockContext): ScopeIdentity {
  return {
    sessionId: ctx.session.identity.id,
    requestId: ctx.request.identity.id,
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
  ctx: BlockContext,
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
