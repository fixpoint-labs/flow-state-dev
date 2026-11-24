// FIX-2624 (D2).
/**
 * `useResource(def, { session })`: one resource or collection at any scope,
 * read and kept current, and written where a client may write it.
 *
 * A user or org resource is read by scope and key with no session
 * (`client.resource`), and read again when a change notice under its path
 * lands on the caller's user or org topic: the live read every screen uses,
 * which also reads on the client's timer wherever push can miss a change
 * (`pollIntervalMs` sets its pace). `client` reads through a host's own
 * client instead of the provider's. A collection's notice that names entries it shows
 * re-reads just those entries. It is written through the flow its `runBy` names,
 * at the version read, and read again once the write settles. A collection's
 * value is its first page of entries, and its setters name an entry. With
 * `all` it is every entry (`listAll()`), kept whole: a notice's named entries
 * are read and merged in, new or held, and the list is read again only when a
 * notice names none, or an entry read fails. A user or org result says why its
 * last read failed (`failure`, `useView`'s own type) and reads again on
 * `refresh()`.
 *
 * A session resource comes from that session's snapshot, as it always has: pass
 * `{ session }`; a session collection's value is its snapshot entry (`count`,
 * `prefetched`), read by entry through the collection hooks. A screen with no
 * `useSession` view (one on `useSessionFeed`) passes `{ sessionId }` instead:
 * the session's state is read without its items (`client.sessions.state`), and
 * read again on the session topic's notice for the resource, and on the
 * client's timer wherever push can miss one. Its writes are that session's
 * flow's actions, so it has no setters here.
 */
import { useCallback, useMemo, useRef } from "react";
import {
  topic,
  type Client,
  type CollectionSnapshotEntry,
  type ScopeCollectionHandle,
  type ScopeEntryHandle,
  type ScopeEntry,
  type ScopeResourceDef,
  type WireNotice,
  type WireTopic
} from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";
import { extractBareTopic, getPatternPrefix } from "@flow-state-dev/contracts/helpers";
import type { JsonValue } from "@flow-state-dev/core/types";
import type { SessionView } from "./useSession";
import { useClient } from "../internal/useClient";
import { useFencedRead, type ReadDriver } from "../internal/useFencedRead";
import { findSnapshotResource } from "../internal/findSnapshotResource";
import { failureOf, type ViewReadFailure } from "../internal/readFailure";

/** The client type a definition brands, or `JsonValue`. */
type ClientValue<TDef> = TDef extends { ClientType: infer C } ? C : JsonValue;

/** What every `useResource` result carries: the value, `null` until read, and whether the last read failed. */
type ResourceValue<TValue> = {
  value: TValue | null;
  /** `true` when the last read failed: `value` is the last one read. Always `false` at session scope. */
  stale: boolean;
};

// FIX-2775 D2.
/** What a user or org read adds: why it failed, and a read on demand, as `useView`'s. */
type ScopeRead = {
  /** Why the last read failed, while `stale`; absent otherwise. `useView`'s own type. */
  failure?: ViewReadFailure;
  /** Read again now (a Retry, a refresh key). */
  refresh(): void;
};

/** A single user or org resource: its value, and its writes. */
export type UseScopeResourceResult<TValue> = ResourceValue<TValue> & ScopeRead & {
  /** Store `value` at the version read; rejects with `stale_version` if another write landed first. */
  set: (value: TValue) => Promise<{ version: number }>;
  /** Apply `updater` to the stored value, re-applying it on a stale version (three times at most). */
  update: (updater: (value: TValue) => TValue) => Promise<{ version: number }>;
};

/** A user or org collection: its first page of entries (every entry, with `all`), and writes by entry. */
export type UseScopeCollectionResult<TValue> = ResourceValue<ScopeEntry<TValue>[]> & ScopeRead & {
  set: (entry: string, value: TValue) => Promise<{ version: number }>;
  /** `updater` gets `null` for an entry that is absent. */
  update: (entry: string, updater: (value: TValue | null) => TValue) => Promise<{ version: number }>;
  delete: (entry: string) => Promise<{ version: number }>;
};

/** What `useResource(def)` returns for `def`. */
export type UseResourceResult<TDef> = TDef extends { scope: "session" }
  ? TDef extends { pattern: string }
    ? ResourceValue<CollectionSnapshotEntry>
    : ResourceValue<ClientValue<TDef>>
  : TDef extends { pattern: string }
    ? UseScopeCollectionResult<ClientValue<TDef>>
    : UseScopeResourceResult<ClientValue<TDef>>;

/** One page of the entries route: the most a first-page value holds, and the page size `all` asks for. */
const ENTRY_PAGE = 200;

/** How a collection is read: its first page, or (`all`) every entry, under `topicPrefix` when given. */
type CollectionRead = { all: boolean; topicPrefix: string | undefined };

// FIX-2625, FIX-2775 D2.
/**
 * `held` with the entries `notice` names read again, one by one, or
 * `undefined` to read the collection whole: a notice with no ids, or a failed
 * entry read under `all`.
 *
 * On the first page, a notice naming an entry `held` doesn't show reads whole
 * too (a new entry's place in storage-key order, and whether it fits the page,
 * are the list's to say), and so does a named entry gone from a full page (the
 * entry after the page moves in, which only the list can say); a named entry
 * gone from a shorter page is dropped. Under `all` every entry is held, so a
 * new one is placed in storage-key order and a gone one is dropped, and only
 * the named entries under `topicPrefix` are read.
 */
async function withNamedEntries<TValue>(
  handle: ScopeCollectionHandle<TValue>,
  held: readonly ScopeEntry<TValue>[],
  notice: WireNotice | null,
  { all, topicPrefix }: CollectionRead
): Promise<ScopeEntry<TValue>[] | undefined> {
  const named = notice?.kind === "resource" ? notice.ids : undefined;
  if (named === undefined || named.length === 0) return undefined;
  const ids = all && topicPrefix !== undefined ? named.filter((id) => id.startsWith(topicPrefix)) : named;
  if (ids.length === 0) return [...held];
  const isHeld = (id: string) => held.some((entry) => entry.storageKey === id);
  if (!all && !ids.every(isHeld)) return undefined;
  let read: Map<string, Awaited<ReturnType<ScopeEntryHandle<TValue>["read"]>>>;
  try {
    read = new Map(await Promise.all(ids.map(async (id) => [id, await handle.entry(id).read()] as const)));
  } catch (error) {
    // Under `all`, an entry read that failed reads the collection whole instead.
    if (all) return undefined;
    throw error;
  }
  if (!all && held.length >= ENTRY_PAGE && [...read.values()].some((now) => now.value === null)) return undefined;
  const merged = held.flatMap((entry) => {
    const now = read.get(entry.storageKey);
    if (now === undefined) return [entry];
    return now.value === null ? [] : [{ ...entry, value: now.value, version: now.version }];
  });
  // Under `all` (the only way a read entry is not held here), a new entry's place is its storage-key order.
  for (const [storageKey, now] of read) {
    if (isHeld(storageKey) || now.value === null) continue;
    const at = merged.findIndex((entry) => entry.storageKey > storageKey);
    const added = { topic: extractBareTopic(handle.key, storageKey), storageKey, value: now.value, version: now.version };
    merged.splice(at === -1 ? merged.length : at, 0, added);
  }
  return merged;
}

/** Read now, and again on each resource notice under `roots` of `on`: the caller's user or org topic, or a session's. */
function liveDriver(
  client: Pick<Client, "subscribe">,
  on: WireTopic,
  roots: readonly string[] | undefined,
  pollIntervalMs: number | undefined
): ReadDriver {
  return (read) => {
    const live = liveRead(
      (topics, options) => client.subscribe(topics, options),
      [on],
      {
        read,
        hear: (notice) => notice.kind === "resource",
        ...(roots === undefined ? {} : { paths: roots }),
        ...(pollIntervalMs === undefined ? {} : { pollIntervalMs })
      }
    );
    return () => live.close();
  };
}

/**
 * Read one resource or collection and keep it current. At user or org scope it
 * needs no session; at session scope pass `{ session }`, or `{ sessionId }`
 * where the screen has no `useSession` view.
 */
export function useResource<TDef extends ScopeResourceDef>(
  def: TDef,
  options: {
    session?: SessionView;
    /**
     * At session scope, the session to read the resource of, where the screen
     * has no `useSession` view (one that follows the session with
     * `useSessionFeed`): its state is read without its items, again on that
     * session's notice for the resource, and on the client's timer wherever
     * push can miss a change. Ignored with `session`, and at user or org scope.
     */
    sessionId?: string | null;
    /**
     * At session scope, the name the session's flow declares the resource
     * under (its key in the snapshot), when it is not the definition's `ref`,
     * `pattern` or the pattern's static prefix. A definition with no `ref`
     * needs it. At user or org scope, the resource's key, as `client.resource`'s.
     */
    key?: string;
    /**
     * At user or org scope, or at session scope by `sessionId`, the client to
     * read (and at user or org scope write) through, for a host that holds its
     * own (its user, origin and `fetcher`). Pass a stable reference. Default:
     * the provider's client.
     */
    client?: Pick<Client, "resource" | "subscribe"> & { sessions?: Pick<Client["sessions"], "state"> };
    /** At user or org scope, or by `sessionId`, how often to read where push can miss a change, in ms. Default: the client's live-read pace. */
    pollIntervalMs?: number;
    // FIX-2775 D2.
    /**
     * At user or org scope, a collection's value is every one of its entries,
     * page after page (`listAll()`), not its first page. Ignored for a single
     * resource and at session scope.
     */
    all?: boolean;
    /**
     * With `all`, only the entries whose storage key starts with this
     * (`listAll({ topicPrefix })`), and only change notices that may touch
     * them are heard: a project's workstreams hear only their own project.
     */
    topicPrefix?: string;
  } = {}
): UseResourceResult<TDef> {
  type TValue = ClientValue<TDef>;
  const built = useClient();
  const client = options.client ?? built;
  const { pollIntervalMs, all = false } = options;
  const atSession = def.scope === "session";
  const key = options.key ?? def.ref ?? def.pattern ?? "";
  const collection = def.pattern !== undefined;
  // Only a collection read whole narrows by prefix; a single resource ignores both options.
  const topicPrefix = all && collection ? options.topicPrefix : undefined;
  const scope = def.scope === "org" ? "org" : "user";
  // A session resource read by the session's id: only where no `useSession` view hands its snapshot.
  const sessionId = atSession && options.session === undefined && options.sessionId != null && options.sessionId !== "" ? options.sessionId : undefined;

  // The handle reads nothing until called; held per definition.
  const handle = useMemo(
    () =>
      atSession
        ? undefined
        : (client.resource(def, options.key === undefined ? undefined : { key: options.key }) as unknown as ScopeHandle<TValue>),
    // `def` is a module-level definition: its scope and key are what name it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, atSession, def.scope, key]
  );
  /** The paths a change notice names for a resource stored at `path`: itself, or a collection's static prefix. */
  const rootsOf = (path: string) => {
    if (!collection) return [path];
    const prefix = getPatternPrefix(path);
    return prefix.length > 0 ? [prefix] : undefined;
  };
  // Under a `topicPrefix`, its whole segments are the root: a prefix that ends mid-segment
  // (`projects/a-`) narrows to the segment above it, since the path rule matches by segment.
  const narrowed = topicPrefix === undefined || topicPrefix.lastIndexOf("/") <= 0 ? undefined : topicPrefix.slice(0, topicPrefix.lastIndexOf("/"));
  const roots = useMemo(() => (narrowed !== undefined ? [narrowed] : rootsOf(key)), [collection, key, narrowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // A session notice names the resource's stored path (its ref or pattern), never the name a flow
  // declares it under: `key` is the snapshot's name only, and stands in only for a definition with neither.
  const storedPath = def.ref ?? def.pattern ?? key;
  const sessionRoots = useMemo(() => rootsOf(storedPath), [collection, storedPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const driver = useMemo(() => {
    if (handle !== undefined) return liveDriver(client, scope === "user" ? topic.user() : topic.org(), roots, pollIntervalMs);
    return sessionId === undefined ? undefined : liveDriver(client, topic.session(sessionId), sessionRoots, pollIntervalMs);
  }, [client, handle, scope, sessionId, roots, sessionRoots, pollIntervalMs]);
  // The snapshot is keyed by the name the flow declares the resource under: the given key, else
  // the ref or pattern, else (the common case for a collection) the pattern's static prefix.
  const snapshotNames = [options.key, def.ref, def.pattern, def.pattern === undefined ? undefined : getPatternPrefix(def.pattern)];
  /** The resource's value in a session snapshot's resources: a single one's `clientData`, a collection's entry. */
  const valueIn = (resources: Parameters<typeof findSnapshotResource>[0]) => {
    const found = snapshotNames
      .filter((name): name is string => name !== undefined && name.length > 0)
      .map((name) => findSnapshotResource(resources, name, collection ? "collection" : "single"))
      .find((entry) => entry !== undefined);
    return (collection ? (found ?? null) : (found?.clientData ?? null)) as TValue | null;
  };
  // A collection's entries as last read, for this handle read this way, while no other
  // read is out: a notice that names entries re-reads just those over them (FIX-2625).
  const how = useMemo<CollectionRead>(() => ({ all, topicPrefix }), [all, topicPrefix]);
  // Held entries are a baseline only for the same read mode, named by value so the match never rests on `how`'s identity.
  const mode = all ? `all:${topicPrefix ?? ""}` : "page";
  const held = useRef<{ handle: unknown; mode: string; entries: ScopeEntry<TValue>[] } | undefined>(undefined);
  const reading = useRef(0);
  const { data, error, cause, refresh } = useFencedRead<TValue | ScopeEntry<TValue>[] | null>(
    // `client` too: by `sessionId` there is no handle, and a value one client read is never shown under another.
    [handle, scope, key, sessionId, client, mode],
    null,
    `Failed to read "${key}"`,
    async (stillCurrent, notice) => {
      if (sessionId !== undefined) {
        if (client.sessions === undefined) throw new Error(`useResource: "${key}" by sessionId needs a client with sessions.state`);
        return valueIn((await client.sessions.state(sessionId, { includeItems: false })).resources);
      }
      if (handle === undefined) return null;
      if (!("list" in handle)) return (await handle.read()).value;
      const last = held.current?.handle === handle && held.current.mode === mode && reading.current === 0 ? held.current.entries : undefined;
      reading.current += 1;
      try {
        const entries =
          (last !== undefined ? await withNamedEntries(handle, last, notice, how) : undefined) ??
          (all
            ? await handle.listAll({ limit: ENTRY_PAGE, ...(topicPrefix === undefined ? {} : { topicPrefix }) })
            : (await handle.list({ limit: ENTRY_PAGE })).items);
        // Only the read in play is a baseline: one a newer read superseded is older than what's shown.
        if (stillCurrent()) held.current = { handle, mode, entries };
        return entries;
      } catch (error) {
        if (stillCurrent()) held.current = undefined;
        throw error;
      } finally {
        reading.current -= 1;
      }
    },
    { driver, enabled: handle !== undefined || sessionId !== undefined }
  );

  /** Run a write, then read again: the write's own notice is skipped by the view that sent it. */
  const written = useCallback(
    async (write: Promise<{ version: number }>) => {
      const result = await write;
      refresh();
      return result;
    },
    [refresh]
  );

  if (sessionId !== undefined) return { value: data, stale: error !== null } as UseResourceResult<TDef>;
  if (atSession) return { value: valueIn(options.session?.snapshot?.resources), stale: false } as UseResourceResult<TDef>;
  const base = { value: data, stale: error !== null, ...(error !== null ? { failure: failureOf(cause) } : {}), refresh };
  if (handle !== undefined && "list" in handle) {
    return {
      ...base,
      set: (entry: string, value: TValue) => written(handle.entry(entry).set(value)),
      update: (entry: string, updater: (value: TValue | null) => TValue) => written(handle.entry(entry).update(updater)),
      delete: (entry: string) => written(handle.entry(entry).delete())
    } as UseResourceResult<TDef>;
  }
  const single = handle as SingleHandle<TValue>;
  return {
    ...base,
    set: (value: TValue) => written(single.set(value)),
    update: (updater: (value: TValue) => TValue) => written(single.update(updater))
  } as UseResourceResult<TDef>;
}

type SingleHandle<TValue> = import("@flow-state-dev/client").ScopeResourceHandle<TValue>;
type ScopeHandle<TValue> = SingleHandle<TValue> | import("@flow-state-dev/client").ScopeCollectionHandle<TValue>;
