/**
 * Shared sandbox resolution — dispatches to the correct adapter based on
 * the provider type. Used by both `createBashTool` (AI SDK tools) and
 * `createBashBlocks` (framework handler blocks).
 */

import type { Sandbox, SandboxProvider } from "./types";
import { createLocalFsSandbox } from "./adapters/local-fs";

export interface ResolveSandboxResult {
  sandbox: Sandbox;
  sandboxId?: string;
}

/**
 * Resolve a sandbox from a provider configuration.
 *
 * @param provider — discriminated union of sandbox provider configs
 * @param options.destination — virtual workspace root (e.g. "/workspace")
 * @param options.cwd — explicit working directory (overrides provider.cwd for local)
 * @param options.existingId — reconnect to an existing sandbox (Vercel/Upstash)
 */
export async function resolveSandbox(
  provider: SandboxProvider,
  options: { destination?: string; cwd?: string; existingId?: string } = {},
): Promise<ResolveSandboxResult> {
  switch (provider.type) {
    case "local":
      return {
        sandbox: createLocalFsSandbox({
          cwd: options.cwd ?? provider.cwd,
          destination: options.destination,
        }),
      };

    case "just-bash": {
      const { createJustBashSandbox } = await import("./adapters/just-bash");
      return {
        sandbox: await createJustBashSandbox({
          cwd: options.destination,
          env: provider.env,
          network: provider.network,
          python: provider.python,
          javascript: provider.javascript,
          executionLimits: provider.executionLimits,
        }),
      };
    }

    case "vercel": {
      const id = provider.sandboxId ?? options.existingId;
      const { resolveVercelSandbox } = await import("./adapters/vercel");
      return resolveVercelSandbox(id);
    }

    case "upstash": {
      const id = provider.boxId ?? options.existingId;
      const { resolveUpstashBox } = await import("./adapters/upstash");
      return resolveUpstashBox(id);
    }

    case "custom":
      return { sandbox: provider.sandbox };
  }
}
