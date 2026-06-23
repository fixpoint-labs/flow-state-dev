/**
 * FIX-141 (PR 1): `CheckpointStore.deleteForRequest` retention primitive.
 *
 * Verifies the bulk-by-request delete removes every checkpoint for one
 * request across all blockInstanceIds while leaving other requests intact,
 * and is a no-op for a request with no checkpoints. Covered for both the
 * in-memory and filesystem adapters (the SQLite/Postgres adapters carry the
 * same assertions in their own package tests).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SequencerCheckpoint } from "@flow-state-dev/core/types";
import type { CheckpointStore } from "../src";
import { createInMemoryCheckpointStore } from "../src/stores/memory/checkpoint-store";
import { createFilesystemCheckpointStore } from "../src/stores/filesystem/checkpoint-store";

function makeCheckpoint(
  requestId: string,
  blockInstanceId: string
): SequencerCheckpoint {
  return {
    requestId,
    blockInstanceId,
    parentBlockInstanceId: null,
    stepIndex: 0,
    state: { v: blockInstanceId },
    version: 1,
    createdAt: 1000
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFilesystemStore(): Promise<CheckpointStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsd-checkpoint-"));
  tmpDirs.push(dir);
  return createFilesystemCheckpointStore(dir);
}

const cases: Array<{ name: string; make: () => CheckpointStore | Promise<CheckpointStore> }> = [
  { name: "InMemoryCheckpointStore", make: createInMemoryCheckpointStore },
  { name: "FilesystemCheckpointStore", make: makeFilesystemStore }
];

for (const { name, make } of cases) {
  describe(`${name}.deleteForRequest`, () => {
    it("removes every checkpoint for the request, leaving other requests intact", async () => {
      const store = await make();
      await store.write(makeCheckpoint("r1", "b1"));
      await store.write(makeCheckpoint("r1", "b2"));
      await store.write(makeCheckpoint("r2", "b1"));

      await store.deleteForRequest("r1");

      expect(await store.latest("r1", "b1")).toBeNull();
      expect(await store.latest("r1", "b2")).toBeNull();
      expect(await store.latest("r2", "b1")).not.toBeNull();
    });

    it("is a no-op for a request with no checkpoints", async () => {
      const store = await make();
      await store.write(makeCheckpoint("r1", "b1"));

      await store.deleteForRequest("unknown");

      expect(await store.latest("r1", "b1")).not.toBeNull();
    });
  });
}
