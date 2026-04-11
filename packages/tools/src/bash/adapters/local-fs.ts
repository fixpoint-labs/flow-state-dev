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
 */
export function createLocalFsSandbox(options: { cwd?: string } = {}): Sandbox {
  const cwd = options.cwd ?? path.join(process.cwd(), ".bash-workspace");

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
      const resolved = path.resolve(cwd, filePath);
      return readFile(resolved, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const resolved = path.resolve(cwd, filePath);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
    },
  };
}
