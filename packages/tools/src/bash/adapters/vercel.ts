/**
 * Vercel Sandbox adapter.
 *
 * Wraps `@vercel/sandbox` behind the `Sandbox` interface. Supports both
 * ephemeral and persistent sandboxes — pass an existing `sandboxId` to
 * reconnect to a prior sandbox.
 *
 * `@vercel/sandbox` is a peer dependency and only loaded when this adapter
 * is explicitly selected.
 */

import type { Sandbox, CommandResult } from "../types";

/**
 * Wraps an already-resolved Vercel sandbox instance into our Sandbox interface.
 * The `rawSandbox` parameter is typed as `unknown` to avoid requiring
 * `@vercel/sandbox` at import time — it's loaded dynamically in `resolveVercelSandbox`.
 */
export function createVercelAdapter(rawSandbox: unknown): Sandbox {
  // Cast at usage — the caller guarantees this is a Vercel Sandbox instance.
  const sandbox = rawSandbox as {
    shells: Array<{
      exec(cmd: string): Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
    }>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    kill(): Promise<void>;
  };

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await sandbox.shells[0].exec(command);
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode ?? 0,
      };
    },

    async readFile(filePath: string): Promise<string> {
      return sandbox.readFile(filePath);
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await sandbox.writeFile(filePath, content);
    },

    async stop(): Promise<void> {
      await sandbox.kill();
    },
  };
}

/**
 * Resolves a Vercel sandbox — reconnects to an existing one via `sandboxId`
 * or creates a new one.
 *
 * @returns The adapter sandbox and the resolved sandbox ID for persistence.
 */
export async function resolveVercelSandbox(
  sandboxId?: string,
): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  const { Sandbox: VercelSandboxClass } = await import("@vercel/sandbox");

  if (sandboxId) {
    const raw = await VercelSandboxClass.get({ sandboxId });
    return { sandbox: createVercelAdapter(raw), sandboxId };
  }

  const raw = await VercelSandboxClass.create();
  return { sandbox: createVercelAdapter(raw), sandboxId: raw.sandboxId };
}
