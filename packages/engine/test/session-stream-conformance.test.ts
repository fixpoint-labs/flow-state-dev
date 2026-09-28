/**
 * The session stream's conformance suite on the two stores this package ships:
 * in memory, and on the filesystem. SQLite and Postgres run the same suite from
 * their own packages.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "../src";
import { createSessionStreamConformanceTests } from "../src/testing";

createSessionStreamConformanceTests({
  name: "in-memory",
  createStores: () => createInMemoryStores(),
  itemsReadableWhileRunning: false
});

const dirs: string[] = [];

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-session-stream-"));
  dirs.push(dir);
  return dir;
}

createSessionStreamConformanceTests({
  name: "filesystem",
  createStores: () => createFilesystemStores({ rootDir: scratchDir(), developmentOnly: true }),
  createSharedPair: async () => {
    const rootDir = scratchDir();
    return {
      a: createFilesystemStores({ rootDir, developmentOnly: true }),
      b: createFilesystemStores({ rootDir, developmentOnly: true })
    };
  },
  itemsReadableWhileRunning: true
});

// After the file rather than after each case: a request's last writes can land
// just after its case ends, and a directory removed under them only adds noise.
afterAll(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
