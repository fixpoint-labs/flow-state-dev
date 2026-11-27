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
 * are read and merged in, new or held, and a notice that names none, a gap, or
 * a failed entry read diffs the collection's manifest and reads only the
 * entries that are new or changed. With `newest` the value is the newest page,
 * and `loadOlder()` fetches the next older page; a notice that names entries
 * merges them in. A user or org result says why its
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
import { useCallback, useMemo, useRef, useState } from "react";
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
import { followEveryPage, liveRead } from "@flow-state-dev/client/internal";
import { compareNewest, COLLECTION_MANIFEST_PAGE, COLLECTION_RESYNC_READS, extractBareTopic, getPatternPrefix, mapLimit, sentAtOf } from "@flow-state-dev/contracts/helpers";
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

/** A user or org collection: its first page of entries (every entry, with `all`; the newest page, with `newest`), and writes by entry. */
export type UseScopeCollectionResult<TValue> = ResourceValue<ScopeEntry<TValue>[]> & ScopeRead & {
  set: (entry: string, value: TValue) => Promise<{ version: number }>;
  /** `updater` gets `null` for an entry that is absent. */
  update: (entry: string, updater: (value: TValue | null) => TValue) => Promise<{ version: number }>;
  delete: (entry: string) => Promise<{ version: number }>;
  /** Whether `loadOlder` can fetch another page. False unless the read asked for `newest`. */
  hasOlder: boolean;
  /** Fetch the next older page into `value`. No-op when `hasOlder` is false. */
  loadOlder: () => void;
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

/** How a collection is read: its first page, every entry (`all`), or the newest page (`newest`), under `topicPrefix` when given. */
type CollectionRead = { all: boolean; newest: boolean; topicPrefix: string | undefined };

/** Where `entry` sits in the newest order the entries route pages by. */
function placeOf<TValue>(entry: ScopeEntry<TValue>): { storageKey: string; at: number | null } {
  return { storageKey: entry.storageKey, at: sentAtOf(entry.value) };
}

// FIX-2625, FIX-2775 D2.
/**
 * `held` with the entries `notice` names read again, one by one, or
 * `undefined` to resync under `all` (a notice with no ids, or a failed entry
 * read): the manifest, then only the entries that are new or changed.
 *
 * On the first page, a notice naming an entry `held` doesn't show reads whole
 * too (a new entry's place in storage-key order, and whether it fits the page,
 * are the list's to say), and so does a named entry gone from a full page (the
 * entry after the page moves in, which only the list can say); a named entry
 * gone from a shorter page is dropped. Under `all` or `newest` a new entry is
 * placed (storage-key order, or newest-first) and a gone one is dropped, and
 * only the named entries under `topicPrefix` are read. A notice that names
 * none re-reads the newest pages already asked for, not the whole collection.
 */
async function withNamedEntries<TValue>(
  handle: ScopeCollectionHandle<TValue>,
  held: readonly ScopeEntry<TValue>[],
  notice: WireNotice | null,
  { all, newest, topicPrefix }: CollectionRead
): Promise<ScopeEntry<TValue>[] | undefined> {
  const named = notice?.kind === "resource" ? notice.ids : undefined;
  if (named === undefined || named.length === 0) return undefined;
  const windowed = all || newest;
  const ids = windowed && topicPrefix !== undefined ? named.filter((id) => id.startsWith(topicPrefix)) : named;
  if (ids.length === 0) return [...held];
  const isHeld = (id: string) => held.some((entry) => entry.storageKey === id);
  // On the first page, an entry the page doesn't hold is the list's to place. A newest page places it itself.
  if (!windowed && !ids.every(isHeld)) return undefined;
  let read: Map<string, Awaited<ReturnType<ScopeEntryHandle<TValue>["read"]>>>;
  try {
    read = new Map(await Promise.all(ids.map(async (id) => [id, await handle.entry(id).read()] as const)));
  } catch (error) {
    // Under `all`, an entry read that failed resyncs from the manifest instead.
    if (all) return undefined;
    throw error;
  }
  if (!windowed && held.length >= ENTRY_PAGE && [...read.values()].some((now) => now.value === null)) return undefined;
  const merged = held.flatMap((entry) => {
    const now = read.get(entry.storageKey);
    if (now === undefined) return [entry];
    return now.value === null ? [] : [{ ...entry, value: now.value, version: now.version }];
  });
  // Under `all` (the only way a read entry is not held here), a new entry's place is its storage-key order.
  for (const [storageKey, now] of read) {
    if (isHeld(storageKey) || now.value === null) continue;
    const added = { topic: extractBareTopic(handle.key, storageKey), storageKey, value: now.value, version: now.version };
    const at = newest
      ? merged.findIndex((entry) => compareNewest(placeOf(added), placeOf(entry)) < 0)
      : merged.findIndex((entry) => entry.storageKey > storageKey);
    merged.splice(at === -1 ? merged.length : at, 0, added);
  }
  // An update can change `at`. Newest order is the whole list, not only the new keys.
  if (newest) merged.sort((left, right) => compareNewest(placeOf(left), placeOf(right)));
  return merged;
}

/**
 * The entries `held` brought up to the manifest: a missing key is dropped, and
 * a key that is new or at a different version is read. Unchanged entries are
 * not read. Storage-key order, as the manifest pages.
 */
async function resyncFromManifest<TValue>(
  handle: ScopeCollectionHandle<TValue>,
  held: readonly ScopeEntry<TValue>[],
  topicPrefix: string | undefined
): Promise<ScopeEntry<TValue>[]> {
  const listed = await followEveryPage((cursor) =>
    handle.list({
      manifest: true,
      limit: COLLECTION_MANIFEST_PAGE,
      ...(cursor === undefined ? {} : { cursor }),
      ...(topicPrefix === undefined ? {} : { topicPrefix })
    })
  );
  const have = new Map(held.map((entry) => [entry.storageKey, entry]));
  const stale = listed.filter((item) => have.get(item.storageKey)?.version !== item.version);
  const read = new Map(
    await mapLimit(stale, COLLECTION_RESYNC_READS, async (item) => [item.storageKey, await handle.entry(item.storageKey).read()] as const)
  );
  const merged: ScopeEntry<TValue>[] = [];
  for (const item of listed) {
    const now = read.get(item.storageKey);
    if (now !== undefined) {
      if (now.value === null) continue;
      merged.push({
        topic: extractBareTopic(handle.key, item.storageKey),
        storageKey: item.storageKey,
        value: now.value,
        version: now.version
      });
      continue;
    }
    const known = have.get(item.storageKey);
    if (known !== undefined) merged.push(known);
  }
  return merged;
}

/** The newest `pages` of a collection, whether an older page remains, and the cursor of that page. */
async function readNewestWindow<TValue>(
  handle: ScopeCollectionHandle<TValue>,
  pages: number,
  topicPrefix: string | undefined
): Promise<{ entries: ScopeEntry<TValue>[]; hasOlder: boolean; nextCursor?: string }> {
  const entries: ScopeEntry<TValue>[] = [];
  let cursor: string | undefined;
  let nextCursor: string | undefined;
  for (let page = 0; page < pages; page += 1) {
    const read = await handle.list({
      limit: ENTRY_PAGE,
      order: "newest",
      ...(cursor === undefined ? {} : { cursor }),
      ...(topicPrefix === undefined ? {} : { topicPrefix })
    });
    entries.push(...read.items);
    if (read.nextCursor === undefined) return { entries, hasOlder: false };
    cursor = read.nextCursor;
    nextCursor = read.nextCursor;
  }
  return { entries, hasOlder: true, nextCursor };
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
     * resource and at session scope. When `newest` is also set, this is the
     * read: a screen asks for one of the two.
     */
    all?: boolean;
    /**
     * At user or org scope, a collection's value is its newest page (by each
     * entry's `at`), and `loadOlder()` fetches the next older page. A notice
     * that names entries merges those entries in. Ignored for a single
     * resource, at session scope, and when `all` is set.
     */
    newest?: boolean;
    /**
     * With `all` or `newest`, only the entries whose storage key starts with
     * this, and only change notices that may touch them are heard: a project's
     * workstreams hear only their own project.
     */
    topicPrefix?: string;
  } = {}
): UseResourceResult<TDef> {
  type TValue = ClientValue<TDef>;
  const built = useClient();
  const client = options.client ?? built;
  const { pollIntervalMs, all: allOption = false } = options;
  const atSession = def.scope === "session";
  const key = options.key ?? def.ref ?? def.pattern ?? "";
  const collection = def.pattern !== undefined;
  // `newest` is the paged read. It and `all` are not combined: a screen asks for one.
  const newest = options.newest === true && !allOption && collection;
  const all = allOption && !newest && collection;
  // A whole collection, or a newest window, may narrow by prefix. A single resource ignores both.
  const topicPrefix = (all || newest) && collection ? options.topicPrefix : undefined;
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
  const how = useMemo<CollectionRead>(() => ({ all, newest, topicPrefix }), [all, newest, topicPrefix]);
  // The read mode, named by value so no match rests on `how`'s identity: the held baseline and the paging window are each for one mode.
  const mode = all ? `all:${topicPrefix ?? ""}` : newest ? `newest:${topicPrefix ?? ""}` : "page";
  // How many newest pages the window holds. A different read starts again at one page.
  const paging = useRef({ mode, handle, pages: 1 });
  const nextCursor = useRef<string | undefined>(undefined);
  const loadingOlder = useRef(false);
  const appendOlder = useRef(false);
  /** Bumped when the read changes, so a scroll from the previous one cannot release a later guard. */
  const scrollGeneration = useRef(0);
  if (paging.current.mode !== mode || paging.current.handle !== handle) {
    paging.current = { mode, handle, pages: 1 };
    nextCursor.current = undefined;
    scrollGeneration.current += 1;
    loadingOlder.current = false;
    appendOlder.current = false;
  }
  const [hasOlder, setHasOlder] = useState(false);
  const [olderFor, setOlderFor] = useState({ mode, handle });
  if (olderFor.mode !== mode || olderFor.handle !== handle) {
    setOlderFor({ mode, handle });
    setHasOlder(false);
  }
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
      // Take the scroll before any await. A read that never starts leaves the flag set, and `loadOlder` takes it back.
      const wantedOlder = appendOlder.current;
      const scroll = scrollGeneration.current;
      appendOlder.current = false;
      let olderCommit: { cursor: string | undefined } | undefined;
      let windowCommit: { cursor: string | undefined; pages: number } | undefined;
      try {
        const placed = last !== undefined ? await withNamedEntries(handle, last, notice, how) : undefined;
        // A resync under `all` diffs the manifest against what is already held. The first read has nothing to diff, so it lists.
        // A scroll appends the next older page. A gap re-reads the pages already asked for.
        // The cursor and the page count commit with the entries, and only while this read is still the one on screen.
        const appending = wantedOlder && newest && placed === undefined && notice === null && last !== undefined && nextCursor.current !== undefined;
        const newestWindow = !newest || placed !== undefined
          ? undefined
          : appending
            ? await (async () => {
                const page = await handle.list({
                  limit: ENTRY_PAGE,
                  order: "newest",
                  cursor: nextCursor.current,
                  ...(topicPrefix === undefined ? {} : { topicPrefix })
                });
                olderCommit = { cursor: page.nextCursor };
                const baseline = last ?? [];
                return { entries: [...baseline, ...page.items], hasOlder: page.nextCursor !== undefined };
              })()
            : await (async () => {
                const cover = last === undefined ? paging.current.pages : Math.max(paging.current.pages, Math.ceil((last ?? []).length / ENTRY_PAGE));
                const opened = await readNewestWindow(handle, cover, topicPrefix);
                windowCommit = { cursor: opened.nextCursor, pages: cover };
                return opened;
              })();
        const entries =
          placed ??
          newestWindow?.entries ??
          (all && last !== undefined
            ? await resyncFromManifest(handle, last, topicPrefix)
            : all
              ? await handle.listAll({ limit: ENTRY_PAGE, ...(topicPrefix === undefined ? {} : { topicPrefix }) })
              : (await handle.list({ limit: ENTRY_PAGE })).items);
        // Only the read in play is a baseline: one a newer read superseded is older than what's shown.
        if (stillCurrent()) {
          held.current = { handle, mode, entries };
          if (olderCommit !== undefined) {
            nextCursor.current = olderCommit.cursor;
            paging.current = { mode: paging.current.mode, handle: paging.current.handle, pages: paging.current.pages + 1 };
          } else if (windowCommit !== undefined) {
            nextCursor.current = windowCommit.cursor;
            paging.current = { mode: paging.current.mode, handle: paging.current.handle, pages: windowCommit.pages };
          }
          // A named merge keeps the window's older page; only a window read learns whether one remains.
          if (newestWindow !== undefined) setHasOlder(newestWindow.hasOlder);
          else if (!newest) setHasOlder(false);
        }
        return entries;
      } catch (error) {
        // A failed first read has no baseline. A failed resync keeps the one it diffed, so the next gap does not list every value.
        if (stillCurrent() && last === undefined) held.current = undefined;
        throw error;
      } finally {
        reading.current -= 1;
        // The read that took the scroll releases it, appended or not. A read from an older generation must not release a later one.
        if (wantedOlder && scrollGeneration.current === scroll) loadingOlder.current = false;
      }
    },
    { driver, enabled: handle !== undefined || sessionId !== undefined }
  );

  /** Run a write, then read again: the write's own notice is skipped by the view that sent it. */
  const loadOlder = useCallback(() => {
    if (!hasOlder || loadingOlder.current) return;
    loadingOlder.current = true;
    appendOlder.current = true;
    refresh();
    // The read takes the request before it waits. Still set means that read never started.
    if (appendOlder.current) {
      appendOlder.current = false;
      loadingOlder.current = false;
    }
  }, [hasOlder, refresh]);
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
      delete: (entry: string) => written(handle.entry(entry).delete()),
      hasOlder,
      loadOlder
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
