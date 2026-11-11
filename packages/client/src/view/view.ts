// FIX-2623.
/**
 * Views on the client: the handle a screen names a view by, the one call
 * that runs it, and the shared watch every screen keeps current through.
 *
 * - {@link viewRef} is the handle: the flow's address and the view's name,
 *   typed by the view (`viewRef<typeof roster>(...)`, a type import), so
 *   client code never imports a view's block.
 * - `client.view(ref, input)` runs the view once and answers its value, the
 *   change topics of what its run read, and, for a keyed view, its rows' keys.
 * - {@link watchView} keeps one live read per view and input in a client,
 *   shared by every watcher of it. It is the client's live read
 *   (`client.live`) with the topics taken from each answer, so it adds no
 *   loop of its own: when the topics change the live read listens to the new
 *   ones and reads once more.
 */
import type { WireTopic } from "@flow-state-dev/contracts";
import type { ViewDefinition, ViewInput, ViewOutput } from "@flow-state-dev/core/types";
import type { SubscribeOptions, Subscription } from "../subscribe/push-hub";
import { liveRead, type LiveRead } from "../live/live-read";

/** A view by flow address and name, typed by the view. Holds no block: safe in a browser bundle. */
export type ViewRef<TView extends ViewDefinition = ViewDefinition> = {
  readonly flow: string;
  readonly view: string;
  /** Types only: the view this handle names. Never set. */
  readonly __view?: TView;
};

/**
 * Name a view for the client. Pass the view's type for a typed answer:
 * `viewRef<typeof roster>("workforce-roster", "roster")`.
 */
export function viewRef<TView extends ViewDefinition = ViewDefinition>(flow: string, view: string): ViewRef<TView> {
  if (typeof flow !== "string" || flow.length === 0) throw new Error("viewRef: a flow address is required");
  if (typeof view !== "string" || view.length === 0) throw new Error("viewRef: a view name is required");
  return Object.freeze({ flow, view });
}

/** The answer type of the view a handle names. */
export type ViewValueOf<TRef> = TRef extends ViewRef<infer TView> ? ViewOutput<TView> : unknown;

/** The input type of the view a handle names. */
export type ViewInputOf<TRef> = TRef extends ViewRef<infer TView> ? ViewInput<TView> : unknown;

/** One run of a view: its value, the topics of what it read, and a keyed view's row keys, in order. */
export type ViewResult<TValue = unknown> = {
  value: TValue;
  topics: WireTopic[];
  keys?: string[];
};

/** Options for running a view: the session, for a session view. */
export type ViewCallOptions = { sessionId?: string };

/** What {@link watchView} needs of a client. */
export type ViewWatchClient = {
  view(ref: ViewRef, input: unknown, options?: ViewCallOptions): Promise<ViewResult>;
  subscribe(topics: readonly WireTopic[], options: SubscribeOptions): Subscription;
};

/** What one watcher of a view hears. */
export type ViewWatcher<TValue> = {
  /** Each value, when it changed. A late watcher gets the current one at once. */
  onValue?: (value: TValue) => void;
  /** `true` when a read fails, `false` when one lands after it. */
  onStale?: (stale: boolean) => void;
  onError?: (error: unknown) => void;
};

/** Options for {@link watchView}. */
export type WatchViewOptions = ViewCallOptions & {
  /** The live read's timer where push can miss a change. Taken from the first watcher. Default 3 s; `null` for none. */
  pollIntervalMs?: number | null;
};

type Shared = {
  live: LiveRead;
  watchers: Set<ViewWatcher<unknown>>;
  current?: { value: unknown };
  stale: boolean;
  /** The last answer's rows by key, so an unchanged row keeps its identity. */
  byKey: Map<string, { json: string; entry: unknown }>;
};

const sharedByClient = new WeakMap<object, Map<string, Shared>>();

/** The input a view call sends: an omitted input is `{}`; anything else, `null` included, as given. */
export function viewInputOnWire(input: unknown): unknown {
  return input === undefined ? {} : input;
}

/**
 * The input as the request sends it, in JSON with object keys sorted: two
 * inputs share a read exactly when they send the same request. `toJSON`
 * runs first, as it does on the wire, so two dates differ by their value.
 */
export function canonicalViewInput(input: unknown): string {
  return JSON.stringify(viewInputOnWire(input), (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, (value as Record<string, unknown>)[k]]))
      : value
  );
}

/** One key per view, session and input as sent: inputs that send the same request share a read. */
function watchKey(ref: ViewRef, input: unknown, sessionId: string | undefined): string {
  return JSON.stringify([ref.flow, ref.view, sessionId ?? null, canonicalViewInput(input)]);
}

/** A keyed answer with each row that didn't change kept as the object watchers already hold. */
function keepUnchangedEntries(shared: Pick<Shared, "byKey">, result: ViewResult): unknown {
  if (result.keys === undefined || !Array.isArray(result.value)) return result.value;
  const next = new Map<string, { json: string; entry: unknown }>();
  const value = result.value.map((entry, index) => {
    const key = result.keys![index]!;
    const json = JSON.stringify(entry);
    const held = shared.byKey.get(key);
    const kept = held !== undefined && held.json === json ? held.entry : entry;
    next.set(key, { json, entry: kept });
    return kept;
  });
  shared.byKey = next;
  return value;
}

/**
 * Watch `ref` with `input` on `client`. Every watcher of the same view,
 * session and input in one client shares one live read and its answer.
 * Returns the function that stops this watcher; the read stops with the last.
 */
export function watchView<TValue = unknown>(
  client: ViewWatchClient,
  ref: ViewRef,
  input: unknown,
  watcher: ViewWatcher<TValue>,
  options: WatchViewOptions = {}
): () => void {
  let byKey = sharedByClient.get(client);
  if (byKey === undefined) sharedByClient.set(client, (byKey = new Map()));
  const key = watchKey(ref, input, options.sessionId);
  let shared = byKey.get(key);
  if (shared === undefined) {
    const entry: Omit<Shared, "live"> = { watchers: new Set(), stale: false, byKey: new Map() };
    const callOptions = options.sessionId !== undefined ? { sessionId: options.sessionId } : {};
    const live = liveRead(
      (topics, subscribeOptions) => client.subscribe(topics, subscribeOptions),
      [],
      {
        topicsFromResult: true,
        read: async () => {
          const result = await client.view(ref, input, callOptions);
          return { value: keepUnchangedEntries(entry, result), topics: result.topics };
        },
        onValue: (value) => {
          entry.current = { value };
          for (const w of [...entry.watchers]) w.onValue?.(value);
        },
        onStale: (stale) => {
          entry.stale = stale;
          for (const w of [...entry.watchers]) w.onStale?.(stale);
        },
        onError: (error) => {
          for (const w of [...entry.watchers]) w.onError?.(error);
        },
        ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {})
      }
    );
    byKey.set(key, (shared = Object.assign(entry, { live })));
  }
  const held = shared;
  const mine = watcher as ViewWatcher<unknown>;
  held.watchers.add(mine);
  if (held.current !== undefined) mine.onValue?.(held.current.value);
  if (held.stale) mine.onStale?.(true);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    held.watchers.delete(mine);
    if (held.watchers.size === 0) {
      held.live.close();
      if (byKey!.get(key) === held) byKey!.delete(key);
    }
  };
}
