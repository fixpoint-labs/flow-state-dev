/**
 * Shared sandbox resolution — dispatches to the correct adapter based on
 * the provider type. Used by both `createBashTool` (AI SDK tools) and
 * `createBashBlocks` (framework handler blocks).
 *
 * The `vercel` and `upstash` adapters take their third-party SDK via
 * dependency injection on the provider config, so neither this file nor
 * the adapter files import the SDK packages — bundlers and Vercel's
 * file tracer follow the consumer's own static SDK import instead.
 */

import { randomUUID } from "node:crypto";
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
 * @param options.frameworkManaged — caller asserts the workspace path is
 *        framework-derived (e.g. `.fsdev/workspaces/session/<sessionId>`)
 *        and nothing in it is user-authored. Forwarded to the MOAT
 *        resolver so it skips marker checks on the existing `moat.yaml`
 *        (otherwise yamls written by pre-marker framework versions
 *        look user-authored and block every subsequent boot).
 */
export async function resolveSandbox(
  provider: SandboxProvider,
  options: {
    destination?: string;
    cwd?: string;
    existingId?: string;
    frameworkManaged?: boolean;
  } = {},
): Promise<ResolveSandboxResult> {
  switch (provider.type) {
    case "local":
      return {
        sandbox: createLocalFsSandbox({
          cwd: options.cwd ?? provider.cwd,
          destination: options.destination,
          strictPaths: provider.strictPaths,
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
      const { resolveVercelSandbox } = await import("./adapters/vercel");
      return resolveVercelSandbox({
        Sandbox: provider.Sandbox,
        sandboxId: provider.sandboxId ?? options.existingId,
        createOptions: provider.createOptions,
      });
    }

    case "upstash": {
      const { resolveUpstashBox } = await import("./adapters/upstash");
      return resolveUpstashBox({
        client: provider.client,
        boxId: provider.boxId ?? options.existingId,
      });
    }

    case "moat": {
      const { resolveMoatSandbox } = await import("./adapters/moat");
      return resolveMoatSandbox({
        workspace: provider.workspace ?? options.cwd,
        mountTarget: provider.mountTarget ?? options.destination ?? "/workspace",
        // `randomUUID` so two concurrent sessions never produce colliding run
        // names. A timestamp-derived name (millisecond resolution) would
        // silently reuse a sibling session's container via the reconnect path
        // in `resolveMoatSandbox`, giving cross-session workspace access.
        runName: provider.runName ?? options.existingId ?? `fsdev-${randomUUID()}`,
        grants: provider.grants,
        allowHosts: provider.allowHosts,
        runtime: provider.runtime,
        noSandbox: provider.noSandbox,
        configPath: provider.configPath,
        execTimeoutMs: provider.execTimeoutMs,
        bin: provider.bin,
        persist: provider.persist,
        frameworkManaged: options.frameworkManaged,
      });
    }

    case "custom":
      return { sandbox: provider.sandbox };
  }
}
