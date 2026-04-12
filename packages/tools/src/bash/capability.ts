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
import { createBashBlocks } from "./blocks";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBashCapabilityOptions {
  /** Session resource definitions (e.g. `artifactResources`). */
  sessionResources: Record<string, DeclaredResourceEntry>;

  /** Key in `sessionResources` for the file collection. */
  collectionKey: string;

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

function buildJustBashGuidance(provider: Extract<SandboxProvider, { type: "just-bash" }>): string {
  const lines: string[] = ["You have a sandboxed bash workspace with 60+ built-in commands (jq, awk, sed, grep, rg, sort, etc.)."];

  // Python
  if (provider.python) {
    lines.push("Python 3 is available via the `python3` command.");
  }

  // JavaScript/TypeScript
  if (provider.javascript) {
    lines.push("JavaScript/TypeScript execution is available via `node` (QuickJS WASM).");
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

  return lines.join(" ");
}

function buildLocalGuidance(provider: Extract<SandboxProvider, { type: "local" }>): string {
  const scope = provider.scope ?? "session";
  const lines: string[] = [
    `You have a local bash workspace (${scope}-scoped) with full access to host binaries (npm, python, gcc, etc.).`,
    "Files you create or modify in the workspace are automatically saved as artifacts.",
    "Use bash to create and edit files — do not use separate artifact tools.",
  ];
  return lines.join(" ");
}

function buildGuidance(provider: SandboxProvider): string {
  switch (provider.type) {
    case "just-bash":
      return buildJustBashGuidance(provider);
    case "local":
      return buildLocalGuidance(provider);
    case "vercel":
      return "You have a Vercel Sandbox bash workspace. Files are automatically saved as artifacts. Use bash to create and edit files.";
    case "upstash":
      return "You have an Upstash Box bash workspace. Files are automatically saved as artifacts. Use bash to create and edit files.";
    case "custom":
      return "You have a bash workspace. Files are automatically saved as artifacts. Use bash to create and edit files.";
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
    provider,
    destination,
    createState,
  });

  const guidance = buildGuidance(provider);

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
