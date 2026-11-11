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
 * while the last read failed; the live read tries again on its own.
 */
import { useEffect, useMemo, useState } from "react";
import type { ViewCallOptions, ViewInputOf, ViewRef, ViewValueOf } from "@flow-state-dev/client";
import { watchView, type ViewWatchClient } from "@flow-state-dev/client/internal";
import { useClient } from "../internal/useClient";

/** Options for {@link useView}. */
export type UseViewOptions = ViewCallOptions & {
  /** `false` watches nothing. Default `true`. */
  enabled?: boolean;
  /** The timer where push can miss a change. Default 3 s; `null` for none. */
  pollIntervalMs?: number | null;
  /** The client to watch through, for a host that holds its own. Pass a stable reference. */
  client?: ViewWatchClient;
};

/** What {@link useView} returns. */
export type UseViewResult<TValue> = {
  /** The view's answer, or `undefined` before the first lands. */
  value: TValue | undefined;
  /** `true` while the last read failed. */
  stale: boolean;
};

/** Watch the view `ref` names, with `input`. See the file header. */
export function useView<TRef extends ViewRef>(
  ref: TRef,
  input?: ViewInputOf<TRef>,
  options: UseViewOptions = {}
): UseViewResult<ViewValueOf<TRef>> {
  const built = useClient();
  const client = options.client ?? (built as unknown as ViewWatchClient);
  const { sessionId, enabled = true, pollIntervalMs } = options;
  const inputKey = JSON.stringify(input ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInput = useMemo(() => input ?? {}, [inputKey]);
  // What was heard is tagged with the watch it belongs to, and the answer is
  // derived from it: a disabled hook, or one watching another view, input or
  // session, answers nothing rather than the last value as if current.
  const watchKey = `${ref.flow}\u0000${ref.view}\u0000${sessionId ?? ""}\u0000${inputKey}`;
  const [heard, setHeard] = useState<{ key: string; value: ViewValueOf<TRef> | undefined; stale: boolean } | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const key = watchKey;
    const fresh = (prev: typeof heard) => (prev?.key === key ? prev : { key, value: undefined, stale: false });
    return watchView<ViewValueOf<TRef>>(
      client,
      ref,
      stableInput,
      {
        onValue: (value) => setHeard((prev) => ({ ...fresh(prev), value })),
        onStale: (stale) => setHeard((prev) => (fresh(prev).stale === stale ? prev : { ...fresh(prev), stale }))
      },
      {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {})
      }
    );
    // `watchKey` names `ref`, `stableInput` and `sessionId` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, watchKey, enabled, pollIntervalMs]);

  return useMemo(
    () => (enabled && heard?.key === watchKey ? { value: heard.value, stale: heard.stale } : { value: undefined, stale: false }),
    [enabled, heard, watchKey]
  );
}
