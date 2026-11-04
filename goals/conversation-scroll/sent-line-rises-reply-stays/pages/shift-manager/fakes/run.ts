/** A run's items, read and followed from the script. See `../shared.ts`. */
export * from "../../../lib/run";
import type { OutputItem } from "@flow-state-dev/core/items";
import { script } from "../../script";
import { itemsOf } from "../shared";

export async function readSessionItems(_client: unknown, sessionId: string) {
  return { items: itemsOf(sessionId), truncated: false };
}

/** The run's own request streams every change to its session; a request a send started adds nothing more. */
export function followRequest(_client: unknown, run: { sessionId?: string }, handlers: { onItem: (item: OutputItem) => void }) {
  const sessionId = run.sessionId;
  if (sessionId === undefined) return { close: () => undefined };
  const stop = script.subscribe(() => {
    for (const item of itemsOf(sessionId)) handlers.onItem(item);
  });
  return { close: stop };
}

export function taskItems(items: OutputItem[]) {
  return { items, shared: false };
}
