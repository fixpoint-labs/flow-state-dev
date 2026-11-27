// FIX-2623.
/**
 * `useView(ref, input, options)`: a view's answer, typed by the view, and
 * kept current.
 *
 * The screen names no topic. Each answer carries the change topics of what
 * the view's run read, and the client's live read listens to those, reading
 * again on a change and listening to new topics when they change
 * (`watchView` on `client.live`). Every screen in the app watching the same
 * view with the same input shares one read. A keyed view's rows keep their
 * identity across answers while they don't change.
 *
 * `value` is `undefined` until the first answer lands. `stale` is `true`
 * while the last read failed, and `failure` says why; the live read tries
 * again on its own, and `refresh()` reads again now.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewCallOptions, ViewInputOf, ViewRef, ViewValueOf } from "@flow-state-dev/client";
import { viewWatchIdentity, watchView, type ViewWatchClient, type ViewWatchStop } from "@flow-state-dev/client/internal";
import { useClient } from "../internal/useClient";
import { failureOf, type ViewReadFailure } from "../internal/readFailure";

/** Options for {@link useView}. */
export type UseViewOptions = ViewCallOptions & {
  /** `false` watches nothing. Default `true`. */
  enabled?: boolean;
  /** The timer where push can miss a change. Default 3 s; `null` for none. */
  pollIntervalMs?: number | null;
  /** The client to watch through, for a host that holds its own. Pass a stable reference. */
  client?: ViewWatchClient;
};

// FIX-2774. Defined beside the rule that writes it, which `useResource` shares.
export type { ViewReadFailure };

/** What {@link useView} returns. */
export type UseViewResult<TValue> = {
  /** The view's answer, or `undefined` before the first lands. */
  value: TValue | undefined;
  /** `true` while the last read failed. */
  stale: boolean;
  // FIX-2774.
  /** Why the last read failed, while `stale`; absent otherwise. */
  failure?: ViewReadFailure;
  /** Read the view again now (a Retry, a refresh key), for every screen sharing the read. Nothing while disabled. */
  refresh(): void;
};

/**
 * What one watch heard. `watch` is that watch's own token, made when it
 * starts: a restarted watch (disabled and enabled again, or a new client,
 * view, session or input) holds nothing of the one before it, not its value
 * and not its `stale`. `client` and `identity` let a render that has already
 * moved on answer nothing before the new watch's effect even runs.
 */
type Heard<TValue> = {
  watch: object;
  client: ViewWatchClient;
  identity: string;
  value: TValue | undefined;
  stale: boolean;
  failure?: ViewReadFailure;
};

/** Watch the view `ref` names, with `input`. See the file header. */
export function useView<TRef extends ViewRef>(
  ref: TRef,
  input?: ViewInputOf<TRef>,
  options: UseViewOptions = {}
): UseViewResult<ViewValueOf<TRef>> {
  const built = useClient();
  const client: ViewWatchClient = options.client ?? built;
  const { sessionId, enabled = true, pollIntervalMs } = options;
  // The same identity `watchView` shares reads by: view, session, and the input as the request sends it.
  const identity = viewWatchIdentity(ref, input, sessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInput = useMemo(() => input, [identity]);
  const [heard, setHeard] = useState<Heard<ViewValueOf<TRef>> | undefined>(undefined);
  // The running watch, for `refresh()`: none while disabled.
  const running = useRef<ViewWatchStop | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const watch = {};
    const fresh = (prev: Heard<ViewValueOf<TRef>> | undefined): Heard<ViewValueOf<TRef>> =>
      prev?.watch === watch ? prev : { watch, client, identity, value: undefined, stale: false };
    const stop = watchView<ViewValueOf<TRef>>(
      client,
      ref,
      stableInput,
      {
        onValue: (value) => setHeard((prev) => ({ ...fresh(prev), value })),
        onStale: (stale) =>
          setHeard((prev) => {
            const held = fresh(prev);
            if (held === prev && held.stale === stale) return prev;
            // A read that lands takes the last failure's reason with it.
            const { failure: _gone, ...rest } = held;
            return stale ? { ...held, stale } : { ...rest, stale };
          }),
        onError: (error) => setHeard((prev) => ({ ...fresh(prev), stale: true, failure: failureOf(error) }))
      },
      {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {})
      }
    );
    running.current = stop;
    return () => {
      stop();
      if (running.current === stop) running.current = undefined;
      // What this watch heard goes with it, so the next one starts from nothing.
      setHeard((prev) => (prev?.watch === watch ? undefined : prev));
    };
    // `identity` names `ref`, `stableInput` and `sessionId` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, identity, enabled, pollIntervalMs]);

  const refresh = useCallback(() => running.current?.refresh(), []);

  return useMemo(
    () =>
      enabled && heard !== undefined && heard.client === client && heard.identity === identity
        ? { value: heard.value, stale: heard.stale, ...(heard.failure !== undefined ? { failure: heard.failure } : {}), refresh }
        : { value: undefined, stale: false, refresh },
    [enabled, heard, client, identity, refresh]
  );
}
