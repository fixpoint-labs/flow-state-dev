/**
 * On-disk layout tests for nested filesystem resource state store.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemResourceStateStore } from "../../../src";
import { createResourceStateStoreConformanceTests } from "../../../src/stores/testing/resource-store-conformance";

describe("FilesystemResourceStateStore nested layout", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  async function freshRoot(): Promise<void> {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-nested-state-"));
  }

  createResourceStateStoreConformanceTests({
    name: "FilesystemResourceStateStore",
    createStore: async () => {
      await freshRoot();
      return createFilesystemResourceStateStore(rootDir);
    },
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes nested json for a slash-bearing key", async () => {
    await freshRoot();
    const store = createFilesystemResourceStateStore(rootDir);
    await store.set("session", "s1", "k/one", { n: 1 });
    const onDisk = path.join(rootDir, "state", "session", "s1", "k", "one.json");
    expect(JSON.parse(await readFile(onDisk, "utf8"))).toEqual({ n: 1 });
  });
});
