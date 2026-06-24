/**
 * FIX-141 (PR 1): Filesystem SuspensionStore retention primitives.
 *
 * Covers the new `createdBefore` / `resolvedBefore` list filters and
 * `pruneTerminalBefore` for the filesystem adapter, mirroring the in-memory
 * coverage in `durability-stores.test.ts`. The filesystem store filters in
 * JS via the shared `matchesSuspensionFilter`, so these assert the adapter
 * wires that path through correctly.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import type { SuspensionStore } from "../src";
import { createFilesystemSuspensionStore } from "../src/stores/filesystem/suspension-store";

function makeRecord(overrides?: Partial<SuspensionRecord>): SuspensionRecord {
  return {
    suspensionId: "sus_1",
    requestId: "req_1",
    flowKind: "chat",
    actionName: "ask",
    userId: "user_1",
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "block_1",
    stepIndex: 0,
    createdAt: 1000,
    ...overrides
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeStore(): Promise<SuspensionStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsd-suspension-"));
  tmpDirs.push(dir);
  return createFilesystemSuspensionStore(dir);
}

describe("FilesystemSuspensionStore retention (FIX-141)", () => {
  it("list({ createdBefore }) returns only records created before the cutoff", async () => {
    const store = await makeStore();
    await store.set(makeRecord({ suspensionId: "old", requestId: "r1", createdAt: 100 }));
    await store.set(makeRecord({ suspensionId: "new", requestId: "r2", createdAt: 300 }));

    const results = await store.list({ createdBefore: 200 });
    expect(results.map((r) => r.suspensionId)).toEqual(["old"]);
  });

  it("list({ resolvedBefore }) matches only resolved records before the cutoff", async () => {
    const store = await makeStore();
    await store.set(makeRecord({ suspensionId: "pending", requestId: "r1", status: "pending" }));
    await store.set(
      makeRecord({ suspensionId: "early", requestId: "r2", status: "approved", resolvedAt: 100 })
    );
    await store.set(
      makeRecord({ suspensionId: "late", requestId: "r3", status: "approved", resolvedAt: 300 })
    );

    const results = await store.list({ resolvedBefore: 200 });
    expect(results.map((r) => r.suspensionId)).toEqual(["early"]);
  });

  it("pruneTerminalBefore deletes only terminal records resolved before the cutoff", async () => {
    const store = await makeStore();
    await store.set(
      makeRecord({ suspensionId: "t1", requestId: "r1", status: "approved", resolvedAt: 100 })
    );
    await store.set(
      makeRecord({ suspensionId: "t2", requestId: "r2", status: "expired", resolvedAt: 500 })
    );
    await store.set(
      makeRecord({ suspensionId: "p1", requestId: "r3", status: "pending", resolvedAt: 50 })
    );

    const deleted = await store.pruneTerminalBefore(200, 100);

    expect(deleted).toBe(1);
    expect(await store.get("r1", "t1")).toBeNull();
    expect(await store.get("r2", "t2")).not.toBeNull();
    expect(await store.get("r3", "p1")).not.toBeNull();
  });

  it("pruneTerminalBefore respects limit", async () => {
    const store = await makeStore();
    await store.set(
      makeRecord({ suspensionId: "t1", requestId: "r1", status: "approved", resolvedAt: 100 })
    );
    await store.set(
      makeRecord({ suspensionId: "t2", requestId: "r2", status: "rejected", resolvedAt: 100 })
    );

    expect(await store.pruneTerminalBefore(200, 1)).toBe(1);
    expect(await store.list()).toHaveLength(1);
  });

  it("pruneTerminalBefore returns 0 when nothing matches", async () => {
    const store = await makeStore();
    await store.set(makeRecord({ status: "pending" }));

    expect(await store.pruneTerminalBefore(Date.now() + 1000, 100)).toBe(0);
  });
});
