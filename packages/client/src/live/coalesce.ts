// FIX-2551.
/**
 * The one coalescer: one read in flight and at most one waiting, however many
 * notices land. Every live read in the framework and its apps goes through
 * this file (`client.live`); a lint rule (`fsd/one-coalescer`) keeps a second
 * one from being written anywhere else. Not public.
 */
import { wireTopicKey, type WireNotice } from "@flow-state-dev/contracts";

/**
 * What a waiting read is handed when a second notice joins it: the same
 * notice is kept, a different one widens it to `null` (read everything).
 * Notices with keys will union here, and only here.
 */
function mergeNotices(waiting: WireNotice | null, next: WireNotice | null): WireNotice | null {
  if (waiting === null || next === null) return null;
  const same =
    waiting.kind === next.kind &&
    wireTopicKey(waiting.topic) === wireTopicKey(next.topic) &&
    waiting.origin?.requestId === next.origin?.requestId;
  return same ? waiting : null;
}

/** A coalesced read: `request` a read for a notice, `close` to drop the waiting one. */
export type Coalesced = {
  request(notice: WireNotice | null): void;
  close(): void;
};

/**
 * Run `read` on request, one at a time. A request made while a read runs
 * queues exactly one more, which starts once that read settles, with the
 * requests' notices merged. `read` settles however it went; `close` drops
 * the waiting one.
 */
export function coalesce(read: (notice: WireNotice | null) => Promise<void>): Coalesced {
  let running = false;
  let queued = false;
  let next: WireNotice | null = null;
  let closed = false;

  const run = (notice: WireNotice | null): void => {
    running = true;
    const settled = (): void => {
      running = false;
      if (closed || !queued) return;
      queued = false;
      const waiting = next;
      next = null;
      run(waiting);
    };
    read(notice).then(settled, settled);
  };

  return {
    request(notice) {
      if (closed) return;
      if (!running) return run(notice);
      next = queued ? mergeNotices(next, notice) : notice;
      queued = true;
    },
    close() {
      closed = true;
      queued = false;
      next = null;
    }
  };
}
