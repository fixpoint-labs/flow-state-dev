/** A run's items, read and followed from the script. See `../shared.ts`. */
export * from "../../../lib/run";
import type { OutputItem } from "@flow-state-dev/core/items";
import { script } from "../../script";
import { itemsOf } from "../shared";

/** The session feed: the script's lines now, then again on each change to them. */
export function followSessionItems(_client: unknown, sessionId: string, to: { onRead(read: { items: OutputItem[]; truncated: boolean }): void }) {
  const read = () => to.onRead({ items: itemsOf(sessionId), truncated: false });
  read();
  return script.subscribe(read);
}

/** The run's request stream reports only its status, which the script never moves. */
export function followRequest() {
  return { close: () => undefined };
}

export function taskItems(items: OutputItem[]) {
  return { items, shared: false };
}
