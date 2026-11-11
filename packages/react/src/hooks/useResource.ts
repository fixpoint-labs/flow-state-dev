// FIX-2624 (D2).
/**
 * `useResource(def, { session })`: one resource or collection at any scope,
 * read and kept current, and written where a client may write it.
 *
 * A user or org resource is read by scope and key with no session
 * (`client.resource`), and read again when a change notice under its path
 * lands on the caller's user or org topic: the live read every screen uses,
 * with no poll of its own. It is written through the flow its `runBy` names,
 * at the version read, and read again once the write settles. A collection's
 * value is its first page of entries, and its setters name an entry.
 *
 * A session resource comes from that session's snapshot, as it always has: pass
 * `{ session }`. Its writes are that session's flow's actions, so it has no
 * setters here.
 */
import { useCallback, useMemo } from "react";
import { topic, type ScopeEntry, type ScopeResourceDef } from "@flow-state-dev/client";
import { liveRead } from "@flow-state-dev/client/internal";
import { getPatternPrefix } from "@flow-state-dev/contracts/helpers";
import type { JsonValue } from "@flow-state-dev/core/types";
import type { SessionView } from "./useSession";
import { useClient } from "../internal/useClient";
import { useFencedRead, type ReadDriver } from "../internal/useFencedRead";
import { findSnapshotResource } from "../internal/findSnapshotResource";

/** The client type a definition brands, or `JsonValue`. */
type ClientValue<TDef> = TDef extends { ClientType: infer C } ? C : JsonValue;

/** What every `useResource` result carries: the value, `null` until read, and whether the last read failed. */
type ResourceValue<TValue> = {
  value: TValue | null;
  /** `true` when the last read failed: `value` is the last one read. Always `false` at session scope. */
  stale: boolean;
};

/** A single user or org resource: its value, and its writes. */
export type UseScopeResourceResult<TValue> = ResourceValue<TValue> & {
  /** Store `value` at the version read; rejects with `stale_version` if another write landed first. */
  set: (value: TValue) => Promise<{ version: number }>;
  /** Apply `updater` to the stored value, re-applying it on a stale version (three times at most). */
  update: (updater: (value: TValue) => TValue) => Promise<{ version: number }>;
};

/** A user or org collection: its first page of entries, and writes by entry. */
export type UseScopeCollectionResult<TValue> = ResourceValue<ScopeEntry<TValue>[]> & {
  set: (entry: string, value: TValue) => Promise<{ version: number }>;
  /** `updater` gets `null` for an entry that is absent. */
  update: (entry: string, updater: (value: TValue | null) => TValue) => Promise<{ version: number }>;
  delete: (entry: string) => Promise<{ version: number }>;
};

/** What `useResource(def)` returns for `def`. */
export type UseResourceResult<TDef> = TDef extends { scope: "session" }
  ? ResourceValue<ClientValue<TDef>>
  : TDef extends { pattern: string }
    ? UseScopeCollectionResult<ClientValue<TDef>>
    : UseScopeResourceResult<ClientValue<TDef>>;

/** The most entries a collection's value holds: one page of the entries route. */
const ENTRY_PAGE = 200;

/** Read now, and again on each resource notice under `roots` of the caller's user or org topic. */
function liveScopeDriver(
  client: ReturnType<typeof useClient>,
  scope: "user" | "org",
  roots: readonly string[] | undefined
): ReadDriver {
  return (read) => {
    const live = liveRead(
      (topics, options) => client.subscribe(topics, options),
      [scope === "user" ? topic.user() : topic.org()],
      { read, hear: (notice) => notice.kind === "resource", ...(roots === undefined ? {} : { paths: roots }) }
    );
    return () => live.close();
  };
}

/**
 * Read one resource or collection and keep it current. At user or org scope it
 * needs no session; at session scope pass `{ session }`.
 */
export function useResource<TDef extends ScopeResourceDef>(
  def: TDef,
  options: { session?: SessionView } = {}
): UseResourceResult<TDef> {
  type TValue = ClientValue<TDef>;
  const client = useClient();
  const atSession = def.scope === "session";
  const key = def.ref ?? def.pattern ?? "";
  const collection = def.pattern !== undefined;
  const scope = def.scope === "org" ? "org" : "user";

  // The handle reads nothing until called; held per definition.
  const handle = useMemo(
    () => (atSession ? undefined : (client.resource(def) as unknown as ScopeHandle<TValue>)),
    // `def` is a module-level definition: its scope and key are what name it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, atSession, def.scope, key]
  );
  const roots = useMemo(() => {
    if (!collection) return [key];
    const prefix = getPatternPrefix(key);
    return prefix.length > 0 ? [prefix] : undefined;
  }, [collection, key]);
  const driver = useMemo(
    () => (handle === undefined ? undefined : liveScopeDriver(client, scope, roots)),
    [client, handle, scope, roots]
  );
  const { data, error, refresh } = useFencedRead<TValue | ScopeEntry<TValue>[] | null>(
    [handle, scope, key],
    null,
    `Failed to read "${key}"`,
    async () => {
      if (handle === undefined) return null;
      return "list" in handle ? (await handle.list({ limit: ENTRY_PAGE })).items : (await handle.read()).value;
    },
    { driver, enabled: handle !== undefined }
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

  const snapshot = findSnapshotResource(options.session?.snapshot?.resources, key, collection ? "collection" : "single");
  if (atSession) {
    const value = (collection ? (snapshot ?? null) : (snapshot?.clientData ?? null)) as TValue | null;
    return { value, stale: false } as UseResourceResult<TDef>;
  }
  const base = { value: data, stale: error !== null };
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
