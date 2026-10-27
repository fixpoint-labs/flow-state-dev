/**
 * `env`: Cursor's local runtime in a child process whose environment is
 * exactly the block's `env`.
 *
 * Cursor's SDK takes no environment option, and every shell its local runtime
 * starts copies the environment of the process the SDK runs in. Run in the
 * server's own process, a command Cursor runs starts with every key, token and
 * connection string the server holds. The one lever is the process itself, so
 * when a host sets `env` this package starts a separate Node process with that
 * environment and nothing inherited, loads the SDK there, and drives the agent
 * over the IPC channel. `runtime/cursor-runtime-child.mjs` is the other half.
 *
 * This narrows what commands start with; it is not a security boundary. The
 * child runs as the same OS user, and on Linux a command can still read the
 * server's environment through `/proc/<pid>/environ`. Containing a command
 * that goes looking takes a separate user or a container.
 *
 * The client this builds satisfies the same seam the in-process client does
 * ({@link ResolvedCursorClient}), so the block cannot tell them apart. Each
 * `create`/`resume` starts its own process, which ends when the block closes
 * the agent.
 *
 * **Never a fallback.** A process that cannot start, or that dies, fails the
 * run with that reason. Running in-process instead would quietly start the
 * run's commands with the environment the host chose not to hand them.
 *
 * The protocol: the parent sends `{ id, op }` requests (`open`, `send`, `wait`,
 * `steer`, `cancel`) and the child answers `{ id, value }` or `{ id, error }`. After
 * `send`, the child streams `{ event: "message" }` for each run message, then
 * `{ event: "end" }` or `{ event: "stream-error" }`. The parent closing the
 * channel tells the child to close the agent and exit.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CursorAgentLike,
  CursorCreateOptions,
  CursorRunLike,
  CursorRunResult,
  CursorSdkMessage,
  CursorSendOptions,
  ResolveCursorClient,
  ResolvedCursorClient,
} from "./types";

/**
 * The child script, beside `src/` in the workspace and beside `dist/` once
 * published: one directory up from this module either way.
 */
const CHILD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "cursor-runtime-child.mjs");

/** How long a closed agent's process gets to exit on its own before it is killed. */
const CLOSE_GRACE_MS = 10_000;

/** How much of the child's stderr a failure message carries. */
const STDERR_TAIL_BYTES = 2_000;

/** Options for {@link createChildProcessResolveCursorClient}. */
export interface ChildRuntimeOptions {
  /** The child's whole environment. Nothing else is inherited. */
  env: Record<string, string>;
  /** The module the child loads the SDK from. Default `@cursor/sdk`. A test seam. */
  sdkModule?: string;
}

/** An error the child reported, rebuilt with its class name and code. */
function rebuildError(data: { name?: string; message?: string; code?: string }): Error {
  const err = new Error(data.message ?? "Cursor's runtime process failed.") as Error & { code?: string };
  if (typeof data.name === "string") err.name = data.name;
  if (typeof data.code === "string") err.code = data.code;
  return err;
}

/** A live child process and the requests waiting on it. */
class ChildRuntime {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private failure: Error | null = null;
  private stderrTail = "";
  private readonly queue: CursorSdkMessage[] = [];
  private streamDone = false;
  private streamError: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(options: ChildRuntimeOptions) {
    // `spawn` of this Node with an IPC channel, which is what `fork` does with
    // `execArgv: []`: no inspector or loader flag of the parent's reaches the
    // run. Not `fork` itself, because a bundler that traces `fork` (Next's
    // Turbopack) fails the build on a script path it can't resolve statically.
    this.child = spawn(process.execPath, [CHILD_SCRIPT, options.sdkModule ?? "@cursor/sdk"], {
      // A copy, so nothing a caller adds to its object later reaches the child.
      env: { ...options.env },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    this.child.on("message", (msg) => this.onMessage(msg as Record<string, unknown>));
    this.child.on("error", (err) => {
      this.fail(new Error(`Cursor's runtime process could not be started: ${err.message}`));
    });
    this.child.on("exit", (code, signal) => {
      const how = signal !== null ? `signal ${signal}` : `code ${String(code)}`;
      const tail = this.stderrTail.trim();
      this.fail(new Error(`Cursor's runtime process exited (${how}).${tail === "" ? "" : `\n${tail}`}`));
    });
  }

  /** Ask the child to do `op`, and wait for its answer. */
  request(op: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.send({ id, op, ...payload }, (err) => {
          if (err) this.settle(id, undefined, err);
        });
      } catch (err) {
        this.settle(id, undefined, err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** The run's messages, in the order the child read them. */
  async *messages(): AsyncGenerator<CursorSdkMessage> {
    for (;;) {
      const next = this.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.streamError !== null) throw this.streamError;
      if (this.streamDone) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  /** Close the channel, which tells the child to close the agent and exit. */
  close(): void {
    if (this.child.connected) this.child.disconnect();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const timer = setTimeout(() => this.child.kill("SIGKILL"), CLOSE_GRACE_MS);
      timer.unref();
      this.child.once("exit", () => clearTimeout(timer));
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (typeof msg.id === "number") {
      const error = msg.error as Record<string, string> | undefined;
      this.settle(msg.id, msg.value, error === undefined ? undefined : rebuildError(error));
      return;
    }
    if (msg.event === "message") this.queue.push(msg.message as CursorSdkMessage);
    else if (msg.event === "end") this.streamDone = true;
    else if (msg.event === "stream-error") {
      this.streamError = rebuildError(msg.error as Record<string, string>);
    }
    this.notify();
  }

  private settle(id: number, value: unknown, error: Error | undefined): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.delete(id);
    if (error !== undefined) entry.reject(error);
    else entry.resolve(value);
  }

  /** The process is gone: every waiter fails with why. */
  private fail(err: Error): void {
    if (this.failure !== null) return;
    this.failure = err;
    for (const [id] of this.pending) this.settle(id, undefined, err);
    if (!this.streamDone && this.streamError === null) this.streamError = err;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

/** Open (or resume) an agent in a new child process. */
async function openInChild(
  options: ChildRuntimeOptions,
  agentId: string | null,
  createOptions: CursorCreateOptions & { local?: { cwd?: string } },
): Promise<CursorAgentLike> {
  const runtime = new ChildRuntime(options);
  let opened: { agentId: string };
  try {
    opened = (await runtime.request("open", { agentId, options: createOptions })) as { agentId: string };
  } catch (err) {
    runtime.close();
    throw err;
  }
  let sent = false;
  return {
    agentId: opened.agentId,
    async send(prompt: string, sendOptions?: CursorSendOptions): Promise<CursorRunLike> {
      if (sent) throw new Error("This Cursor agent's runtime process serves one run.");
      sent = true;
      const started = (await runtime.request("send", { prompt, options: sendOptions })) as {
        runId: string;
        supportsWait: boolean;
        supportsSteer?: boolean;
      };
      return {
        id: started.runId,
        stream: () => runtime.messages(),
        wait: () => runtime.request("wait") as Promise<CursorRunResult>,
        cancel: async () => {
          await runtime.request("cancel");
        },
        supports: (operation: string) => (operation === "wait" ? started.supportsWait : true),
        // Only a run the child found able to steer has one, so the block never offers a steer it can't take.
        ...(started.supportsSteer === true
          ? { steer: (text: string) => runtime.request("steer", { text }) as Promise<string> }
          : {}),
      };
    },
    close: () => runtime.close(),
  };
}

/**
 * A client that runs every agent in its own child process with exactly `env`.
 *
 * Resolving starts nothing; the process starts on `create` or `resume`.
 */
export function createChildProcessResolveCursorClient(options: ChildRuntimeOptions): ResolveCursorClient {
  return (): ResolvedCursorClient => ({
    create: (createOptions) => openInChild(options, null, createOptions),
    resume: (agentId, createOptions) => openInChild(options, agentId, createOptions),
  });
}
