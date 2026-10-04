/**
 * The lock on disk that keeps two hosts — or two processes — sharing a root
 * from provisioning one place or one clone at the same time.
 */
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock, type LockBounds } from "../src/lock";
import { tempDir } from "./git-fixtures";

let dir: string;
let path: string;
const bounds: LockBounds = { waitMs: 2_000, pollMs: 10, staleAfterMs: 400, heartbeatMs: 50 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  dir = tempDir("lock");
  path = join(dir, ".lock");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("one holder at a time", () => {
  it("makes a second taker wait until the first releases", async () => {
    const first = await acquireLock(path, bounds);
    let secondHeld = false;
    const second = acquireLock(path, bounds).then((lease) => {
      secondHeld = true;
      return lease;
    });

    await pause(100);
    expect(secondHeld).toBe(false);
    releaseLock(first);
    releaseLock(await second);
    expect(existsSync(path)).toBe(false);
  });

  it("keeps a live holder's lock past the stale bound, so it is never taken from under it", async () => {
    // The holder refreshes the lock while it works, so only a holder that
    // stopped — a process that died — ever looks stale.
    const first = await acquireLock(path, bounds);
    let secondHeld = false;
    const second = acquireLock(path, bounds).then((lease) => {
      secondHeld = true;
      return lease;
    });

    await pause(bounds.staleAfterMs * 2);
    expect(secondHeld).toBe(false);
    releaseLock(first);
    releaseLock(await second);
  });

  it("gives up after its wait bound rather than waiting forever", async () => {
    const first = await acquireLock(path, bounds);
    await expect(acquireLock(path, { ...bounds, waitMs: 100 })).rejects.toThrow(/still held/);
    releaseLock(first);
  });
});

describe("a holder that died", () => {
  it("has its lock taken once it is older than the stale bound", async () => {
    writeFileSync(path, JSON.stringify({ token: "a process that died" }));
    const old = (Date.now() - bounds.staleAfterMs * 2) / 1000;
    utimesSync(path, old, old);

    const lease = await acquireLock(path, bounds);
    expect(JSON.parse(readFileSync(path, "utf8")).token).toBe(lease.token);
    releaseLock(lease);
  });
});

describe("release", () => {
  it("never removes a lock another taker holds now", async () => {
    // A holder whose lock was taken as stale must not remove its successor's.
    const first = await acquireLock(path, bounds);
    rmSync(path);
    const second = await acquireLock(path, bounds);

    releaseLock(first);
    expect(existsSync(path)).toBe(true);
    releaseLock(second);
    expect(existsSync(path)).toBe(false);
  });
});
