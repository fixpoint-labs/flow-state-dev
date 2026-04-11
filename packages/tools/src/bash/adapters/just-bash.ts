/**
 * In-memory bash adapter using `just-bash`.
 *
 * No real filesystem, no real processes. Provides a lightweight bash emulation
 * suitable for analysis tasks, testing, and environments where real process
 * execution is unavailable or undesirable.
 *
 * `just-bash` is a peer dependency and only loaded when this adapter is selected.
 */

import type { Sandbox, CommandResult } from "../types";

/**
 * Creates an in-memory sandbox using `just-bash`.
 *
 * Falls back to a minimal in-memory filesystem if `just-bash` is not installed.
 */
export async function createJustBashSandbox(options?: {
  cwd?: string;
  files?: Record<string, string>;
}): Promise<Sandbox> {
  try {
    const { Bash } = await import(/* webpackIgnore: true */ "just-bash");
    const bash = new Bash({ cwd: options?.cwd, files: options?.files });

    return {
      async executeCommand(command: string): Promise<CommandResult> {
        const result = await bash.exec(command);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },

      async readFile(filePath: string): Promise<string> {
        const result = await bash.exec(`cat "${filePath}"`);
        if (result.exitCode !== 0) {
          throw new Error(`File not found: ${filePath}`);
        }
        return result.stdout;
      },

      async writeFile(filePath: string, content: string): Promise<void> {
        await bash.exec(`mkdir -p "$(dirname "${filePath}")"`);
        // Use heredoc to avoid shell escaping issues
        await bash.exec(
          `cat > "${filePath}" << 'FLOWSTATE_EOF'\n${content}\nFLOWSTATE_EOF`,
        );
      },
    };
  } catch {
    // just-bash not available — fall back to a basic in-memory filesystem
    return createInMemorySandbox(options?.files);
  }
}

/**
 * Minimal in-memory sandbox that tracks files in a Map.
 * Used as a fallback when `just-bash` is not installed.
 * Only supports basic file operations — bash commands return an error.
 */
function createInMemorySandbox(
  initialFiles?: Record<string, string>,
): Sandbox {
  const files = new Map<string, string>(
    initialFiles ? Object.entries(initialFiles) : [],
  );

  return {
    async executeCommand(command: string): Promise<CommandResult> {
      // Minimal command support for workspace walking
      if (command.startsWith("find ")) {
        const paths = Array.from(files.keys());
        return {
          stdout: paths.join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        stdout: "",
        stderr: "In-memory sandbox: install just-bash for full bash support",
        exitCode: 1,
      };
    },

    async readFile(filePath: string): Promise<string> {
      const content = files.get(filePath);
      if (content === undefined) {
        throw new Error(`File not found: ${filePath}`);
      }
      return content;
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      files.set(filePath, content);
    },
  };
}
