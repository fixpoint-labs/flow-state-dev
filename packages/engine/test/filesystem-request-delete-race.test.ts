/**
 * A filesystem request `delete` must win against an event append that is
 * already in flight. The append takes its batch the moment it starts, so if
 * `delete` sweeps the sidecars without waiting for it, the append lands after
 * the sweep and recreates the event log under a freed id, which a later
 * request reusing the id would replay.
 *
 * The shared delete conformance case covers the same contract, but on this
 * store it only fails when the append happens to lose the race. Here the
 * append is held until the sweep has listed the directory (or, when `delete`
 * waits for it, until a short timeout), which makes the ordering fixed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRequestStreamEvent } from "../src/testing";

const gate = vi.hoisted(() => ({
  armed: false,
  release: (): void => {},
  held: Promise.resolve() as Promise<void>
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      await gate.held;
      return actual.appendFile(...args);
    },
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      const listing = await actual.readdir(...args);
      // The delete's sidecar sweep has taken its listing: let the append go.
      if (gate.armed) gate.release();
      return listing;
    }) as typeof actual.readdir
  };
});

const { createFilesystemRequestStore } = await import(
  "../src/stores/filesystem/request-store"
);

const dirs: string[] = [];

afterEach(async () => {
  gate.armed = false;
  gate.release();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("filesystem request delete against an in-flight event append", () => {
  it("leaves no event log behind for the freed id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-delete-race-"));
    dirs.push(dir);
    const store = createFilesystemRequestStore({ rootDir: dir });
    const requestId = "req_delete_race";

    gate.held = new Promise<void>((resolve) => {
      gate.release = resolve;
      // A `delete` that waits for the append never reaches the sweep while
      // the append is held; let it through after a moment instead.
      setTimeout(resolve, 200);
    });
    gate.armed = true;

    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);
    await store.delete(requestId);
    await store.flushEvents(requestId);

    expect(await store.getEvents(requestId)).toEqual([]);
  });
});
