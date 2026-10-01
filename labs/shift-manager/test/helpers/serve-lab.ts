/**
 * Serve a Lab's `FlowState` on a free loopback port for a test, the way the
 * start script does, minus shift-manager's pages: the reads under test go to the
 * Lab's shipped routes, never to a mock.
 */
import type { FlowState } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";

/**
 * A served Lab: where it answers and how to stop it. `baseUrl` is the origin;
 * the FSD clients add `/api/flows` themselves.
 */
export type ServedLab = { baseUrl: string; handle: ServeHandle };

/** Serve `flowState` under `/api/flows` on 127.0.0.1 and a free port. */
export async function serveLab(flowState: FlowState): Promise<ServedLab> {
  const handle = await serve(flowState, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  await flowState.ready();
  return { baseUrl: `http://127.0.0.1:${handle.port}`, handle };
}

/** Poll `check` until it returns a value, or fail after `timeoutMs`. */
export async function eventually<T>(check: () => Promise<T | undefined>, what: string, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
