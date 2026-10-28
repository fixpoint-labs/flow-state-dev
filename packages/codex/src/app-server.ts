/**
 * A short-lived `codex app-server`, spoken to over its stdio JSON-RPC: the
 * channel `./usage` and `./model-list` read Codex through with no run.
 *
 * The app-server is the program the SDK runs, so a read sees the sign-in and
 * catalog a run would. Its requests are the ones the pinned CLI's
 * `generate-ts` publishes.
 */
import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import type { CodexProgram } from "./usage";

/** A read that ended before Codex answered: a timeout, an abort, or the program gone. Its message is the reason shown. */
export class ReadStopped extends Error {}

/** One `codex app-server` child, spoken to over newline-delimited JSON-RPC on stdio. */
export function startAppServer(program: CodexProgram, env: Record<string, string>) {
  const PATH = [...program.pathDirs, env.PATH ?? ""].filter((dir) => dir !== "").join(delimiter);
  // stderr is dropped: what a person is shown is a plain reason, never the CLI's own output.
  // Cast because a host's types (Next's) may make `NODE_ENV` required; this child gets `env` alone.
  const child = spawn(program.path, ["app-server"], {
    env: { ...env, PATH } as Record<string, string> as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stopped: ReadStopped | undefined;
  let buffer = "";

  const fail = (error: ReadStopped) => {
    stopped ??= error;
    for (const waiter of pending.values()) waiter.reject(stopped);
    pending.clear();
  };
  child.on("error", () => fail(new ReadStopped("The Codex CLI could not be started")));
  child.on("exit", () => fail(new ReadStopped("Codex stopped before it answered")));
  child.stdin.on("error", () => fail(new ReadStopped("Codex stopped before it answered")));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      let message: { id?: unknown; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      // Notifications and server requests carry no id of ours; only answers are read.
      if (typeof message.id !== "number") continue;
      const waiter = pending.get(message.id);
      if (waiter === undefined) continue;
      pending.delete(message.id);
      if (message.error !== undefined) waiter.reject(new Error("Codex refused the request"));
      else waiter.resolve(message.result);
    }
  });

  const send = (message: Record<string, unknown>) => {
    if (stopped === undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  return {
    request(method: string, params: unknown): Promise<unknown> {
      if (stopped !== undefined) return Promise.reject(stopped);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    notify(method: string): void {
      send({ method });
    },
    stop(reason: string): void {
      fail(new ReadStopped(reason));
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

