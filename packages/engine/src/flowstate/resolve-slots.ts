/**
 * Capability-slot → `StoreRegistry` resolution for `createFlowState`.
 *
 * Given the active profile (a `CapabilitySlotMap`), this realizes each
 * declared adapter and projects the capability slots onto the flat
 * `StoreRegistry` the runtime consumes. `primary` covers all
 * sub-stores; `blobs` projects onto `StoreRegistry.blobs`, defaulting to where
 * the sessions live. `bus` projects onto
 * `StoreRegistry.bus`, backed by the primary when the profile names no bus
 * and the primary declares it. Any sub-store left uncovered falls back to an
 * in-memory store, preserving the historical `resolveStores()` behavior; the
 * bus too.
 */
import path from "node:path";
import type { StoreRegistry } from "../stores/types";
import type { CapabilitySlot, CapabilitySlotMap, StoreAdapter } from "../stores/store-adapter";
import { resolveStores } from "../routes/http-handlers";
import { FlowStateConfigError } from "../errors/flow-error";
import { storesPersist } from "../durability/default-durability";
import { createLocalBlobStore } from "../blobs/local-blob-store";
import { createMemoryBlobStore } from "../blobs/memory-blob-store";
import type { BlobStore } from "../blobs/types";

/** The `StoreRegistry` sub-stores the `primary` capability backs. */
export const PRIMARY_REGISTRY_SLOTS: ReadonlyArray<keyof StoreRegistry> = [
  "session",
  "request",
  "user",
  "org",
  "activeRequests",
  "content",
  "checkpoints",
  "traces",
  "suspensions",
  "leases"
];

export type ResolvedProfileStores = {
  /** The fully-composed registry, with in-memory fallback for any gaps. */
  stores: StoreRegistry;
  /** Distinct adapters that were resolved — for `dispose()` aggregation. */
  adapters: StoreAdapter[];
};

/**
 * Resolve one profile's capability slots into a concrete `StoreRegistry`.
 *
 * Throws `FlowStateConfigError` when a declared slot's adapter doesn't
 * declare the matching capability — a configuration mistake that must fail
 * fast at first `ready()` rather than surface as a runtime store error.
 */
export async function resolveProfileStores(options: {
  profileName: string;
  profile: CapabilitySlotMap;
}): Promise<ResolvedProfileStores> {
  const { profileName, profile } = options;

  const partials: Array<Partial<StoreRegistry>> = [];
  const adapters: StoreAdapter[] = [];
  const seen = new Set<StoreAdapter>();

  // The bus (FIX-2426, epic D5): the profile's `bus` slot, else the primary
  // when it declares `bus`. Neither leaves it to `resolveStores`, in memory.
  const slots: Array<[CapabilitySlot, StoreAdapter | undefined]> = Object.entries(profile) as Array<
    [CapabilitySlot, StoreAdapter | undefined]
  >;
  if (profile.bus === undefined && profile.primary?.capabilities.includes("bus") === true) {
    slots.push(["bus", profile.primary]);
  }
  // The blobs: the profile's `blobs` slot, else the primary when it
  // declares `blobs` (a filesystem primary keeps them under its own root).
  if (profile.blobs === undefined && profile.primary?.capabilities.includes("blobs") === true) {
    slots.push(["blobs", profile.primary]);
  }

  for (const [slot, adapter] of slots) {
    if (adapter === undefined) continue;

    if (!adapter.capabilities.includes(slot)) {
      throw new FlowStateConfigError(
        `Profile "${profileName}" slot "${slot}": the configured adapter does not declare ` +
          `the "${slot}" capability (declares: ${adapter.capabilities.join(", ") || "none"}). ` +
          `Use an adapter that backs "${slot}".`
      );
    }

    if (!seen.has(adapter)) {
      seen.add(adapter);
      adapters.push(adapter);
    }

    const resolved = await adapter.resolve([slot]);
    if (slot === "blobs") {
      if (resolved.blobs === undefined) {
        throw new FlowStateConfigError(
          `Profile "${profileName}" slot "blobs": the adapter declares the "blobs" capability but resolved no blob store.`
        );
      }
      partials.push({ blobs: resolved.blobs });
      continue;
    }
    if (slot === "bus") {
      if (resolved.bus === undefined) {
        throw new FlowStateConfigError(
          `Profile "${profileName}" slot "bus": the adapter declares the "bus" capability but resolved no bus.`
        );
      }
      partials.push({ bus: resolved.bus });
      continue;
    }
    // Only the adapter backing `bus` supplies it: a primary that doesn't
    // declare the slot backs no bus, whatever its registry carries.
    const { bus: _undeclared, blobs: _undeclaredBlobs, ...rest } = resolved;
    partials.push(rest);
  }

  // Compose partials. Insertion order means a later, more-specific slot would
  // win an overlapping sub-store; today only `primary` projects sub-stores,
  // so there is no overlap to arbitrate.
  const merged: Partial<StoreRegistry> = {};
  for (const partial of partials) {
    Object.assign(merged, partial);
  }

  // Fill any uncovered sub-store from in-memory (historical `resolveStores`
  // behavior). With a `primary` adapter present this is a no-op.
  const stores = resolveStores(merged);
  stores.blobs ??= defaultBlobStore(stores, profileName);
  return { stores, adapters };
}

/**
 * Where a profile that names no `blobs` keeps its attachments: wherever its
 * sessions live. On disk under `.fsdev/blobs/<profile>` in the working
 * directory when the sessions persist, in memory when they don't, so a
 * restart never leaves bytes that no session points at. The folder is the
 * profile's own: two durable profiles run from one directory can share
 * session ids, and one's session cleanup must not reach the other's files.
 */
function defaultBlobStore(stores: StoreRegistry, profileName: string): BlobStore {
  return storesPersist(stores)
    ? createLocalBlobStore({ rootDir: path.join(process.cwd(), ".fsdev", "blobs", encodeURIComponent(profileName)) })
    : createMemoryBlobStore();
}
