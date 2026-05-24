/**
 * Per-request `Thread` / `Message` registry.
 *
 * The Chat SDK delivers a live `thread` and `message` to its callbacks.
 * `host.dispatch` then runs the flow asynchronously; the capability and
 * utility blocks need the same `thread` reference to post back to the
 * originating chat. We index by `requestId` (assigned by the host),
 * register on dispatch, clear when the run finishes, and run a periodic
 * GC sweep against a hard ceiling so a runaway flow can't grow the map
 * forever.
 */
import type { Thread, Message } from "chat";

interface Entry {
  thread: Thread | null;
  message: Message | null;
  registeredAt: number;
}

const registry = new Map<string, Entry>();

/** Hard ceiling at 30 min — matches Chat SDK's own per-thread lock TTL. */
const MAX_AGE_MS = 30 * 60 * 1000;

let lastSweepAt = 0;

export function setThreadForRequest(
  requestId: string,
  thread: Thread | null,
  message: Message | null
): void {
  registry.set(requestId, { thread, message, registeredAt: Date.now() });
  maybeSweep();
}

export function getThreadForRequest(requestId: string): Thread | null {
  return registry.get(requestId)?.thread ?? null;
}

export function getMessageForRequest(requestId: string): Message | null {
  return registry.get(requestId)?.message ?? null;
}

export function clearThreadForRequest(requestId: string): void {
  registry.delete(requestId);
}

/** Exposed for tests to assert no leaks. */
export function _registrySize(): number {
  return registry.size;
}

function maybeSweep(): void {
  const now = Date.now();
  if (now - lastSweepAt < 60_000) return;
  lastSweepAt = now;
  for (const [id, entry] of registry) {
    if (now - entry.registeredAt > MAX_AGE_MS) registry.delete(id);
  }
}
