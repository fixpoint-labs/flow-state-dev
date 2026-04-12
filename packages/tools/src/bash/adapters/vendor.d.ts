/**
 * Ambient module declarations for optional peer dependencies.
 *
 * These modules are dynamically imported only when their corresponding
 * sandbox adapter is selected. Declaring them here prevents TS2307 errors
 * without requiring the packages to be installed.
 */

declare module "just-bash" {
  /** Copy-on-write over a real directory. Reads from disk, writes stay in memory. */
  export class OverlayFs {
    constructor(options: { root: string; readOnly?: boolean });
  }

  /** Direct read-write access to the real filesystem. */
  export class ReadWriteFs {
    constructor(options: { root: string });
  }

  export interface BashOptions {
    files?: Record<string, string | (() => string | Promise<string>)>;
    fs?: OverlayFs | ReadWriteFs | unknown;
    env?: Record<string, string>;
    cwd?: string;
    executionLimits?: {
      maxCallDepth?: number;
      maxCommandCount?: number;
      maxLoopIterations?: number;
      maxAwkIterations?: number;
      maxSedIterations?: number;
    };
    python?: boolean;
    javascript?: boolean | { bootstrap?: string };
    network?: {
      dangerouslyAllowFullInternetAccess?: boolean;
      allowedUrls?: Array<{
        url: string;
        methods?: string[];
        headers?: Record<string, string>;
      }>;
    };
    customCommands?: unknown[];
  }

  export interface BashResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    metadata?: unknown;
  }

  export class Bash {
    constructor(options?: BashOptions);
    // eslint-disable-next-line @typescript-eslint/method-signature-style
    exec(command: string, options?: {
      env?: Record<string, string>;
      cwd?: string;
      stdin?: string;
      signal?: AbortSignal;
    }): Promise<BashResult>;
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
