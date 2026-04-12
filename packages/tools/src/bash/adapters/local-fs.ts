/**
 * Local filesystem sandbox adapter.
 *
 * Uses the real filesystem via `node:fs` and `node:child_process` for bash
 * commands. Best for development, local agents, and environments where you
 * control the machine.
 */

import { exec } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Sandbox, CommandResult } from "../types";

/**
 * Creates a sandbox backed by the local filesystem.
 *
 * Commands run via `/bin/bash` in the specified working directory.
 * File reads/writes go through `node:fs`. Parent directories are
 * created automatically on write.
 *
 * The optional `destination` parameter specifies the virtual workspace prefix
 * (e.g. `/workspace`) that callers prepend to file paths. When set, the adapter
 * strips this prefix before resolving against `cwd`, so `/workspace/src/index.ts`
 * maps to `<cwd>/src/index.ts` on the real filesystem.
 */
export function createLocalFsSandbox(
  options: { cwd?: string; destination?: string } = {},
): Sandbox {
  const cwd = options.cwd ?? path.join(process.cwd(), ".bash-workspace");
  const destination = options.destination;

  /**
   * Translate a virtual sandbox path to a real filesystem path.
   *
   * Strips the virtual destination prefix (e.g. `/workspace/`) so that
   * absolute sandbox paths resolve correctly against the local `cwd`.
   */
  function toLocalPath(filePath: string): string {
    let rel = filePath;

    if (destination) {
      if (filePath === destination || filePath === destination + "/") {
        return cwd;
      }
      const prefix = destination.endsWith("/") ? destination : destination + "/";
      if (filePath.startsWith(prefix)) {
        rel = filePath.slice(prefix.length);
      }
    }

    return path.resolve(cwd, rel);
  }

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      // Ensure cwd exists before running commands
      await mkdir(cwd, { recursive: true });

      return new Promise((resolve) => {
        exec(
          command,
          { cwd, shell: "/bin/bash", maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            resolve({
              stdout: stdout ?? "",
              stderr: stderr ?? "",
              exitCode: error?.code ?? 0,
            });
          },
        );
      });
    },

    async readFile(filePath: string): Promise<string> {
      const resolved = toLocalPath(filePath);
      return readFile(resolved, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const resolved = toLocalPath(filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
    },
  };
}
