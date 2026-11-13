import { describe, expect, it } from "vitest";
import { createInMemoryBus, type ChangeBus } from "../../src/host";
import { inMemoryStores, type StoreAdapter } from "../../src";
import { FlowStateConfigError } from "../../src/errors/flow-error";
import { resolveProfileStores, PRIMARY_REGISTRY_SLOTS } from "../../src/flowstate/resolve-slots";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";

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

  // FIX-824.
  it("projects the blobs slot onto the registry's blob store", async () => {
    const blobs = createMemoryBlobStore();
    const { stores, adapters } = await resolveProfileStores({
      profileName: "default",
      profile: {
        primary: inMemoryStores(),
        blobs: { capabilities: ["blobs"], resolve: async () => ({ blobs }) }
      }
    });
    // Still a complete registry (primary backs everything else).
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(stores[slot]).toBeDefined();
    }
    expect(stores.blobs).toBe(blobs);
    expect(adapters.length).toBe(2);
  });

  it("throws when a slot's adapter does not declare the capability", async () => {
    await expect(
      resolveProfileStores({
        profileName: "prod",
        profile: {
          primary: inMemoryStores(),
          // Declares only "blobs" but is wired into the bus slot.
          bus: fakeAdapter(["blobs"])
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

describe("resolveProfileStores · the bus slot (FIX-2426)", () => {
  /** An adapter whose registry is in memory, carrying `bus` when asked for that slot. */
  function busAdapter(capabilities: StoreAdapter["capabilities"], bus: ChangeBus): StoreAdapter {
    const inner = inMemoryStores();
    return {
      capabilities,
      async resolve(slots) {
        const full = await inner.resolve(["primary"]);
        return slots.includes("bus") ? { ...full, bus } : full;
      }
    };
  }

  it("backs the bus with the primary when the primary declares it and the profile names none", async () => {
    const bus = createInMemoryBus();
    const { stores } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: busAdapter(["primary", "bus"], bus) }
    });
    expect(stores.bus).toBe(bus);
  });

  it("uses the profile's own bus slot over the primary's", async () => {
    const primaryBus = createInMemoryBus();
    const ownBus = createInMemoryBus();
    const { stores, adapters } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: busAdapter(["primary", "bus"], primaryBus), bus: busAdapter(["bus"], ownBus) }
    });
    expect(stores.bus).toBe(ownBus);
    expect(adapters.length).toBe(2);
  });

  it("gives a primary that doesn't declare the slot an in-memory bus, never one its registry carries", async () => {
    const undeclared = createInMemoryBus();
    const lying: StoreAdapter = {
      capabilities: ["primary"],
      async resolve() {
        return { ...(await inMemoryStores().resolve(["primary"])), bus: undeclared };
      }
    };
    const { stores } = await resolveProfileStores({ profileName: "default", profile: { primary: lying } });
    expect(stores.bus).toBeDefined();
    expect(stores.bus).not.toBe(undeclared);
    expect(stores.bus?.crossesProcesses).toBe(true);
  });

  it("fails at resolution when the bus slot's adapter doesn't declare `bus`", async () => {
    await expect(
      resolveProfileStores({
        profileName: "prod",
        profile: { primary: inMemoryStores(), bus: busAdapter(["primary"], createInMemoryBus()) }
      })
    ).rejects.toBeInstanceOf(FlowStateConfigError);
  });

  it("fails at resolution when an adapter declares `bus` and resolves none", async () => {
    await expect(
      resolveProfileStores({
        profileName: "prod",
        profile: { primary: inMemoryStores(), bus: fakeAdapter(["bus"]) }
      })
    ).rejects.toThrow(/resolved no bus/);
  });
});
