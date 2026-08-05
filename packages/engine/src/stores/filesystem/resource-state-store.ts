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
 * ## Telling a legacy leaf from a versioned one
 *
 * A leaf written before versioning is the caller's `JsonObject` verbatim, so
 * the legacy test must not be "does this object have a `version` key" — the
 * object is user-controlled, and a state that happens to carry `version` or
 * `lifecycle` would be misread as store metadata (a `{lifecycle:"deleted"}`
 * field would hide a live row). It must read a fact the store owns.
 *
 * It does: the **root JSON type**. A stored state is a `JsonObject`, which is
 * an object by contract and can never be an array, so an array root is
 * unambiguously this store's envelope and an object root is unambiguously a
 * legacy value. The leading tag makes the intent legible on disk and guards
 * against a hand-edited file. No user object can forge either. A legacy leaf
 * therefore reads as **live at version 1**, and round-trips byte-identically
 * until something writes it.
 *
 * ## Guarantee
 *
 * Compare-under-lock via a per-key mutex held on the **store instance**: the
 * read, the version check and the write run without interleaving for a given
 * key. This closes the in-process race — two execution contexts in one Node
 * process — and does **not** protect two OS processes over one directory.
 * Documented, not implied.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  ContentScopeType,
  ExpectedVersion,
  ResourceStateStore,
  SetResult,
  VersionedResourceState
} from "../types";
import { assertExpectedVersion, checkWriteVersion } from "../resource-state-predicate";
import { createKeyedAsyncGate } from "../../utils/keyed-async-gate";
import { createFilesystemResourceStoreWithLayoutOps } from "./filesystem-resource-store";

/** Tag in slot 0 of a versioned leaf. Bumped only if the encoding changes. */
const ENVELOPE_TAG = "fsdev.resource-state/1";

/** The decoded leaf: state plus the metadata committed alongside it. */
type ResourceStateLeaf = {
  state: JsonObject;
  version: number;
  lifecycle: "live" | "deleted";
};

/**
 * Encode a leaf as its single on-disk record. The array root is what makes a
 * versioned leaf distinguishable from a legacy `JsonObject` one.
 */
function serializeLeaf(leaf: ResourceStateLeaf): string {
  return JSON.stringify([ENVELOPE_TAG, leaf.version, leaf.lifecycle, leaf.state]);
}

/**
 * Decode an on-disk leaf. An array root carrying the tag is a versioned
 * record; anything else is a pre-versioning value and reads as live at
 * version 1 — never as absent (BP-030).
 */
function deserializeLeaf(raw: string): ResourceStateLeaf {
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed[0] === ENVELOPE_TAG) {
    return {
      version: parsed[1] as number,
      lifecycle: parsed[2] as "live" | "deleted",
      state: parsed[3] as JsonObject
    };
  }
  return { state: parsed as JsonObject, version: 1, lifecycle: "live" };
}

/**
 * Create a filesystem-backed {@link ResourceStateStore} rooted at
 * `rootDir/state`.
 */
export function createFilesystemResourceStateStore(rootDir: string): ResourceStateStore {
  const leaves = createFilesystemResourceStoreWithLayoutOps<ResourceStateLeaf>({
    rootDir,
    subdir: "state",
    ext: ".json",
    serialize: serializeLeaf,
    deserialize: deserializeLeaf
  });

  // Per-key, per-store-instance mutex. Distinct keys never contend, so a
  // busy scope does not serialize behind one hot resource.
  const gate = createKeyedAsyncGate();
  const lockKey = (scopeType: ContentScopeType, scopeId: string, resourceKey: string): string =>
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
      assertExpectedVersion(expectedVersion);
      return gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
        // Guard first: a write that conflicts never reaches the factory's own
        // mutator, so the legacy re-scan has to happen here or a conflicting
        // write against an uninterpretable subtree would quietly succeed at
        // reporting a conflict instead of refusing.
        await leaves.assertWritableLayout();
        const leaf = await leaves.get(scopeType, scopeId, resourceKey);
        const conflict = checkWriteVersion(leaf, expectedVersion);
        if (conflict !== undefined) return conflict;

        // A recreate continues from the tombstone's version, never reusing one.
        const nextVersion = (leaf?.version ?? 0) + 1;
        await leaves.set(scopeType, scopeId, resourceKey, {
          state,
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
      assertExpectedVersion(expectedVersion);
      return gate.runExclusive(lockKey(scopeType, scopeId, resourceKey), async () => {
        // Same reason as `set`, and sharper: a delete of an absent key returns
        // without writing anything, so without this guard the destructive path
        // would stop re-scanning a subtree this build cannot interpret.
        await leaves.assertWritableLayout();
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
      //
      // The one exception is a subtree with no valid layout marker: it either
      // predates the nested layout (its keys are not enumerable, and having
      // never been versioned it has no version to retain) or is empty. The
      // outright removal `deleteAll` has always offered stays available there,
      // so an upgraded install can still tear down old scopes.
      if (!(await leaves.hasValidLayoutMarker())) {
        await leaves.purgeScopeDirectory(scopeType, scopeId);
        return;
      }

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
    }
  };
}
