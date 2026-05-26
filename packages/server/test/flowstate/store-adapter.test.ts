import { describe, expect, it } from "vitest";
import {
  filesystemStores,
  inMemoryStores,
  type StoreAdapter
} from "../../src";
import { PRIMARY_REGISTRY_SLOTS } from "../../src/flowstate/resolve-slots";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("store adapters", () => {
  it("inMemoryStores declares the primary capability", () => {
    const adapter = inMemoryStores();
    expect(adapter.capabilities).toEqual(["primary"]);
  });

  it("inMemoryStores resolve() returns every primary StoreRegistry slot", async () => {
    const adapter = inMemoryStores();
    const partial = await adapter.resolve(["primary"]);
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(partial[slot]).toBeDefined();
    }
  });

  it("inMemoryStores memoizes the registry across resolves", async () => {
    const adapter = inMemoryStores();
    const first = await adapter.resolve(["primary"]);
    const second = await adapter.resolve(["primary"]);
    expect(first.session).toBe(second.session);
  });

  it("filesystemStores declares primary and resolves a full registry", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "fsd-store-adapter-"));
    const adapter: StoreAdapter = filesystemStores({ rootDir });
    expect(adapter.capabilities).toEqual(["primary"]);
    const partial = await adapter.resolve(["primary"]);
    for (const slot of PRIMARY_REGISTRY_SLOTS) {
      expect(partial[slot]).toBeDefined();
    }
  });
});
