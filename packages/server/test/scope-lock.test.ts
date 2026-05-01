import { describe, expect, it } from "vitest";
import {
  ScopeMutationTimeoutError,
  withScopeLock
} from "../src/stores/scope-lock";

describe("withScopeLock", () => {
  it("serializes 100 concurrent mutators in submission order", async () => {
    const container = {};
    const log: number[] = [];
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 100; i += 1) {
      const idx = i;
      promises.push(
        withScopeLock(container, async () => {
          // Yield once so a naive implementation that runs in parallel
          // would interleave entries.
          await Promise.resolve();
          log.push(idx);
        })
      );
    }

    await Promise.all(promises);

    expect(log).toHaveLength(100);
    expect(log).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("does not serialize mutators on different containers", async () => {
    const a = {};
    const b = {};
    let aRunning = false;
    let bRanWhileARunning = false;

    const aRun = withScopeLock(a, async () => {
      aRunning = true;
      // Yield to let b's mutator schedule.
      await new Promise((resolve) => setTimeout(resolve, 5));
      aRunning = false;
    });
    const bRun = withScopeLock(b, async () => {
      if (aRunning) bRanWhileARunning = true;
    });

    await Promise.all([aRun, bRun]);
    expect(bRanWhileARunning).toBe(true);
  });

  it("a throwing mutator does not block subsequent mutators", async () => {
    const container = {};
    const log: string[] = [];

    const first = withScopeLock(container, async () => {
      log.push("first-start");
      throw new Error("boom");
    });
    const second = withScopeLock(container, async () => {
      log.push("second-ran");
    });

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBeUndefined();
    expect(log).toEqual(["first-start", "second-ran"]);
  });

  it("subsequent enqueuers don't see prior errors as their own", async () => {
    const container = {};
    const failing = withScopeLock(container, async () => {
      throw new Error("first failed");
    });
    await expect(failing).rejects.toThrow("first failed");

    const next = withScopeLock(container, async () => 42);
    await expect(next).resolves.toBe(42);
  });

  it("times out a slow mutator with ScopeMutationTimeoutError", async () => {
    const container = {};
    const slow = withScopeLock(
      container,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
      { timeoutMs: 30 }
    );

    await expect(slow).rejects.toBeInstanceOf(ScopeMutationTimeoutError);
  });

  it("includes queue wait in the timeout budget", async () => {
    const container = {};
    let blockerResolve: (() => void) | undefined;
    const blockerStarted = new Promise<void>((startResolve) => {
      withScopeLock(container, async () => {
        startResolve();
        await new Promise<void>((resolve) => {
          blockerResolve = resolve;
        });
      });
    });

    await blockerStarted;

    // Enqueue a fast mutator behind the blocker. Its body would run in
    // 0ms, but the timeout fires from queue wait alone.
    const queued = withScopeLock(
      container,
      async () => {
        // never reached
      },
      { timeoutMs: 30 }
    );

    await expect(queued).rejects.toBeInstanceOf(ScopeMutationTimeoutError);

    // Release the blocker so vitest doesn't warn about hanging promises.
    blockerResolve?.();
  });

  it("preserves return values from the mutator", async () => {
    const container = {};
    const result = await withScopeLock(container, async () => "hello");
    expect(result).toBe("hello");
  });
});
