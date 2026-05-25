import { describe, expect, it } from "vitest";
import { inMemoryStores, FlowStateConfigError, type StoreAdapter } from "../../src";
import { resolveProfileStores, PRIMARY_REGISTRY_SLOTS } from "../../src/flowstate/resolve-slots";

/** A bare adapter that lies about its capabilities for the mismatch test. */
function fakeAdapter(capabilities: StoreAdapter["capabilities"]): StoreAdapter {
  return {
    capabilities,
    async resolve() {
      return {};
    }
  };
}

describe("resolveProfileStores", () => {
  it("composes a full StoreRegistry from a primary adapter", async () => {
    const { stores } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: inMemoryStores() }
    });
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(stores[slot]).toBeDefined();
    }
  });

  it("treats blobs as forward-compatible — no error, no projected sub-store", async () => {
    const { stores, adapters } = await resolveProfileStores({
      profileName: "default",
      profile: {
        primary: inMemoryStores(),
        blobs: fakeAdapter(["blobs"])
      }
    });
    // Still a complete registry (primary backs everything).
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(stores[slot]).toBeDefined();
    }
    // The blobs adapter is recorded for disposal but resolves no sub-store.
    expect(adapters.length).toBe(2);
  });

  it("throws when a slot's adapter does not declare the capability", async () => {
    await expect(
      resolveProfileStores({
        profileName: "prod",
        profile: {
          primary: inMemoryStores(),
          // Declares only "blobs" but is wired into the scheduler slot.
          scheduler: fakeAdapter(["blobs"])
        }
      })
    ).rejects.toBeInstanceOf(FlowStateConfigError);
  });

  it("falls back to in-memory for uncovered sub-stores", async () => {
    // An adapter that declares primary but returns only the session slot.
    const partialAdapter: StoreAdapter = {
      capabilities: ["primary"],
      async resolve() {
        const full = await inMemoryStores().resolve(["primary"]);
        return { session: full.session };
      }
    };
    const { stores } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: partialAdapter }
    });
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(stores[slot]).toBeDefined();
    }
  });
});
