/**
 * On-disk layout and legacy-guard tests for nested filesystem resource stores.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemContentStore } from "../../../src";
import { createContentStoreConformanceTests } from "../../../src/stores/testing/resource-store-conformance";
import { LAYOUT_MARKER_NAME } from "../../../src/stores/filesystem/resource-path";

describe("FilesystemContentStore nested layout", () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  async function freshRoot(): Promise<void> {
    rootDir = await mkdtemp(path.join(tmpdir(), "fsd-nested-content-"));
  }

  createContentStoreConformanceTests({
    name: "FilesystemContentStore",
    createStore: async () => {
      await freshRoot();
      return createFilesystemContentStore(rootDir);
    },
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes a nested markdown file for a slash-bearing key", async () => {
    await freshRoot();
    const store = createFilesystemContentStore(rootDir);
    await store.set("session", "s1", "concepts/flow-state-dev/overview", "# Title");
    const onDisk = path.join(
      rootDir,
      "content",
      "session",
      "s1",
      "concepts",
      "flow-state-dev",
      "overview.md"
    );
    expect(await readFile(onDisk, "utf8")).toBe("# Title");
    expect(await store.get("session", "s1", "concepts/flow-state-dev/overview")).toBe("# Title");
  });

  it("read on a fresh root does not create a layout marker", async () => {
    await freshRoot();
    const store = createFilesystemContentStore(rootDir);
    expect(await store.get("session", "s1", "missing")).toBeUndefined();
    const marker = path.join(rootDir, "content", LAYOUT_MARKER_NAME);
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a legacy flat file tree without a layout marker", async () => {
    await freshRoot();
    const legacyScope = path.join(rootDir, "content", "session", "s1");
    await mkdir(legacyScope, { recursive: true });
    await writeFile(path.join(legacyScope, "concepts%2Fflow-state-dev%2Foverview"), "old", "utf8");
    const store = createFilesystemContentStore(rootDir);
    await expect(store.get("session", "s1", "anything")).rejects.toThrow(/nested-layout/);
  });

  it("deleteAll clears a legacy scope without surfacing the layout guard", async () => {
    await freshRoot();
    const legacyScope = path.join(rootDir, "content", "session", "s1");
    await mkdir(legacyScope, { recursive: true });
    await writeFile(path.join(legacyScope, "flat-key"), "old", "utf8");
    const store = createFilesystemContentStore(rootDir);
    await store.deleteAll("session", "s1");
    await store.set("session", "s1", "fresh", "ok");
    expect(await store.get("session", "s1", "fresh")).toBe("ok");
  });
});
