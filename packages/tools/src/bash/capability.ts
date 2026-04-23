/**
 * Bash capability factory — bundles bash tool blocks, context guidance,
 * and resource declarations under a single `uses: [bashCapability]`.
 *
 * The context guidance adapts to the provider configuration, informing the
 * LLM about available capabilities (network, python, builtins) and
 * instructing it to use bash for file creation.
 *
 * @example
 * ```ts
 * import { createBashCapability } from "@flow-state-dev/tools/bash";
 *
 * const bashCap = createBashCapability({
 *   sessionResources: artifactResources,
 *   collectionKey: "artifacts",
 *   provider: { type: "just-bash", network: { dangerouslyAllowFullInternetAccess: true } },
 * });
 *
 * const gen = generator({ uses: [bashCap], ... });
 * ```
 */

import { defineCapability } from "@flow-state-dev/core";
import type { DeclaredResourceEntry, JsonObject } from "@flow-state-dev/core/types";
import type { SandboxProvider } from "./types";
import { createBashBlocks, type ReadOnlyMount } from "./blocks";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBashCapabilityOptions {
  /** Session resource definitions (e.g. `artifactResources`). */
  sessionResources: Record<string, DeclaredResourceEntry>;

  /** Key in `sessionResources` for the file collection. */
  collectionKey: string;

  /**
   * Additional read-only collections to materialize into the workspace at a
   * path prefix. Intended for bundling skill files or other ancillary
   * content alongside the primary artifacts collection without mixing
   * their persistence models — writes to read-only paths don't flush back.
   */
  readOnlyMounts?: Array<ReadOnlyMount>;

  /** Sandbox provider. Default: `{ type: "just-bash" }`. */
  provider?: SandboxProvider;

  /** Virtual workspace root. Default: `"/workspace"`. */
  destination?: string;

  /** Creates initial resource state for new files. */
  createState?: (relativePath: string) => Partial<JsonObject>;
}

// ---------------------------------------------------------------------------
// Context guidance generators
// ---------------------------------------------------------------------------

function buildWorkspaceBoundary(destination: string): string {
  return `Your workspace directory is ${destination}. You must only read, write, and operate on files within this directory. Do not access, list, or traverse files or directories outside of ${destination} — including home directories, other projects, or system paths. This applies to all commands, scripts, and embedded code (Python, Node, etc.).`;
}

function buildJustBashGuidance(
  provider: Extract<SandboxProvider, { type: "just-bash" }>,
  destination: string,
  readOnlyMountsGuidance: string | undefined,
): string {
  const lines: string[] = [
    "You have a sandboxed bash workspace with 60+ built-in commands (curl, find, join, jq, awk, sed, grep, rg, sort, column, yq, html-to-markdown, etc.). You are not able to install new packages or dependencies, you must only use the packages that are already installed.",
    buildWorkspaceBoundary(destination),
  ];

  // Python
  if (provider.python) {
    lines.push("Python 3 is available via the `python3` command.");
  }

  // JavaScript/TypeScript
  if (provider.javascript) {
    lines.push("JavaScript/TypeScript execution is available via `js-exec` (QuickJS WASM). You do not have node installed.");
  }


  // Network
  if (provider.network?.dangerouslyAllowFullInternetAccess) {
    lines.push("Network access: full internet access via `curl`.");
  } else if (provider.network?.allowedUrls && provider.network.allowedUrls.length > 0) {
    const domains = provider.network.allowedUrls.map((u) => u.url).join(", ");
    lines.push(`Network access: restricted to ${domains} via \`curl\`.`);
  } else {
    lines.push("No network access.");
  }

  lines.push("Files you create or modify in the workspace are automatically saved as artifacts.");
  lines.push("Use bash to create and edit files — do not use separate artifact tools.");
  if (readOnlyMountsGuidance) lines.push(readOnlyMountsGuidance);

  return lines.join(" ");
}

function buildLocalGuidance(
  provider: Extract<SandboxProvider, { type: "local" }>,
  destination: string,
  readOnlyMountsGuidance: string | undefined,
): string {
  const scope = provider.scope ?? "session";
  const lines: string[] = [
    `You have a local bash workspace (${scope}-scoped) with full access to host binaries (npm, python, gcc, etc.).`,
    buildWorkspaceBoundary(destination),
    "Files you create or modify in the workspace are automatically saved as artifacts.",
    "Use bash to create and edit files — do not use separate artifact tools.",
  ];
  if (readOnlyMountsGuidance) lines.push(readOnlyMountsGuidance);
  return lines.join(" ");
}

/**
 * Build a single-sentence note describing which workspace paths are
 * pre-populated but read-only. Returned `undefined` when there are no
 * read-only mounts, so the guidance stays unchanged for default setups.
 */
function buildReadOnlyMountsGuidance(
  destination: string,
  mounts: Array<ReadOnlyMount>,
): string | undefined {
  if (!mounts || mounts.length === 0) return undefined;
  const paths = mounts
    .map((m) => path.posix.join(destination, m.pathPrefix.replace(/^\/+|\/+$/g, "")))
    .join(", ");
  return `Read-only files are pre-populated at: ${paths}. You can read and execute them, but any changes you make there will not be saved.`;
}

function buildGuidance(
  provider: SandboxProvider,
  destination: string,
  readOnlyMounts: Array<ReadOnlyMount>,
): string {
  const readOnlyNote = buildReadOnlyMountsGuidance(destination, readOnlyMounts);
  switch (provider.type) {
    case "just-bash":
      return buildJustBashGuidance(provider, destination, readOnlyNote);
    case "local":
      return buildLocalGuidance(provider, destination, readOnlyNote);
    case "vercel":
      return [
        `You have a Vercel Sandbox bash workspace.`,
        buildWorkspaceBoundary(destination),
        "Files are automatically saved as artifacts.",
        "Use bash to create and edit files.",
        readOnlyNote,
      ].filter(Boolean).join(" ");
    case "upstash":
      return [
        `You have an Upstash Box bash workspace.`,
        buildWorkspaceBoundary(destination),
        "Files are automatically saved as artifacts.",
        "Use bash to create and edit files.",
        readOnlyNote,
      ].filter(Boolean).join(" ");
    case "custom":
      return [
        `You have a bash workspace.`,
        buildWorkspaceBoundary(destination),
        "Files are automatically saved as artifacts.",
        "Use bash to create and edit files.",
        readOnlyNote,
      ].filter(Boolean).join(" ");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a bash capability that bundles tool blocks and context guidance.
 *
 * Returned capability has two presets (both on by default):
 * - `tools` — the three bash handler blocks (bashCommand, bashReadFile, bashWriteFile)
 * - `guidance` — context function describing the workspace environment
 */
export function createBashCapability(options: CreateBashCapabilityOptions) {
  const {
    sessionResources,
    collectionKey,
    readOnlyMounts,
    provider = { type: "just-bash" },
    destination,
    createState = (relativePath) => ({
      title: path.basename(relativePath),
      updatedAt: Date.now(),
    }),
  } = options;

  const { bashCommand, bashReadFile, bashWriteFile } = createBashBlocks({
    sessionResources,
    collectionKey,
    readOnlyMounts,
    provider,
    destination,
    createState,
  });

  const resolvedDestination = destination ?? "/workspace";
  const guidance = buildGuidance(provider, resolvedDestination, readOnlyMounts ?? []);

  return defineCapability({
    name: "bash",
    sessionResources,

    presets: {
      tools: {
        tools: [bashCommand, bashReadFile, bashWriteFile],
      },
      guidance: {
        context: [() => guidance],
      },
      default: ["tools", "guidance"],
    },
  });
}
