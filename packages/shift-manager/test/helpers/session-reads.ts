// Test helpers: the reads the app made of a session and a run until FIX-2776 moved its screens
// onto package hooks. A test of a real Lab still reads the store this way to check what landed.
import { compareItemOrder, type OutputItem } from "@flow-state-dev/core/items";
import type { Client } from "@flow-state-dev/client";

/** Items per session-state page, and the pages read at most. */
const ITEM_PAGE = 200;
const ITEM_PAGES = 5;

/** A session's stored items, oldest first, and whether there were more than were read. */
export async function readSessionItems(client: Pick<Client, "sessions">, sessionId: string): Promise<{ items: OutputItem[]; truncated: boolean }> {
  const items: OutputItem[] = [];
  let offset = 0;
  for (let page = 0; page < ITEM_PAGES; page += 1) {
    const state = await client.sessions.state(sessionId, { includeItems: true, offset, limit: ITEM_PAGE });
    items.push(...(state.items ?? []));
    if (state.pagination?.hasMore !== true) return { items: items.sort(compareItemOrder), truncated: false };
    offset = state.pagination.nextOffset ?? offset + ITEM_PAGE;
  }
  return { items: items.sort(compareItemOrder), truncated: true };
}

/** The flow that owns `sessionId`, as its session records it. */
export async function readRunFlow(client: Pick<Client, "sessions">, sessionId: string): Promise<string> {
  const flowId = (await client.sessions.get(sessionId)).flowId;
  if (flowId == null || flowId.length === 0) throw new Error("The run's session names no owning flow.");
  return flowId;
}

/** Follow a run's request live through its flow: each finished, non-transient item, and each status. */
export function followRequest(
  client: Pick<Client, "flow">,
  run: { flowId: string; requestId: string },
  to: { onItem(item: OutputItem): void; onStatus(status: string, at?: number): void; onError(error: unknown): void },
): { close(): void } {
  return client.flow(run.flowId).request(run.requestId).stream({
    onItemDone: (event) => {
      const item = event.item as OutputItem & { transient?: boolean };
      if (item.transient !== true) to.onItem(item);
    },
    onRequestStatus: (event) => to.onStatus(event.status, typeof event.ts === "number" ? event.ts : undefined),
    onError: (error) => to.onError(error),
  });
}
