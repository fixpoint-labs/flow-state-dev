/**
 * Resolver seam for the `@anthropic-ai/claude-agent-sdk` `query()` entry point.
 *
 * The agent block never statically imports the SDK — it is an optional peer
 * dependency. The default resolver lazily `import()`s it on first use and throws
 * {@link ClaudeAgentSdkNotInstalledError} when it is absent. Tests inject a
 * scripted `query` via their own resolver and never touch the real SDK.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { readInstalledSdkVersion, type InstalledSdkVersion, type TestedSdk } from "@flow-state-dev/core/internal";
import { ClaudeAgentSdkNotInstalledError } from "./errors";
import type { ClaudeAgentQuery, ResolveClaudeAgent, ResolvedClaudeAgent } from "./types";

/** The SDK module path. Kept as a variable so bundlers don't eagerly resolve it. */
const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/**
 * The `@anthropic-ai/claude-agent-sdk` this package is tested against: its
 * `peerDependencies` range. The lower bound is the version the lockfile pins;
 * the span is the SDK's patch line, so an SDK patch needs no release of ours.
 * `claudeCodeAgent` refuses to build against a version outside it, and the
 * readiness check says so first (core's SDK gate).
 */
export const TESTED_SDK: TestedSdk = { harness: "Claude Code", sdk: SDK_MODULE, range: ">=0.3.316 <0.4.0" };

/** Which `@anthropic-ai/claude-agent-sdk` is installed beside this package, read the way core's SDK gate reads every harness's. */
export function readInstalledClaudeCodeSdkVersion(): InstalledSdkVersion {
  return readInstalledSdkVersion(SDK_MODULE, import.meta.url);
}

/**
 * How the resolver loads the SDK module. Defaults to a lazy dynamic `import`;
 * overridable so the absent-SDK path is testable without depending on whether
 * the optional peer dependency happens to be installed.
 */
export type SdkImporter = () => Promise<{ query?: unknown }>;

/** The lazy dynamic `import` of the SDK every default path loads it through. */
export const defaultSdkImporter: SdkImporter = () =>
  import(/* @vite-ignore */ SDK_MODULE) as Promise<{ query?: unknown }>;

/**
 * Build a resolver that loads the SDK via `importSdk` and returns its `query`.
 * Throws {@link ClaudeAgentSdkNotInstalledError} if the module can't be loaded
 * or lacks a `query` export. Exported mainly so tests can supply an importer
 * that rejects (simulating an absent SDK); production uses
 * {@link defaultResolveClaudeAgent}.
 */
export function createDefaultResolveClaudeAgent(
  importSdk: SdkImporter = defaultSdkImporter,
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
