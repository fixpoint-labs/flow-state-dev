import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import { createRequestStoreConformanceTests } from "../src/testing";

const POLL_INTERVAL_MS = 25;
const tempDirs: string[] = [];

createRequestStoreConformanceTests({
  name: "FilesystemRequestStore",
  pollIntervalMs: POLL_INTERVAL_MS,
  createStore: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-req-sub-"));
    tempDirs.push(dir);
    return createFilesystemRequestStore({
      rootDir: dir,
      subscribePollIntervalMs: POLL_INTERVAL_MS
    });
  },
  cleanup: async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
});
