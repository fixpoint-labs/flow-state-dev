/**
 * Real processes for a goal that grades what crosses between them (FIX-2427,
 * shared with the epic closure FIX-2368).
 *
 * One process with two registries is not two processes: it shares module
 * state, timers and an event loop, and a bus that only reaches its own
 * process passes there. So the goal forks each peer (`child_process.fork`,
 * under the same `tsx` loader) and drives it over IPC: the runner calls a
 * named command and awaits its answer, and the peer may push events back
 * unasked (an SSE frame its view received, stamped where it was received).
 *
 * The runner side is {@link forkPeer}; the peer side, in the forked module,
 * is {@link servePeer}. Not re-exported from `index.mts`; import directly:
 *
 *   import { forkPeer } from "../../lib/peers.mts";      // the runner
 *   import { servePeer } from "../../lib/peers.mts";     // the peer module
 */
import { fork, type ChildProcess } from "node:child_process";

type Call = { id: number; command: string; args: unknown };
type Answer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };
type Pushed = { event: string; data: unknown };

/** A forked peer, as the runner holds it. */
export type Peer = {
  readonly name: string;
  /** Run `command` in the peer and await what it returns. Rejects with the peer's error. */
  call<T = unknown>(command: string, args?: unknown): Promise<T>;
  /** Hear every `event` the peer pushes. */
  on(event: string, listener: (data: unknown) => void): void;
  /** Ask the peer to stop (its `stop` command, when it has one), then end the process. */
  stop(): Promise<void>;
};

/**
 * Fork `modulePath` as a peer named `name`, with `env` added to this
 * process's environment, and wait until it says it is ready.
 *
 * @throws When the peer exits or fails before it is ready.
 */
export async function forkPeer(modulePath: string, name: string, env: Record<string, string> = {}): Promise<Peer> {
  const child: ChildProcess = fork(modulePath, [], {
    env: { ...process.env, ...env, GOAL_PEER_NAME: name },
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Array<(data: unknown) => void>>();
  let next = 0;
  let exited = false;

  const ready = new Promise<void>((resolve, reject) => {
    child.on("message", (message: Answer | Pushed | { ready: true }) => {
      if ("ready" in message) return resolve();
      if ("event" in message) {
        for (const listener of listeners.get(message.event) ?? []) listener(message.data);
        return;
      }
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.ok) pending?.resolve(message.value);
      else pending?.reject(new Error(`${name}: ${message.error}`));
    });
    child.on("exit", (code, signal) => {
      exited = true;
      const error = new Error(`${name} exited (${code ?? signal})`);
      reject(error);
      for (const pending of waiting.values()) pending.reject(error);
      waiting.clear();
    });
  });
  await ready;

  return {
    name,
    call<T>(command: string, args?: unknown): Promise<T> {
      if (exited) return Promise.reject(new Error(`${name} has exited`));
      const id = (next += 1);
      return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
        child.send({ id, command, args } satisfies Call);
      });
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    async stop() {
      if (exited) return;
      const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      try {
        await Promise.race([
          this.call("stop"),
          new Promise((resolve) => setTimeout(resolve, 10_000))
        ]);
      } catch {
        // A peer with no `stop`, or one already failing, is ended below.
      }
      if (!exited) child.kill("SIGTERM");
      await gone;
    }
  };
}

/**
 * Serve `commands` to the runner that forked this process, then say ready.
 * A `stop` command, when given, runs before the process exits on the
 * runner's `stop()`.
 *
 * @returns `push`, to send the runner an event unasked.
 */
export function servePeer(commands: Record<string, (args: any) => unknown>): { push(event: string, data: unknown): void } {
  if (process.send === undefined) throw new Error("servePeer: this module runs only as a forked peer (forkPeer)");
  const send = process.send.bind(process);
  process.on("message", (message: Call) => {
    const handler = commands[message.command];
    void (async () => {
      try {
        if (handler === undefined) throw new Error(`no command "${message.command}"`);
        const value = await handler(message.args);
        send({ id: message.id, ok: true, value } satisfies Answer);
        if (message.command === "stop") setTimeout(() => process.exit(0), 10);
      } catch (error) {
        send({ id: message.id, ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) } satisfies Answer);
      }
    })();
  });
  // The runner owns this process: it lives while the IPC channel does.
  process.on("disconnect", () => process.exit(0));
  send({ ready: true });
  return {
    push(event, data) {
      send({ event, data } satisfies Pushed);
    }
  };
}
