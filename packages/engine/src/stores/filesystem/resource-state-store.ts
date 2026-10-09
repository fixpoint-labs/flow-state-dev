/**
 * Filesystem-backed resource state store.
 *
 * Layers compare-and-swap over the generic {@link createFilesystemResourceStore}
 * factory: a resource key maps to a nested on-disk path with the extension on
 * the leaf — `set("session","s1","todos/a", state)` writes
 * `rootDir/state/session/s1/todos/a.json`.
 *
 * ## The leaf is a self-contained committed record
 *
 * A versioned leaf holds the state *and* its version and lifecycle in **one
 * file**, encoded as a JSON array:
 *
 *     ["fsdev.resource-state/1", <version>, <lifecycle>, <state>]
 *
 * One file is the whole point. The store's durability primitive is a per-file
 * temp-write + `rename`, which is atomic for one file and **does not compose
 * across two** — so splitting metadata into a sibling leaf would leave a crash
 * between the two renames pairing a new state body with a stale version. A
 * reader could then match a stale `expectedVersion`, or observe a state change
 * that never bumped a version. Keeping state and metadata in a single record
 * makes the existing single `rename` the commit point, so the pair is written
 * atomically or not at all. That is the crash-atomicity requirement, closed by
 * construction rather than by a protocol layered on top.
 *
 * The leading tag makes the intent legible on disk and guards against a
 * hand-edited file.
 *
 * ## Guarantee
 *
 * Compare-under-lock via a per-key mutex held on the **store instance**: the
 * read, the version check and the write run without interleaving for a given
 * key. This closes the in-process race — two execution contexts in one Node
 * process — and does **not** protect two OS processes over one directory.
 * Documented, not implied.
 *
 * The value `set` commits is snapshotted *before* the mutex is entered rather
 * than inside it. The lock decides the order writes land in; it does not decide
 * which bytes a write carries, and by the time the guarded body runs the caller
 * has long had control back.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  StorageScopeType,
  ExpectedVersion,
  ResourceStateStore,
  SetResult,
  VersionedResourceState
} from "../types";
import {
  assertDeleteExpectedVersion,
  assertSetExpectedVersion,
  checkWriteVersion,
  toStoredState
} from "../resource-state-predicate";
import { createKeyedAsyncGate } from "../../utils/keyed-async-gate";
import { createFilesystemResourceStore } from "./filesystem-resource-store";

/** Tag in slot 0 of a versioned leaf. Bumped only if the encoding changes. */
const ENVELOPE_TAG = "fsdev.resource-state/1";

/** The decoded leaf: state plus the metadata committed alongside it. */
type ResourceStateLeaf = {
  state: JsonObject;
  version: number;
  lifecycle: "live" | "deleted";
};

/** Encode a leaf as its single on-disk record. */
function serializeLeaf(leaf: ResourceStateLeaf): string {
  return JSON.stringify([ENVELOPE_TAG, leaf.version, leaf.lifecycle, leaf.state]);
}

/** Decode an on-disk leaf. Anything but a tagged envelope is refused. */
function deserializeLeaf(raw: string): ResourceStateLeaf {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed[0] !== ENVELOPE_TAG) {
    throw new Error(`Resource state leaf is not a "${ENVELOPE_TAG}" record`);
  }
  return {
    version: parsed[1] as number,
    lifecycle: parsed[2] as "live" | "deleted",
    state: parsed[3] as JsonObject
  };
}

/**
 * Create a filesystem-backed {@link ResourceStateStore} rooted at
 * `rootDir/state`.
 */
export function createFilesystemResourceStateStore(rootDir: string): ResourceStateStore {
  const leaves = createFilesystemResourceStore<ResourceStateLeaf>({
    rootDir,
    subdir: "state",
    ext: ".json",
    serialize: serializeLeaf,
    deserialize: deserializeLeaf
  });

  // Per-key, per-store-instance mutex. Distinct keys never contend, so a
  // busy scope does not serialize behind one hot resource.
  const gate = createKeyedAsyncGate();
  const lockKey = (scopeType: StorageScopeType, scopeId: string, resourceKey: string): string =>
    JSON.stringify([scopeType, scopeId, resourceKey]);

  /** Live rows only, projected to the public read shape. */
  const liveOnly = (
    all: Record<string, ResourceStateLeaf>
  ): Record<string, VersionedResourceState> => {
    const result: Record<string, VersionedResourceState> = {};
    for (const [key, leaf] of Object.entries(all)) {
      if (leaf.lifecycle !== "live") continue;
      result[key] = { state: leaf.state, version: leaf.version };
    }
    return result;
  };

  return {
    async get(scopeType, scopeId, resourceKey): Promise<VersionedResourceState | undefined> {
      const leaf = await leaves.get(scopeType, scopeId, resourceKey);
      if (leaf === undefined || leaf.lifecycle !== "live") return undefined;
      return { state: leaf.state, version: leaf.version };
    },

    async set(
      scopeType,
      scopeId,
      resourceKey,
      state: JsonObject,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      assertSetExpectedVersion(expectedVersion);
      // Snapshot BEFORE the gate, not inside it.
      //
      // The contract's snapshot rule is about *when* the value is captured, not
      // about whether the adapter serializes at all. This one does serialize —
      // but only in the gate callback, and `runExclusive` resolves through a
      // `.then`, so that callback runs on a microtask at the earliest and
      // behind any same-key writer at the latest. Either way the caller has had
      // control back before it runs. Capturing there commits whatever the
      // caller's object holds by then, so a caller that mutates or reuses
      // `state` while the promise is in flight gets that later mutation
      // persisted under a version that never witnessed it — the same failure as
      // aliasing, reached by timing rather than by a retained reference.
      //
      // The other three adapters get this right by capturing on the synchronous
      // run-up to their first `await`: memory clones with no `await` at all,
      // and both SQL adapters `JSON.stringify` before their first query. That
      // is the property to check, not the presence of serialization.
      //
      // The snapshot is the JSON round-trip, not a structured clone (FIX-1266):
      // a structured clone refuses a function or symbol field that the SQL
      // adapters silently drop, and keeps a `bigint` until `serializeLeaf`
      // throws on it inside the gate. Snapshotting the stored form makes this
      // adapter commit, and refuse, exactly what the others do.
      const snapshot = toStoredState(state);
      return gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
        const leaf = await leaves.get(scopeType, scopeId, resourceKey);
        const conflict = checkWriteVersion(leaf, expectedVersion);
        if (conflict !== undefined) return conflict;

        // A recreate continues from the tombstone's version, never reusing one.
        const nextVersion = (leaf?.version ?? 0) + 1;
        await leaves.set(scopeType, scopeId, resourceKey, {
          state: snapshot,
          version: nextVersion,
          lifecycle: "live"
        });
        return { ok: true as const, version: nextVersion };
      });
    },

    async delete(
      scopeType,
      scopeId,
      resourceKey,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> {
      // Ahead of the idempotent short-circuits below: an unusable
      // `expectedVersion` is refused for every key, live or not.
      assertDeleteExpectedVersion(expectedVersion);
      return gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
        const leaf = await leaves.get(scopeType, scopeId, resourceKey);
        // Nothing live to remove: idempotent, and no tombstone is minted for a
        // key that never existed — there is no observer to fence.
        if (leaf === undefined) return { ok: true as const, version: 0 };
        if (leaf.lifecycle !== "live") return { ok: true as const, version: leaf.version };

        const conflict = checkWriteVersion(leaf, expectedVersion);
        if (conflict !== undefined) return conflict;

        // Retain the version, drop the payload.
        await leaves.set(scopeType, scopeId, resourceKey, {
          state: {},
          version: leaf.version,
          lifecycle: "deleted"
        });
        return { ok: true as const, version: leaf.version };
      });
    },

    async getAll(scopeType, scopeId): Promise<Record<string, VersionedResourceState>> {
      return liveOnly(await leaves.getAll(scopeType, scopeId));
    },

    async getByPrefix(
      scopeType,
      scopeId,
      keyPrefix
    ): Promise<Record<string, VersionedResourceState>> {
      return liveOnly(await leaves.getByPrefix(scopeType, scopeId, keyPrefix));
    },

    async deleteAll(scopeType, scopeId): Promise<void> {
      // A scope purge must retain every key's version — that retention is what
      // stops a straggler from the previous generation matching a row in the
      // next one — so this enumerates and marks instead of removing the tree.

      const all = await leaves.getAll(scopeType, scopeId);
      for (const [resourceKey, leaf] of Object.entries(all)) {
        if (leaf.lifecycle !== "live") continue;
        await gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
          // Re-read under the lock: a concurrent writer may have advanced the
          // row since enumeration, and the tombstone must carry the version
          // that is actually current.
          const current = await leaves.get(scopeType, scopeId, resourceKey);
          if (current === undefined || current.lifecycle !== "live") return;
          await leaves.set(scopeType, scopeId, resourceKey, {
            state: {},
            version: current.version,
            lifecycle: "deleted"
          });
        });
      }
    },

    async purgeTombstones(scopeType, scopeId): Promise<void> {
      // The inverse of `deleteAll` above, and the same enumerate-and-act shape
      // with the lifecycle test flipped: it marks the live ones, this removes
      // the dead ones.

      const all = await leaves.getAll(scopeType, scopeId);
      for (const [resourceKey, leaf] of Object.entries(all)) {
        if (leaf.lifecycle === "live") continue;
        await gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
          // Re-read under the lock for the same reason `deleteAll` does: a
          // writer may have moved the row since enumeration. A row that came
          // back to life is not this operation's to remove.
          const current = await leaves.get(scopeType, scopeId, resourceKey);
          if (current === undefined || current.lifecycle === "live") return;
          await leaves.delete(scopeType, scopeId, resourceKey);
        });
      }
    }
  };
}
