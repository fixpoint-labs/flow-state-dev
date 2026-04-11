/**
 * Ambient module declarations for optional peer dependencies.
 *
 * These modules are dynamically imported only when their corresponding
 * sandbox adapter is selected. Declaring them here prevents TS2307 errors
 * without requiring the packages to be installed.
 */

declare module "just-bash" {
  export class Bash {
    constructor(options?: { cwd?: string; files?: Record<string, string> });
    exec(command: string): Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  }
}

declare module "@vercel/sandbox" {
  export class Sandbox {
    sandboxId: string;
    shells: Array<{
      exec(cmd: string): Promise<{
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      }>;
    }>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    kill(): Promise<void>;

    static create(): Promise<Sandbox>;
    static get(options: { sandboxId: string }): Promise<Sandbox>;
  }
}
