/**
 * Resolver seam for the `@anthropic-ai/claude-agent-sdk` `query()` entry point.
 *
 * The agent block never statically imports the SDK — it is an optional peer
 * dependency. The default resolver lazily `import()`s it on first use and throws
 * {@link ClaudeAgentSdkNotInstalledError} when it is absent. Tests inject a
 * scripted `query` via their own resolver and never touch the real SDK.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { ClaudeAgentSdkNotInstalledError } from "./errors";
import type { ClaudeAgentQuery, ResolveClaudeAgent, ResolvedClaudeAgent } from "./types";

/** The SDK module path. Kept as a variable so bundlers don't eagerly resolve it. */
const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/**
 * How the resolver loads the SDK module. Defaults to a lazy dynamic `import`;
 * overridable so the absent-SDK path is testable without depending on whether
 * the optional peer dependency happens to be installed.
 */
export type SdkImporter = () => Promise<{ query?: unknown }>;

const defaultImporter: SdkImporter = () =>
  import(/* @vite-ignore */ SDK_MODULE) as Promise<{ query?: unknown }>;

/**
 * Build a resolver that loads the SDK via `importSdk` and returns its `query`.
 * Throws {@link ClaudeAgentSdkNotInstalledError} if the module can't be loaded
 * or lacks a `query` export. Exported mainly so tests can supply an importer
 * that rejects (simulating an absent SDK); production uses
 * {@link defaultResolveClaudeAgent}.
 */
export function createDefaultResolveClaudeAgent(
  importSdk: SdkImporter = defaultImporter,
): ResolveClaudeAgent {
  return async (_ctx: BlockContext<any>): Promise<ResolvedClaudeAgent> => {
    let mod: { query?: unknown };
    try {
      mod = await importSdk();
    } catch (err) {
      throw new ClaudeAgentSdkNotInstalledError(undefined, { cause: (err as Error).message });
    }
    if (typeof mod.query !== "function") {
      throw new ClaudeAgentSdkNotInstalledError(
        "`@anthropic-ai/claude-agent-sdk` was found but does not export a `query` function.",
      );
    }
    return { query: mod.query as ClaudeAgentQuery };
  };
}

/**
 * Default resolver: lazily imports the SDK and returns its `query`. The import
 * is deferred to call time so merely importing this package (without the SDK
 * installed) never fails.
 */
export const defaultResolveClaudeAgent: ResolveClaudeAgent = createDefaultResolveClaudeAgent();
