/**
 * The MOAT purge of stale containers is best-effort housekeeping: it runs as
 * background work beside a cold boot, and a purge that fails is logged, never
 * thrown. A thrown background failure fails a dispatched task's attempt, so a
 * docker hiccup in the purge would otherwise rerun a task whose work succeeded.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runForTest } from "@flow-state-dev/testing";

vi.mock("../src/bash/adapters/moat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/bash/adapters/moat")>()),
  purgeOldRuns: vi.fn(async () => {
    throw new Error("docker hiccup");
  })
}));

describe("the MOAT purge of stale containers", () => {
  it("logs a failed purge and settles, so it never fails the request's background work", async () => {
    const { createBashBlocks } = await import("../src/bash/blocks");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const workspace = await mkdtemp(path.join(os.tmpdir(), "purge-fails-"));
    // A stand-in request pool, so the purge's own outcome is observable.
    const queued: Array<{ promise: Promise<unknown>; meta: { name: string } }> = [];
    const pool = {
      addTask: (task: { promise: Promise<unknown>; meta: { name: string } }) => void queued.push(task),
      hasPendingForScope: () => false,
      drainScope: async () => ({ completed: [], failed: [] }),
      drainAll: async () => ({ completed: [], failed: [] }),
      drainToQuiescence: async () => ({ completed: [], failed: [] }),
      pendingCount: () => 0,
      failures: () => []
    };
    const ctx = {
      request: { identity: { id: "req-purge" } },
      session: { identity: { id: "purge", userId: "u1" } },
      user: { identity: { id: "u1" } },
      org: { identity: { id: "p1" } },
      resources: {},
      _requestSideChainPool: pool
    } as any;
    const { bashReadFile } = createBashBlocks({ provider: { type: "moat", workspace }, destination: "/workspace" });

    try {
      // The cold boot itself fails here (no MOAT installed); the purge beside it is what's under test.
      await runForTest(bashReadFile, { path: "notes.md" }, ctx).catch(() => undefined);
      const purge = queued.filter((task) => task.meta.name === "bash-purge-stale-containers");
      expect(purge).toHaveLength(1);
      await expect(purge[0]!.promise).resolves.not.toThrow();
      expect(warn.mock.calls.flat().join(" ")).toContain("docker hiccup");
    } finally {
      warn.mockRestore();
    }
  });
});
