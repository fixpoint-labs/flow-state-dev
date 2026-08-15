/**
 * The collections of `src/model/entities.ts`, registered against durable state.
 *
 * `entities.ts` declares *what* is stored and *where it lives*; it deliberately
 * imports nothing that does I/O, so nothing there resolves an address. This
 * module is the other half: it turns each collection's declared scope into a
 * concrete `(scope, scopeId)` address in the store, and hands back a typed
 * handle that parses through the collection's own `stateSchema`.
 *
 * **The scope decisions are not re-made here.** They are read off the
 * declarations, and the long comment above `conductorRegistry` is the reason
 * each one is what it is. All this module does is honour them:
 *
 * | Declared | Resolves to | Which is |
 * |---|---|---|
 * | `scope: "org"` | `(org, orgId)` | the cross-epic registry, and nothing else |
 * | `scope: "session"`, `sharedToWorkstream: true` | `(session, lineageId)` | the entity graph — the epic session and every workstream under it |
 * | `scope: "session"` | `(session, sessionId)` | one workstream's own working record |
 *
 * Those are the *only* two session addresses that exist, which is the rule from
 * `entities.ts` worth keeping in mind while reading anything below: there is no
 * intermediate altitude to fall into, so a collection is either shared with the
 * lineage root or private to the running session.
 *
 * **A schema is applied on the way in and on the way out.** Parsing on read is
 * what makes BP-030 hold for free: a record written before a field existed reads
 * back carrying that field's declared default, so the tick never branches on
 * "which vintage is this row". A record carrying a field the schema has since
 * removed fails loudly at the key that holds it, which is the direction that
 * should be loud.
 */

// The collection-key helpers live on `core`'s `types` subpath, which is where
// the resource layer's own key resolution comes from. Conductor resolves keys
// the same way the registry would, rather than re-deriving a prefix from a
// pattern it does not own.
import { getPatternPrefix, resolveCollectionKey } from "@flow-state-dev/core/types";
import type { z } from "zod";

import {
  conductorArtifacts,
  conductorCursors,
  conductorDispatches,
  conductorEpics,
  conductorIssues,
  conductorLedger,
  conductorObservations,
  conductorRegistry,
} from "../model/entities";
import {
  ConductorStateError,
  type ScopeAddress,
  type StateStore,
} from "./store";

/**
 * The three ids every address in conductor resolves against.
 *
 * `sessionId` and `lineageId` are nullable so the registry — the one collection
 * that is readable with no work item in hand — can be addressed before either
 * is known. Addressing a session-scoped collection without them raises rather
 * than inventing an address, because a resource written to a guessed session is
 * a resource nothing will ever read again.
 */
export interface ConductorScopeIds {
  /** The org the registry lives in. Conductor must run org-bound to have one. */
  readonly orgId: string;
  /** The session this work item's ticks run in. */
  readonly sessionId: string | null;
  /**
   * The lineage root — the epic session, or the session itself for work with no
   * epic above it. Minted by the root and inherited verbatim, never derived.
   */
  readonly lineageId: string | null;
}

/**
 * The shape this module needs off a collection declaration. Structural rather
 * than imported so `entities.ts` keeps its `defineResourceCollection` typing
 * without this file depending on the resource layer's generics.
 */
interface StoredCollection<TSchema extends z.ZodTypeAny> {
  readonly pattern: string;
  readonly scope: string;
  readonly sharedToWorkstream?: boolean;
  readonly stateSchema: TSchema;
  readonly maxInstances?: number;
  readonly eviction?: string;
}

/** A typed, address-resolved handle on one collection. */
export interface CollectionHandle<TState> {
  /** Where this collection resolved to. Exposed so a test can assert the scope. */
  readonly address: ScopeAddress;
  /** The full storage key a bare key resolves to — `"FIX-1"` → `"issues/FIX-1"`. */
  keyFor(key: string): string;
  /** Read one instance, parsed through the schema, or `null` when absent. */
  read(key: string): Promise<TState | null>;
  /** Write one instance, validated through the schema. */
  write(key: string, state: TState): Promise<void>;
  /** Every instance in this collection, ordered by storage key. */
  list(): Promise<readonly TState[]>;
  /** How many instances exist. */
  count(): Promise<number>;
  /** Remove one instance. `true` when one was there. */
  remove(key: string): Promise<boolean>;
  /** The prose half — a spec document, a work item's own description. */
  readContent(key: string): Promise<string | null>;
  /** Write the prose half. Never read by `decide`. */
  writeContent(key: string, content: string): Promise<void>;
}

/**
 * Resolve a collection's declared scope to the address it stores at.
 *
 * @throws {ConductorStateError} when a session-scoped collection is addressed
 *   with no session in hand, or when a collection declares a scope conductor
 *   does not use.
 */
export function addressFor(
  collection: Pick<StoredCollection<z.ZodTypeAny>, "pattern" | "scope" | "sharedToWorkstream">,
  ids: ConductorScopeIds,
): ScopeAddress {
  if (collection.scope === "org") return { scope: "org", scopeId: ids.orgId };

  if (collection.scope === "session") {
    const scopeId = collection.sharedToWorkstream ? ids.lineageId : ids.sessionId;
    if (scopeId === null) {
      throw new ConductorStateError(
        `${collection.pattern} is session-scoped, so it cannot be addressed before the ` +
          `work item's session is known. Read the registry first.`,
        collection.pattern,
      );
    }
    return { scope: "session", scopeId };
  }

  throw new ConductorStateError(
    `${collection.pattern} declares scope ${JSON.stringify(collection.scope)}, which ` +
      `conductor does not address. Conductor stores at org and session scope only.`,
    collection.pattern,
  );
}

/**
 * Bind one collection to a store at the address its scope resolves to.
 *
 * The capacity check is here rather than in the store because it is a property
 * of the *collection* — `conductorRegistry` is the only one that declares a cap,
 * and it declares `eviction: "none"` because dropping a row there abandons work
 * that is still live. Refusing the write is the loud, recoverable failure that
 * choice asks for.
 */
export function collectionHandle<TSchema extends z.ZodTypeAny>(
  store: StateStore,
  collection: StoredCollection<TSchema>,
  ids: ConductorScopeIds,
): CollectionHandle<z.infer<TSchema>> {
  const address = addressFor(collection, ids);
  const prefix = getPatternPrefix(collection.pattern);
  const keyFor = (key: string) => resolveCollectionKey(collection.pattern, key);

  const parse = (state: unknown, key: string): z.infer<TSchema> => {
    const parsed = collection.stateSchema.safeParse(state);
    if (!parsed.success) {
      throw new ConductorStateError(
        `The record at ${key} does not match ${collection.pattern}'s state schema: ` +
          `${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
        key,
      );
    }
    return parsed.data as z.infer<TSchema>;
  };

  return {
    address,
    keyFor,

    async read(key) {
      const state = await store.read(address, keyFor(key));
      return state === null ? null : parse(state, keyFor(key));
    },

    async write(key, state) {
      const storageKey = keyFor(key);
      const validated = parse(state, storageKey) as Record<string, unknown>;

      if (collection.maxInstances !== undefined) {
        const exists = (await store.read(address, storageKey)) !== null;
        const count = (await store.list(address, prefix)).length;
        if (!exists && count >= collection.maxInstances) {
          throw new ConductorStateError(
            `${collection.pattern} holds its declared maximum of ${collection.maxInstances} ` +
              `instances and evicts none, so ${storageKey} was refused. A cap reached here ` +
              `means rows are leaking rather than accumulating — find the missed deletion.`,
            storageKey,
          );
        }
      }

      await store.write(address, storageKey, validated);
    },

    async list() {
      const records = await store.list(address, prefix);
      return records.map((record) => parse(record.state, record.key));
    },

    async count() {
      return (await store.list(address, prefix)).length;
    },

    remove: (key) => store.remove(address, keyFor(key)),
    readContent: (key) => store.readContent(address, keyFor(key)),
    writeContent: (key, content) => store.writeContent(address, keyFor(key), content),
  };
}

/** Every collection conductor stores, resolved for one work item's scopes. */
export interface ConductorCollections {
  /** Org-scoped. What is under management, and which session ticks it. */
  readonly registry: CollectionHandle<z.infer<typeof conductorRegistry.stateSchema>>;
  /** Epic-level. */
  readonly epics: CollectionHandle<z.infer<typeof conductorEpics.stateSchema>>;
  /** Epic-level — the issue entity and the epic's roster, deliberately one thing. */
  readonly issues: CollectionHandle<z.infer<typeof conductorIssues.stateSchema>>;
  /** Epic-level, so cross-spec review can read a sibling's spec. */
  readonly artifacts: CollectionHandle<z.infer<typeof conductorArtifacts.stateSchema>>;
  /** Issue-level. One row per phase execution. */
  readonly dispatches: CollectionHandle<z.infer<typeof conductorDispatches.stateSchema>>;
  /** Issue-level. The copy `reconcile` diffs against. */
  readonly observations: CollectionHandle<z.infer<typeof conductorObservations.stateSchema>>;
  /** Issue-level. The comment half of the observation cursor. */
  readonly cursors: CollectionHandle<z.infer<typeof conductorCursors.stateSchema>>;
  /** Issue-level. The transcript every transition is replayed from. */
  readonly ledger: CollectionHandle<z.infer<typeof conductorLedger.stateSchema>>;
}

/**
 * Register every declared collection against a store, for one work item.
 *
 * @param store Where records live.
 * @param ids The org, session and lineage the collections address against.
 */
export function conductorCollections(
  store: StateStore,
  ids: ConductorScopeIds,
): ConductorCollections {
  return {
    registry: collectionHandle(store, conductorRegistry, ids),
    epics: collectionHandle(store, conductorEpics, ids),
    issues: collectionHandle(store, conductorIssues, ids),
    artifacts: collectionHandle(store, conductorArtifacts, ids),
    dispatches: collectionHandle(store, conductorDispatches, ids),
    observations: collectionHandle(store, conductorObservations, ids),
    cursors: collectionHandle(store, conductorCursors, ids),
    ledger: collectionHandle(store, conductorLedger, ids),
  };
}
