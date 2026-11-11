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
  const [state, setState] = useState<UseViewResult<ViewValueOf<TRef>>>({ value: undefined, stale: false });

  useEffect(() => {
    if (!enabled) return;
    setState({ value: undefined, stale: false });
    return watchView<ViewValueOf<TRef>>(
      client,
      ref,
      stableInput,
      {
        onValue: (value) => setState((prev) => ({ ...prev, value })),
        onStale: (stale) => setState((prev) => (prev.stale === stale ? prev : { ...prev, stale }))
      },
      {
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {})
      }
    );
  }, [client, ref.flow, ref.view, stableInput, sessionId, enabled, pollIntervalMs]);

  return state;
}
