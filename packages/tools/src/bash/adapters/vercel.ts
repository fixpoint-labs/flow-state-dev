/**
 * Vercel Sandbox adapter.
 *
 * Wraps a `@vercel/sandbox` `Sandbox` class behind the framework's
 * `Sandbox` interface. The class is passed in via the provider config
 * (`{ type: "vercel", Sandbox: ... }`) — the framework intentionally does
 * not take a peer dependency on `@vercel/sandbox` itself. The consumer's
 * own static `import` of the SDK is what bundlers and Vercel's file
 * tracer follow to ship the package and its transitive deps to the
 * deployment.
 *
 * Supports both ephemeral and persistent sandboxes — pass an existing
 * `sandboxId` to reconnect.
 */

import type {
  Sandbox,
  CommandResult,
  VercelSandboxClassLike,
  VercelSandboxInstance,
} from "../types";

/**
 * Wrap a Vercel sandbox instance into the framework's `Sandbox` interface.
 *
 * Bash command lines are run through `sh -c "..."` so shell features
 * (pipes, redirects, env-var expansion) work the same way they do on
 * other adapters. `readFile`/`writeFile` map to `readFileToBuffer`/
 * `writeFiles` since those are the byte-oriented methods on the SDK.
 */
export function createVercelAdapter(sandbox: VercelSandboxInstance): Sandbox {
  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await sandbox.runCommand("sh", ["-c", command]);
      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);
      return {
        stdout,
        stderr,
        exitCode: result.exitCode ?? 0,
      };
    },

    async readFile(filePath: string): Promise<string> {
      const buf = await sandbox.readFileToBuffer({ path: filePath });
      if (buf === null) {
        throw new Error(`File not found: ${filePath}`);
      }
      return buf.toString("utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await sandbox.writeFiles([{ path: filePath, content }]);
    },

    async stop(): Promise<void> {
      await sandbox.stop();
    },
  };
}

/**
 * Resolve a Vercel sandbox — reconnect to an existing one via `sandboxId`
 * or provision a new one via `Sandbox.create(createOptions)`.
 *
 * @returns The adapter sandbox and the resolved sandbox ID for persistence.
 */
export async function resolveVercelSandbox(opts: {
  Sandbox: VercelSandboxClassLike;
  sandboxId?: string;
  createOptions?: unknown;
}): Promise<{ sandbox: Sandbox; sandboxId: string }> {
  if (opts.sandboxId) {
    const raw = await opts.Sandbox.get({ sandboxId: opts.sandboxId });
    return { sandbox: createVercelAdapter(raw), sandboxId: opts.sandboxId };
  }

  const raw = await opts.Sandbox.create(opts.createOptions);
  return { sandbox: createVercelAdapter(raw), sandboxId: raw.sandboxId };
}
