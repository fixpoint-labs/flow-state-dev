/**
 * Bridge from the runtime `ResponseEmitter` to a `Thread.post`-shaped
 * async iterable of strings.
 *
 * Subscribes to the emitter, converts each `RequestStreamEvent` into zero
 * or more text chunks, and yields them through an async iterator until a
 * terminal request status (`completed`/`failed`/`aborted`/`incomplete`/
 * `interrupted`) arrives. Optional `itemToChunk` runs first; returning
 * `undefined` falls through to the default behavior:
 *
 *   - `content.delta` → push `event.delta` (track the producing `itemId`).
 *   - `item.done` of `type: "message"` → if that `itemId` already
 *     streamed, skip (already represented); otherwise concatenate any
 *     `output_text` parts as a single chunk. Covers non-streaming
 *     generators.
 */
import type { ResponseEmitter, RequestStreamEventWithId } from "@flow-state-dev/server";
import type { RequestStatus } from "@flow-state-dev/core/types";

const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set([
  "completed",
  "failed",
  "aborted",
  "incomplete",
  "interrupted",
]);

export type ItemToChunkFn = (
  event: RequestStreamEventWithId
) => string | null | undefined;

/**
 * Returns an async iterable that yields text chunks until the emitter
 * reaches a terminal request status. Begin observing immediately so
 * deltas emitted before the consumer pulls aren't dropped.
 */
export function bridgeStreamToThread(
  emitter: ResponseEmitter,
  itemToChunk?: ItemToChunkFn,
  onObserverError?: (err: unknown) => void
): AsyncIterable<string> {
  const buffer: string[] = [];
  let waiter: { resolve: () => void } | null = null;
  let done = false;
  const deltaItemIds = new Set<string>();

  const push = (chunk: string): void => {
    if (chunk.length === 0) return;
    buffer.push(chunk);
    waiter?.resolve();
    waiter = null;
  };

  emitter.addEventObserver((event) => {
    try {
      if (itemToChunk !== undefined) {
        const custom = itemToChunk(event);
        if (custom !== undefined) {
          if (custom !== null) push(custom);
          if (isTerminal(event)) finish();
          return;
        }
      }

      if (event.type === "content.delta") {
        if (typeof event.delta === "string" && event.delta.length > 0) {
          deltaItemIds.add(event.itemId);
          push(event.delta);
        }
      } else if (event.type === "item.done") {
        const item = event.item;
        if (
          item.type === "message" &&
          !deltaItemIds.has(item.id) &&
          Array.isArray(item.content)
        ) {
          const text = item.content
            .filter((c): c is { type: "output_text"; text: string } =>
              c.type === "output_text" && typeof c.text === "string"
            )
            .map((c) => c.text)
            .join("");
          if (text.length > 0) push(text);
        }
      }

      if (isTerminal(event)) finish();
    } catch (err) {
      onObserverError?.(err);
    }
  });

  function finish(): void {
    if (done) return;
    done = true;
    waiter?.resolve();
    waiter = null;
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        async next(): Promise<IteratorResult<string>> {
          while (true) {
            if (buffer.length > 0) {
              return { value: buffer.shift()!, done: false };
            }
            if (done) return { value: undefined, done: true };
            await new Promise<void>((resolve) => {
              waiter = { resolve };
            });
          }
        },
      };
    },
  };
}

function isTerminal(event: RequestStreamEventWithId): boolean {
  if (!event.type.startsWith("request.")) return false;
  // RequestStatusEvent carries `status` — every other `request.*` event
  // (currently only `request.created`) doesn't.
  const status = (event as { status?: RequestStatus }).status;
  return status !== undefined && TERMINAL_STATUSES.has(status);
}
