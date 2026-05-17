/**
 * Bash capability factory — bundles bash tool blocks, context guidance,
 * and an auto-discovered view of installed resource collections.
 *
 * Collections to mount are discovered at runtime from the unified
 * `ctx.resources` registry. Any entry that is a `ResourceCollectionRef`
 * is mounted at its pattern prefix. Consumers that want to narrow (or
 * exclude) can do so via the `collections` / `exclude` options.
 *
 * No `resources` option: the bash capability does not install resources
 * itself. Collections are installed by their owning capabilities (e.g. an
 * artifacts capability declares the `artifacts` collection, a skills
 * capability declares `skills`). Attaching the bash capability to a
 * generator that also has those capabilities installed is enough — bash
 * inherits the collections from the shared resource registry.
 *
 * @example
 * ```ts
 * // Zero-config: mount every collection installed on the block.
 * const bashCap = createBashCapability({
 *   provider: { type: "local" },
 * });
 *
 * // Narrow to specific collections:
 * const bashCap = createBashCapability({
 *   provider: { type: "local" },
 *   collections: ["artifacts"],
 * });
 * ```
 */

import { defineCapability, handler } from "@flow-state-dev/core";
import type { CapabilityPresetCtx } from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import type { SandboxProvider } from "./types";
import { createBashBlocks, releaseBashSandbox, type BashCollectionSpec } from "./blocks";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBashCapabilityOptions {
  /**
   * Explicit list of collections to mount. Strings are shorthand for
   * writable mounts; `{ key, writable: false }` opts a specific collection
   * out of flush-back. When omitted, every collection on the block's
   * resource context is mounted (default).
   */
  collections?: BashCollectionSpec[];

  /** Keys to skip during auto-discovery. Ignored when `collections` is set. */
  exclude?: string[];

  /** Sandbox provider. Default: `{ type: "just-bash" }`. */
  provider?: SandboxProvider;

  /** Virtual workspace root. Default: `"/workspace"`. */
  destination?: string;

  /** Creates initial resource state for new files. */
  createState?: (relativePath: string) => Partial<JsonObject>;
}

// ---------------------------------------------------------------------------
// Context guidance
// ---------------------------------------------------------------------------

function buildWorkspaceBoundary(destination: string): string {
  return `Your workspace directory is ${destination}. You must only read, write, and operate on files within this directory. Do not access, list, or traverse files or directories outside of ${destination} — including home directories, other orgs, or system paths. This applies to all commands, scripts, and embedded code (Python, Node, etc.).`;
}

/**
 * Dynamic guidance. Runs per-turn so the list of mounted directories reflects
 * whatever collections are currently installed on the block's resource
 * context — mounts change as capabilities are added or removed via dynamic
 * `uses:` resolvers.
 */
function buildGuidance(
  provider: SandboxProvider,
  destination: string,
  ctx: CapabilityPresetCtx,
): string {
  const base = buildProviderLines(provider, destination);
  const mountsLine = buildMountsGuidance(destination, ctx);
  return [base, mountsLine].filter(Boolean).join(" ");
}

function buildProviderLines(provider: SandboxProvider, destination: string): string {
  const boundary = buildWorkspaceBoundary(destination);
  switch (provider.type) {
    case "just-bash": {
      const lines: string[] = [
        "You have a sandboxed bash workspace with 60+ built-in commands (curl, find, join, jq, awk, sed, grep, rg, sort, column, yq, html-to-markdown, etc.). You are not able to install new packages or dependencies, you must only use the packages that are already installed.",
        boundary,
      ];
      if (provider.python) lines.push("Python 3 is available via the `python3` command.");
      if (provider.javascript) {
        lines.push("JavaScript/TypeScript execution is available via `js-exec` (QuickJS WASM). You do not have node installed.");
      }
      if (provider.network?.dangerouslyAllowFullInternetAccess) {
        lines.push("Network access: full internet access via `curl`.");
      } else if (provider.network?.allowedUrls && provider.network.allowedUrls.length > 0) {
        const domains = provider.network.allowedUrls.map((u) => u.url).join(", ");
        lines.push(`Network access: restricted to ${domains} via \`curl\`.`);
      } else {
        lines.push("No network access.");
      }
      return lines.join(" ");
    }
    case "local": {
      const scope = provider.scope ?? "session";
      return [
        `You have a local bash workspace (${scope}-scoped) with full access to host binaries (npm, python, gcc, etc.).`,
        boundary,
      ].join(" ");
    }
    case "vercel":
      return `You have a Vercel Sandbox bash workspace. ${boundary}`;
    case "upstash":
      return `You have an Upstash Box bash workspace. ${boundary}`;
    case "moat": {
      const hostList = (provider.allowHosts ?? []).join(", ") || "no hosts";
      return `You have a MOAT-isolated bash workspace running in a container. Outbound network access is restricted to: ${hostList}. ${boundary}`;
    }
    case "custom":
      return `You have a bash workspace. ${boundary}`;
  }
}

/**
 * Build the mounts + scratch guidance sentence: lists which directories are
 * saved (and to which collection), and tells the agent about `./tmp/` as
 * explicit scratch space. Runs per-turn via the dynamic context formatter.
 */
function buildMountsGuidance(destination: string, ctx: CapabilityPresetCtx): string {
  const mounts = collectMounts(ctx);
  const lines: string[] = [];
  if (mounts.length === 0) {
    lines.push(
      "No collections are currently mounted — files you create or modify will not persist beyond this session unless placed under a known collection path.",
    );
  } else {
    const descriptions = mounts.map((m) => {
      const verb = m.writable === false ? "read-only mount" : "saved to the";
      const target = m.writable === false ? `of "${m.key}"` : `"${m.key}" collection`;
      return `  - ${path.posix.join(destination, m.prefix)}/ — ${verb} ${target}`;
    });
    lines.push("Files are saved as follows:");
    lines.push(...descriptions);
  }
  lines.push(
    `Use ${path.posix.join(destination, "tmp")}/ for scratch files you do not want persisted. Files created anywhere else are discarded on save with a warning.`,
  );
  return lines.join("\n");
}

/** Minimal mount descriptor used by the guidance formatter. */
interface MountInfo {
  key: string;
  prefix: string;
  writable: boolean;
}

function collectMounts(ctx: CapabilityPresetCtx): MountInfo[] {
  const seen = new Set<string>();
  const out: MountInfo[] = [];
  const bag = ctx?.resources;
  if (bag && typeof bag === "object") {
    for (const [key, value] of Object.entries(bag)) {
      // Skip helper functions like `get` / `list` exposed by the registry.
      if (typeof value === "function") continue;
      if (seen.has(key)) continue;
      if (!isCollectionLike(value)) continue;
      const prefix = patternPrefix((value as { pattern: string }).pattern);
      if (!prefix || prefix === "tmp") continue;
      seen.add(key);
      out.push({ key, prefix, writable: true });
    }
  }
  out.sort((a, b) => b.prefix.length - a.prefix.length);
  return out;
}

function isCollectionLike(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pattern === "string" && typeof v.list === "function";
}

/** Minimal re-derivation of the core pattern prefix rule — keep local to avoid an import cycle. */
function patternPrefix(pattern: string): string {
  const wildcardIdx = pattern.search(/[*?[{]/);
  if (wildcardIdx === -1) return pattern.replace(/\/+$/, "");
  return pattern.slice(0, wildcardIdx).replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a bash capability that bundles tool blocks and context guidance.
 *
 * Returned capability has two presets (both on by default):
 * - `tools` — the three bash handler blocks (bashCommand, bashReadFile, bashWriteFile)
 * - `guidance` — dynamic context function describing the workspace + mounted paths
 */
export function createBashCapability(options: CreateBashCapabilityOptions = {}) {
  const {
    collections,
    exclude,
    provider = { type: "just-bash" },
    destination,
    createState = (relativePath) => ({
      title: path.basename(relativePath),
      updatedAt: Date.now(),
    }),
  } = options;

  const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
    collections,
    exclude,
    provider,
    destination,
    createState,
  });

  const resolvedDestination = destination ?? "/workspace";

  const capability = defineCapability({
    name: "bash",

    presets: {
      tools: {
        tools: [bashCommand, bashReadFile, bashWriteFile],
      },
      guidance: {
        context: [(_input: unknown, ctx) => buildGuidance(provider, resolvedDestination, ctx)],
      },
      default: ["tools", "guidance"],
    },
  });

  /**
   * Tear down this capability's sandbox at request end. Required for the
   * `moat` provider — without it, containers leak. No-op-ish for LocalFs and
   * just-bash. Wire it via `defineFlow({ request: { onFinished: bashCap.cleanupBlock } })`.
   *
   * Returned unconditionally so the capability shape is stable across providers.
   */
  const cleanupBlock = handler({
    name: "bash-cleanup",
    execute: async (_input: unknown, ctx) => {
      await releaseBashSandbox(provider, ctx);
    },
  });

  return Object.assign(capability, { cleanupBlock });
}
