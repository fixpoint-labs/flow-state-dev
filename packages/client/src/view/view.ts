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
 *   ones and reads once more. A notice with ids asks a keyed view for just
 *   the rows it touches; a partial answer is placed by key over the rows
 *   held (`placePartial`), and in development and tests checked against a
 *   whole run. An answer that names what it hears (`hears`) reads again only
 *   on a notice that may change what its run read.
 */
import { wireTopicKey, type WireNotice, type WireTopic } from "@flow-state-dev/contracts";
import type { ViewDefinition, ViewInput, ViewOutput } from "@flow-state-dev/core/types";
import type { ViewHearing } from "@flow-state-dev/core/internal";
import { covers, type SubscribeOptions, type Subscription } from "../subscribe/push-hub";
import { liveRead, type LiveRead } from "../live/live-read";
import { mayHold } from "../live/paths";

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
  // FIX-2625 D1.
  /**
   * Set when the view answered for just the rows a change touched: `value`
   * is those rows, to place by key over the rows held, and `removed` the
   * keys to drop. Absent: `value` is the whole answer.
   */
  partial?: { removed: string[] };
  // FIX-2625.
  /** Which notices under `topics` may change what the run read. Absent (a server from before it): every one. */
  hears?: ViewHearing[];
};

/**
 * Options for running a view: the session, for a session view, and the change
 * notice it may answer for (`ctx.view.changed`). A notice with no ids is not
 * sent: the view answers whole.
 */
export type ViewCallOptions = { sessionId?: string; changed?: WireNotice | null };

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
  /** A keyed answer as last held, for a partial answer to be placed over: its rows, keys and topics. */
  held?: { entries: unknown[]; keys: string[]; topics: WireTopic[]; hears?: ViewHearing[] };
  /** What the last answer hears (`ViewResult.hears`). */
  hears?: ViewHearing[];
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

/**
 * One identity per view, session and input as sent: inputs that send the same
 * request share a read. The one encoding of a watch's identity, here and in
 * `useView`, so the two can't disagree on what is the same watch.
 */
export function viewWatchIdentity(ref: ViewRef, input: unknown, sessionId: string | undefined): string {
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

// FIX-2625 D1.
/**
 * A partial answer placed over the rows held: a held key is replaced in place,
 * a removed one dropped, a new one appended; the topics are the held ones and
 * the answer's, so a partial run that read less never narrows what the screen
 * hears.
 */
export function placePartial(held: NonNullable<Shared["held"]>, result: ViewResult): ViewResult {
  const removed = new Set(result.partial?.removed ?? []);
  const answered = new Map<string, unknown>();
  (result.value as unknown[]).forEach((entry, index) => answered.set(result.keys![index]!, entry));
  const entries: unknown[] = [];
  const keys: string[] = [];
  held.keys.forEach((key, index) => {
    if (removed.has(key)) return;
    entries.push(answered.has(key) ? answered.get(key) : held.entries[index]);
    keys.push(key);
    answered.delete(key);
  });
  for (const [key, entry] of answered) {
    if (removed.has(key)) continue;
    entries.push(entry);
    keys.push(key);
  }
  const hears = held.hears === undefined || result.hears === undefined ? undefined : unionHears(held.hears, result.hears);
  return { value: entries, topics: unionTopics(held.topics, result.topics), keys, ...(hears !== undefined ? { hears } : {}) };
}

// FIX-2625.
/**
 * Whether `notice` may change what an answer's run read: a hearing whose topic
 * covers it lists its kind, and a `resource` notice's path falls under the
 * hearing's roots (`mayHold`, the client's one path rule). Every notice, for
 * an answer that names no hearing.
 */
function hearsNotice(hears: readonly ViewHearing[] | undefined, notice: WireNotice): boolean {
  if (hears === undefined) return true;
  return hears.some(
    (hearing) =>
      covers(hearing.topic, notice.topic) &&
      hearing.kinds.includes(notice.kind) &&
      (notice.kind !== "resource" || notice.topic.resource === undefined || mayHold(notice.topic.resource, hearing.paths))
  );
}

// FIX-2625.
/** The order a merged hearing lists its kinds in, as the engine's answer does. */
const KIND_ORDER: readonly WireNotice["kind"][] = ["items", "request", "run", "state", "resource", "board", "resync"];

/**
 * Both answers' hearings, one per topic: two for the same topic merge into
 * one hearing of the kinds and paths of both, so a partial answer placed over
 * the held one never narrows what the screen hears and never grows the list.
 * A `resource` hearing with no paths rules no path out, so neither does the merge.
 */
function unionHears(a: readonly ViewHearing[], b: readonly ViewHearing[]): ViewHearing[] {
  const byTopic = new Map<string, { topic: WireTopic; kinds: Set<WireNotice["kind"]>; paths: Set<string> | undefined }>();
  for (const hearing of [...a, ...b]) {
    const key = wireTopicKey(hearing.topic);
    const held = byTopic.get(key);
    const paths = hearing.kinds.includes("resource") && hearing.paths === undefined ? undefined : new Set(hearing.paths ?? []);
    if (held === undefined) {
      byTopic.set(key, { topic: hearing.topic, kinds: new Set(hearing.kinds), paths });
      continue;
    }
    for (const kind of hearing.kinds) held.kinds.add(kind);
    if (held.paths !== undefined) {
      if (paths === undefined) held.paths = undefined;
      else for (const path of paths) held.paths.add(path);
    }
  }
  return [...byTopic.values()].map(({ topic, kinds, paths }) => ({
    topic,
    kinds: KIND_ORDER.filter((kind) => kinds.has(kind)),
    ...(kinds.has("resource") && paths !== undefined ? { paths: [...paths].sort() } : {})
  }));
}

/** Both sets of topics, each once. */
function unionTopics(a: readonly WireTopic[], b: readonly WireTopic[]): WireTopic[] {
  const topics = new Map(a.map((topic) => [wireTopicKey(topic), topic]));
  for (const topic of b) topics.set(wireTopicKey(topic), topic);
  return [...topics.values()];
}

/**
 * Whether each partial answer is checked against a whole run: in development
 * and tests (`NODE_ENV`), as the client's other dev-only checks are, through
 * `globalThis.process` so a browser with no `process` never reads it.
 */
function checksPartials(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV === "development" || env?.NODE_ENV === "test";
}

/** The change a read may ask the view to answer for: a notice with ids, once a keyed answer is held. */
function changeFor(notice: WireNotice | null, held: Shared["held"]): WireNotice | undefined {
  return held !== undefined && notice !== null && notice.ids !== undefined && notice.ids.length > 0 ? notice : undefined;
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
  const key = viewWatchIdentity(ref, input, options.sessionId);
  let shared = byKey.get(key);
  if (shared === undefined) {
    const entry: Omit<Shared, "live"> = { watchers: new Set(), stale: false, byKey: new Map() };
    const callOptions = options.sessionId !== undefined ? { sessionId: options.sessionId } : {};
    const live = liveRead(
      (topics, subscribeOptions) => client.subscribe(topics, subscribeOptions),
      [],
      {
        topicsFromResult: true,
        hear: (notice) => hearsNotice(entry.hears, notice),
        read: async (notice) => {
          const changed = changeFor(notice, entry.held);
          let result = await client.view(ref, input, changed !== undefined ? { ...callOptions, changed } : callOptions);
          if (result.partial !== undefined && entry.held !== undefined && result.keys !== undefined && Array.isArray(result.value)) {
            result = placePartial(entry.held, result);
            if (checksPartials()) {
              // Development and tests: a partial answer must equal a whole run; a difference names the view.
              const whole = await client.view(ref, input, callOptions);
              if (JSON.stringify(whole.value) !== JSON.stringify(result.value)) {
                console.error(
                  `[flow-state-dev] "${ref.flow}" view "${ref.view}" answered partially for ${JSON.stringify(changed?.ids)} ` +
                    "and differs from a whole run: a row the change touched was left out, or one moved. The screen shows the whole run."
                );
                result = {
                  ...whole,
                  topics: unionTopics(result.topics, whole.topics),
                  ...(result.hears !== undefined && whole.hears !== undefined ? { hears: unionHears(result.hears, whole.hears) } : {})
                };
              }
            }
          }
          entry.held =
            result.keys !== undefined && Array.isArray(result.value)
              ? { entries: result.value, keys: result.keys, topics: result.topics, ...(result.hears !== undefined ? { hears: result.hears } : {}) }
              : undefined;
          entry.hears = result.hears;
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
