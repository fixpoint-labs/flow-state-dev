// FIX-2551.
/**
 * `client.live`: keep a screen current on change notices. One live read
 * turns a subscription's notices into reads, the same way for every screen:
 *
 * 1. **Filter.** A notice is heard when the caller's `hear` says so and, for
 *    a `resource` notice that names a path, when the path may belong under
 *    one of the caller's `paths` (the path rule, `paths.ts`). A connect, a
 *    reconnect, a tick (`null`) and a `resync` are always heard. The filter
 *    runs before the merge, so a notice nobody hears never turns a waiting
 *    read into a read of everything.
 * 2. **Merge, then one read in flight and at most one waiting** (`coalesce.ts`).
 * 3. **Read**, and report the value only when it changed, compared by value.
 * 4. **A failed read** tries again on its own, on the client's backoff (1 s
 *    doubling to 30 s), and the screen hears it is stale until a read lands:
 *    while push is up there is no timer, so nothing else would read again.
 *
 * A read may also return the topics to hear next (`topicsFromResult`). When
 * that set changes (deduped and sorted, so an unchanged set never churns) the
 * live read closes its subscription, subscribes the new topics, and reads once
 * more, so a change between the two is not missed.
 *
 * The internal entry, `liveRead`, takes the subscription function, so a
 * framework hook that holds only `subscribe` (React's `useSubscription`, its
 * panels) builds the same live read. Apps call `client.live`.
 */
import { wireTopicKey, type WireNotice, type WireTopic } from "@flow-state-dev/contracts";
import { backoffDelay } from "../internal/backoff";
import type { SubscribeOptions, Subscription } from "../subscribe/push-hub";
import { coalesce } from "./coalesce";
import { mayHold } from "./paths";

/** The pace a live read reads at wherever push can miss a change, unless told otherwise. */
const LIVE_POLL_MS = 3_000;

/**
 * Which resource paths a live read hears: roots (a notice at a root or below
 * it reads), or roots per scope. `undefined` from the function rules nothing
 * out, for roots not known yet.
 */
export type LivePaths = readonly string[] | ((scope: WireTopic["scope"]) => readonly string[] | undefined);

/** What a read hands back when it also names the topics to hear next. */
export type LiveResult<T> = { value: T; topics: readonly WireTopic[] };

type LiveReadBase<T> = {
  /** Called with each value read, only when it differs (by value) from the last one reported. */
  onValue?: (value: T) => void;
  /** Called with each failed read's error. The read tries again on its own. */
  onError?: (error: unknown) => void;
  /** `true` when a read fails, `false` when one lands after it. */
  onStale?: (stale: boolean) => void;
  /**
   * Which notices may change what the read shows. A connect, a reconnect, a
   * tick and a `resync` read whatever this says. Default: every notice.
   */
  hear?: (notice: WireNotice) => boolean;
  /** The resource paths a `resource` notice must fall under to read. Default: every path. */
  paths?: LivePaths;
  /**
   * The timer's pace wherever push can miss a change: no push, the socket
   * down, a bus that doesn't cross processes. Default 3 s; `null` for none.
   */
  pollIntervalMs?: number | null;
  /** Read once at start. Default `true`; `false` leaves the first read to the subscription's connect. */
  readNow?: boolean;
};

/** Options for `client.live`. `read` gets the notice that woke it, or `null` for several, a connect or a tick. */
export type LiveReadOptions<T> = LiveReadBase<T> & {
  read: (notice: WireNotice | null, signal: AbortSignal) => T | PromiseLike<T>;
  topicsFromResult?: false;
};

/** Options for `client.live` when each read also names the topics to hear next. */
export type LiveReadWithTopicsOptions<T> = LiveReadBase<T> & {
  read: (notice: WireNotice | null, signal: AbortSignal) => LiveResult<T> | PromiseLike<LiveResult<T>>;
  topicsFromResult: true;
};

/** A running live read. */
export type LiveRead = {
  /** Read again now, through the same queue. */
  refresh(): void;
  /** Stop: the subscription closes, a read still out is for nobody, and nothing more is reported. */
  close(): void;
};

/** The subscription a live read rides. */
export type LiveSubscribe = (topics: readonly WireTopic[], options: SubscribeOptions) => Subscription;

/** One key per distinct topic set, so the same topics in another order or repeated keep the subscription. */
const topicSetKey = (topics: readonly WireTopic[]): string =>
  [...new Set(topics.map(wireTopicKey))].sort().join("\u0001");

/** Start a live read over `subscribe`. See the file header. */
export function liveRead<T>(subscribe: LiveSubscribe, topics: readonly WireTopic[], options: LiveReadOptions<T>): LiveRead;
export function liveRead<T>(subscribe: LiveSubscribe, topics: readonly WireTopic[], options: LiveReadWithTopicsOptions<T>): LiveRead;
export function liveRead<T>(
  subscribe: LiveSubscribe,
  topics: readonly WireTopic[],
  options: LiveReadOptions<T> | LiveReadWithTopicsOptions<T>
): LiveRead {
  const { hear, paths, onValue, onError, onStale, readNow = true } = options;
  const pollIntervalMs = options.pollIntervalMs === undefined ? LIVE_POLL_MS : options.pollIntervalMs;
  const ended = new AbortController();
  let closed = false;
  let stale = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** What was last reported; cleared by a failure, so the next value that lands is reported. */
  let last: string | undefined;
  let reported = false;

  const heard = (notice: WireNotice): boolean => {
    if (notice.kind === "resync") return true;
    if (hear !== undefined && !hear(notice)) return false;
    if (paths === undefined || notice.kind !== "resource") return true;
    const path = notice.topic.resource;
    return path === undefined || mayHold(path, typeof paths === "function" ? paths(notice.topic.scope) : paths);
  };

  const landed = (value: T): void => {
    failures = 0;
    clearTimeout(retry);
    retry = undefined;
    if (onValue !== undefined) {
      const seen = JSON.stringify(value);
      if (!reported || seen !== last) {
        reported = true;
        last = seen;
        onValue(value);
      }
    }
    if (stale) {
      stale = false;
      onStale?.(false);
    }
  };

  const failed = (error: unknown): void => {
    reported = false;
    last = undefined;
    clearTimeout(retry);
    retry = setTimeout(() => reads.request(null), backoffDelay(failures));
    failures += 1;
    if (!stale) {
      stale = true;
      onStale?.(true);
    }
    onError?.(error);
  };

  const reads = coalesce(async (notice) => {
    if (closed) return;
    let result: unknown;
    try {
      result = await options.read(notice, ended.signal);
    } catch (error) {
      if (!closed) failed(error);
      return;
    }
    if (closed) return;
    if (options.topicsFromResult === true) {
      const { value, topics: next } = result as LiveResult<T>;
      landed(value);
      if (!closed && topicSetKey(next) !== currentKey) follow(next);
    } else {
      landed(result as T);
    }
  });

  const subscribeTo = (wanted: readonly WireTopic[]): Subscription =>
    subscribe(wanted, {
      onChange: (notice) => {
        if (notice === null || heard(notice)) reads.request(notice);
      },
      ...(pollIntervalMs !== null ? { pollIntervalMs } : {})
    });

  let currentKey = topicSetKey(topics);
  let subscription = subscribeTo(topics);

  /** Hear `next` instead, and read once it is held. */
  const follow = (next: readonly WireTopic[]): void => {
    subscription.close();
    currentKey = topicSetKey(next);
    subscription = subscribeTo(next);
    reads.request(null);
  };

  if (readNow) reads.request(null);

  return {
    refresh: () => reads.request(null),
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(retry);
      ended.abort();
      reads.close();
      subscription.close();
    }
  };
}
