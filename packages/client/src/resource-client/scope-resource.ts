// FIX-2624.
/**
 * `client.resource(def)`: one user or org resource, or one collection's
 * entries, read by scope and key with no session, and written through the
 * flow its `runBy` names.
 *
 * A write carries the version it read. `update` runs its updater on the value
 * it reads; when another write landed in between, the server refuses the stale
 * one (`stale_version`), and `update` reads again and re-runs the updater, three
 * times at most, then rejects with the conflict. The server records no state on
 * the request, so the re-read goes through the same direct read, under the same
 * checks. A lost response is not retried.
 */
import type { JsonValue } from "@flow-state-dev/core/types";
import type { RequestResult } from "../client";
import { clientError, requireValue, seg, type Transport } from "../internal/http";

/** What `client.resource` takes: a defined user or org resource (its `ref` is its key) or collection (its `pattern`). */
export type ScopeResourceDef<TValue = JsonValue> = {
  scope: "session" | "user" | "org";
  ref?: string;
  /** A collection's pattern: its entries are read and written one at a time. */
  pattern?: string;
  /** The client projection's type, branded by `defineResource` and `defineResourceCollection`. */
  ClientType?: TValue;
};

/** The client type a definition brands, or `JsonValue`. */
type ClientValue<TDef> = TDef extends { ClientType: infer C } ? C : JsonValue;

/** One read: the value as the client sees it, and the version it is at (0: nothing stored yet). */
export type ScopeResourceRead<TValue> = { value: TValue; version: number };

/** One write at the version read, or the updater re-run on a stale one. */
interface VersionedWrites<TValue, TRead> {
  /**
   * Store `value` (the fields the client can see), at `version` when given, else
   * at the version read just before. Rejects with `stale_version` when another
   * write landed first. Resolves to the new version.
   */
  set(value: TValue, options?: { version?: number }): Promise<{ version: number }>;
  /**
   * Read, apply `updater`, write at the version read; on a stale version, read
   * again and re-apply, three times at most. Resolves to the new version.
   */
  update(updater: (value: TRead) => TValue): Promise<{ version: number }>;
}

/** A named action of the flow `runBy` names, sent with the resource where a session id goes. */
interface ResourceSends {
  /** Run `action` with `input` in the caller's write session; resolves to its output. */
  send<TOutput = unknown>(action: string, input: unknown): Promise<TOutput>;
}

/** One user or org resource, by scope and key. */
export interface ScopeResourceHandle<TValue = JsonValue> extends VersionedWrites<TValue, TValue>, ResourceSends {
  readonly scope: "user" | "org";
  readonly key: string;
  /** The value and its version. The value is the schema's default before any write. */
  read(): Promise<ScopeResourceRead<TValue>>;
  /** The value alone. */
  state(): Promise<TValue>;
}

/** One entry of a collection, by its topic or storage key. */
export interface ScopeEntryHandle<TValue = JsonValue> extends VersionedWrites<TValue, TValue | null> {
  readonly entry: string;
  /** The entry's value and version: `null` at version 0 when it is absent, or not the caller's to read. */
  read(): Promise<ScopeResourceRead<TValue | null>>;
  /** Delete the entry at `version` when given, else at the version read just before. Rejects with `stale_version` when another write landed first. */
  delete(options?: { version?: number }): Promise<{ version: number }>;
}

/** One listed entry: its topic, storage key, value and version. */
export type ScopeEntry<TValue> = { topic: string; storageKey: string; value: TValue; version: number };

/** One page of a collection's entries, and the cursor of the next (absent on the last). */
export type ScopeEntryPage<TValue> = { items: ScopeEntry<TValue>[]; nextCursor?: string };

/** One user or org collection, by scope and pattern. */
export interface ScopeCollectionHandle<TValue = JsonValue> extends ResourceSends {
  readonly scope: "user" | "org";
  readonly key: string;
  /** One page of the caller's entries, in storage-key order. */
  list(options?: { limit?: number; cursor?: string; topicPrefix?: string }): Promise<ScopeEntryPage<TValue>>;
  /** One entry, by its topic or storage key. Reads nothing until a method is called. */
  entry(entry: string): ScopeEntryHandle<TValue>;
}

/** Why a write was refused: `code` is the server's (`stale_version`, `write_refused`, `not_writable`, ...). */
export class ResourceWriteError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ResourceWriteError";
  }
}

/** How many times `update` writes before it gives up on a busy resource. */
const UPDATE_ATTEMPTS = 3;

type SendSettled = (path: string, body: unknown) => Promise<RequestResult>;

/** The handle `client.resource` builds for `def`: a collection's when it has a pattern. */
export type ScopeHandleOf<TDef> = TDef extends { pattern: string }
  ? ScopeCollectionHandle<ClientValue<TDef>>
  : ScopeResourceHandle<ClientValue<TDef>>;

/** Build the handle. `sendSettled` posts a send and waits for its result. */
export function scopeResourceHandle<TDef extends ScopeResourceDef>(
  t: Transport,
  userId: string,
  sendSettled: SendSettled,
  def: TDef,
  options?: { key?: string }
): ScopeHandleOf<TDef> {
  type TValue = ClientValue<TDef>;
  if (def.scope !== "user" && def.scope !== "org") {
    clientError(`client.resource takes a user or org resource; a ${def.scope} resource is read through its session`);
  }
  const scope = def.scope;
  const key = requireValue(
    options?.key ?? def.ref ?? def.pattern,
    "resource key (the definition's ref or pattern, or options.key)"
  );
  const base = `/api/flows/resources/${seg(scope)}/${seg(key)}`;

  /** Run `action` and resolve to its output, or reject with the server's code. */
  const send = async <TOutput>(action: string, input: unknown): Promise<TOutput> => {
    // `userId` is read only by a host with no sign-in (open mode); a signed-in one ignores it.
    const result = await sendSettled(`${base}/actions/${seg(action)}`, { userId, input });
    if (result.status === "completed") return result.output as TOutput;
    throw new ResourceWriteError(
      result.error?.code ?? result.status,
      result.error?.message ?? `${action} on "${key}" ended ${result.status}`
    );
  };

  /** `set` and `update` over a read and a write at a version. */
  const versioned = <TRead>(
    read: () => Promise<ScopeResourceRead<TRead>>,
    writeAt: (value: TValue, version: number) => Promise<{ version: number }>
  ): VersionedWrites<TValue, TRead> => ({
    set: async (value, setOptions) => writeAt(value, setOptions?.version ?? (await read()).version),
    update: async (updater) => {
      for (let attempt = 1; ; attempt += 1) {
        const current = await read();
        try {
          return await writeAt(updater(current.value), current.version);
        } catch (error) {
          if (!(error instanceof ResourceWriteError) || error.code !== "stale_version" || attempt >= UPDATE_ATTEMPTS) {
            throw error;
          }
        }
      }
    }
  });

  if (def.pattern !== undefined) {
    const entryHandle = (entry: string): ScopeEntryHandle<TValue> => {
      const read = async (): Promise<ScopeResourceRead<TValue | null>> => {
        const found = await t.json<ScopeEntry<TValue> | null>(`${base}/entries/${seg(entry)}`, undefined, { userId });
        return found === null ? { value: null, version: 0 } : { value: found.value, version: found.version };
      };
      return {
        entry,
        read,
        ...versioned(read, (value, version) => send<{ version: number }>("set", { entry, state: value, version })),
        delete: async (deleteOptions) =>
          send<{ version: number }>("delete", { entry, version: deleteOptions?.version ?? (await read()).version })
      };
    };
    const collection: ScopeCollectionHandle<TValue> = {
      scope,
      key,
      list: (listOptions = {}) =>
        t.json<ScopeEntryPage<TValue>>(`${base}/entries`, undefined, {
          userId,
          ...(listOptions.limit !== undefined ? { limit: String(listOptions.limit) } : {}),
          ...(listOptions.cursor !== undefined ? { cursor: listOptions.cursor } : {}),
          ...(listOptions.topicPrefix !== undefined ? { topicPrefix: listOptions.topicPrefix } : {})
        }),
      entry: entryHandle,
      send
    };
    return collection as ScopeHandleOf<TDef>;
  }

  const read = (): Promise<ScopeResourceRead<TValue>> => t.json<ScopeResourceRead<TValue>>(base, undefined, { userId });
  const single: ScopeResourceHandle<TValue> = {
    scope,
    key,
    read,
    state: async () => (await read()).value,
    ...versioned(read, (value, version) => send<{ version: number }>("set", { state: value, version })),
    send
  };
  return single as ScopeHandleOf<TDef>;
}
