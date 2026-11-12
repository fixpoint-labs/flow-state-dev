// FIX-2624.
/**
 * `client.resource(def)`: one user or org resource, read by scope and key with
 * no session, and written through the flow its `runBy` names.
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

/** What `client.resource` takes: a defined user or org resource (its `ref` is its key). */
export type ScopeResourceDef<TValue = JsonValue> = {
  scope: "session" | "user" | "org";
  ref?: string;
  /** The client projection's type, branded by `defineResource`. */
  ClientType?: TValue;
};

/** The client type a definition brands, or `JsonValue`. */
type ClientValue<TDef> = TDef extends { ClientType: infer C } ? C : JsonValue;

/** One read: the value as the client sees it, and the version it is at (0: nothing stored yet). */
export type ScopeResourceRead<TValue> = { value: TValue; version: number };

/** One user or org resource, by scope and key. */
export interface ScopeResourceHandle<TValue = JsonValue> {
  readonly scope: "user" | "org";
  readonly key: string;
  /** The value and its version. The value is the schema's default before any write. */
  read(): Promise<ScopeResourceRead<TValue>>;
  /** The value alone. */
  state(): Promise<TValue>;
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
  update(updater: (value: TValue) => TValue): Promise<{ version: number }>;
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

/** Build the handle. `sendSettled` posts a send and waits for its result. */
export function scopeResourceHandle<TDef extends ScopeResourceDef>(
  t: Transport,
  userId: string,
  sendSettled: SendSettled,
  def: TDef,
  options?: { key?: string }
): ScopeResourceHandle<ClientValue<TDef>> {
  type TValue = ClientValue<TDef>;
  if (def.scope !== "user" && def.scope !== "org") {
    clientError(`client.resource takes a user or org resource; a ${def.scope} resource is read through its session`);
  }
  const scope = def.scope;
  const key = requireValue(options?.key ?? def.ref, "resource key (the definition's ref, or options.key)");
  const base = `/api/flows/resources/${seg(scope)}/${seg(key)}`;

  // `userId` is read only by a host with no sign-in (open mode); a signed-in one ignores it.
  const read = (): Promise<ScopeResourceRead<TValue>> =>
    t.json<ScopeResourceRead<TValue>>(base, undefined, { userId });

  const writeAt = async (value: TValue, version: number): Promise<{ version: number }> => {
    const result = await sendSettled(`${base}/actions/set`, { userId, input: { state: value, version } });
    if (result.status === "completed") return result.output as { version: number };
    throw new ResourceWriteError(
      result.error?.code ?? result.status,
      result.error?.message ?? `The write to "${key}" ended ${result.status}`
    );
  };

  return {
    scope,
    key,
    read,
    state: async () => (await read()).value,
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
  };
}
