/**
 * A test double of `client.live` over a test's fake `subscribe`, for a fake
 * client the adapter watches through: `get live() { return liveOver(this); }`.
 *
 * A lab may not import the client's internal live read, so this keeps only
 * what the adapter's watches rely on: read at start, read on a connect, a
 * tick, a `resync` or a notice `hear` and `paths` let through, one read at a
 * time with one more after it, report a value only when it changed, and on a
 * failure say stale and try again after 1 s. With `topicsFromResult`, each
 * read also names the topics to hear: when they change, the subscription
 * moves to them and reads once more. The real live read is pinned by
 * `packages/client/test/live.test.ts`, and both labs run on it in
 * `goals/realtime/app-views-read-on-notice` and `goals/live-read/one-loop-every-watcher`.
 */
import type { Client, LivePaths, LiveRead, LiveReadOptions, LiveReadWithTopicsOptions, WireNotice, WireTopic } from "@flow-state-dev/client";

const under = (path: string, roots: readonly string[] | undefined) =>
  roots === undefined || roots.some((root) => root === "" || path === root || path.startsWith(`${root.replace(/\/+$/, "")}/`));

function heard(notice: WireNotice, hear: ((notice: WireNotice) => boolean) | undefined, paths: LivePaths | undefined): boolean {
  if (notice.kind === "resync") return true;
  if (hear !== undefined && !hear(notice)) return false;
  if (paths === undefined || notice.kind !== "resource" || notice.topic.resource === undefined) return true;
  return under(notice.topic.resource, typeof paths === "function" ? paths(notice.topic.scope) : paths);
}

/** `client.live`, riding whatever `subscribe` the fake holds when it is called. */
export function liveOver(fake: { subscribe: Client["subscribe"] }): Client["live"] {
  return ((topics: readonly WireTopic[], options: LiveReadOptions<unknown> | LiveReadWithTopicsOptions<unknown>): LiveRead => {
    const ended = new AbortController();
    let closed = false;
    let busy = false;
    let again = false;
    let stale = false;
    let last: string | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const run = async (): Promise<void> => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const result = await options.read(null, ended.signal);
        const value = options.topicsFromResult === true ? (result as { value: unknown }).value : result;
        if (options.topicsFromResult === true && !closed) {
          const next = (result as { topics: readonly WireTopic[] }).topics;
          if (JSON.stringify(next) !== JSON.stringify(heldTopics)) {
            subscription.close();
            heldTopics = next;
            subscription = subscribeTo(next);
            again = true;
          }
        }
        clearTimeout(retry);
        const seen = JSON.stringify(value);
        if (!closed && seen !== last) {
          last = seen;
          options.onValue?.(value);
        }
        if (!closed && stale) {
          stale = false;
          options.onStale?.(false);
        }
      } catch (error) {
        if (!closed) {
          last = undefined;
          clearTimeout(retry);
          retry = setTimeout(() => void run(), 1_000);
          if (!stale) {
            stale = true;
            options.onStale?.(true);
          }
          options.onError?.(error);
        }
      }
      busy = false;
      if (again) {
        again = false;
        void run();
      }
    };
    const subscribeTo = (wanted: readonly WireTopic[]) =>
      fake.subscribe(wanted, {
        onChange: (notice) => {
          if (notice === null || heard(notice, options.hear, options.paths)) void run();
        },
        ...(options.pollIntervalMs != null ? { pollIntervalMs: options.pollIntervalMs } : {}),
      });
    let heldTopics = topics;
    let subscription = subscribeTo(topics);
    if (options.readNow !== false) void run();
    return {
      refresh: () => void run(),
      close: () => {
        closed = true;
        clearTimeout(retry);
        ended.abort();
        subscription.close();
      },
    };
  }) as Client["live"];
}
