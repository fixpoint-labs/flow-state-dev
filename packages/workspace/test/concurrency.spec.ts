/**
 * What happens when two operations are in flight at once.
 *
 * The rest of the suite drives one projection to completion before starting
 * the next thing. These tests deliberately interleave at a specific await,
 * because a claim taken on the wrong side of one is a claim that does not
 * stop the race it exists for.
 *
 * The gate is a collection whose read (or write) parks until the test
 * releases it. That is the only way to pin an interleave deterministically:
 * a timing test that passes on a fast machine and fails on a slow one is
 * worse than no test.
 */
import { describe, it, expect } from "vitest";
import { createProjection } from "../src/projection";
import { createMemoryPlace } from "../src/memory-place";
import { createClaimRegistry } from "../src/claims";
import { createFakeCollection, type FakeCollection } from "./fake-collection";

/**
 * A collection whose next read of `key` COMPLETES and then parks — once
 * `arm()` is called, so a test's own setup reads pass through untouched.
 *
 * The park is after the content is in hand, not before, because that is the
 * interleave being modelled: the read succeeded, and the projection then lost
 * the CPU before deciding what to do with what it read. Parking before the
 * read instead would hand it fresh content on resume and prove nothing.
 */
function gateRead(collection: FakeCollection, key: string) {
  let release!: () => void;
  const parked = new Promise<void>((r) => (release = r));
  let armed = false;
  let waiting = false;
  const gated = {
    ...collection,
    async getOptional(k: string) {
      const ref = await collection.getOptional(k as never);
      if (ref === undefined) return ref;
      return {
        path: (ref as { path: string }).path,
        get state() {
          return (ref as { state: unknown }).state;
        },
        async readContent() {
          const value = await (ref as { readContent(): Promise<string | null> }).readContent();
          if (armed && k === key) {
            armed = false;
            waiting = true;
            await parked;
          }
          return value;
        },
        patchState: (patch: unknown) =>
          (ref as { patchState(p: unknown): Promise<void> }).patchState(patch),
        writeContent: (c: string) =>
          (ref as { writeContent(c: string): Promise<void> }).writeContent(c),
      } as never;
    },
  } as unknown as FakeCollection;
  return {
    gated,
    arm: () => {
      armed = true;
    },
    /** True once a read has actually parked, so a test need not guess timing. */
    parked: () => waiting,
    release: () => release(),
  };
}

/** A collection whose first `writeContent` for `key` parks until released. */
function gateWrite(collection: FakeCollection, key: string) {
  let release!: () => void;
  const parked = new Promise<void>((r) => (release = r));
  let armed = false;
  const wrap = (ref: any, k: string) =>
    ref === undefined
      ? ref
      : {
          path: ref.path,
          get state() {
            return ref.state;
          },
          readContent: () => ref.readContent(),
          patchState: (p: unknown) => ref.patchState(p),
          async writeContent(c: string) {
            if (armed && k === key) {
              armed = false;
              await parked;
            }
            return ref.writeContent(c);
          },
        };
  const gated = {
    ...collection,
    async getOptional(k: string) {
      return wrap(await collection.getOptional(k as never), k);
    },
    async getOrCreate(k: string, s: unknown) {
      return wrap(await collection.getOrCreate(k as never, s as never), k);
    },
  } as unknown as FakeCollection;
  return {
    gated,
    arm: () => {
      armed = true;
    },
    release: () => release(),
  };
}

/** Spin the microtask queue until `check` holds, or give up after `tries`. */
async function until(check: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !check(); i += 1) await Promise.resolve();
}

describe("two flushes interleaving", () => {
  it("does not let a stale collection read overwrite a commit that landed during it", async () => {
    // The window is between reading the collection and writing to it. If the
    // claim is taken AFTER the read, the other projection can complete its
    // entire commit and release inside that window — and this one then writes
    // from a snapshot that predates it, having been granted a claim that
    // proves nothing.
    const claims = createClaimRegistry();
    const collection = createFakeCollection("artifacts/**", { "shared.md": "original" });
    const { gated, arm, parked, release } = gateRead(collection, "shared.md");

    const mount = (c: FakeCollection) => [{ prefix: "artifacts", collection: c, writable: true }];
    const slowPlace = createMemoryPlace();
    const fastPlace = createMemoryPlace();
    const slowRun = createProjection({ place: slowPlace, mounts: mount(gated), claims });
    const fastRun = createProjection({ place: fastPlace, mounts: mount(collection), claims });

    // Both start from the same collection state, so both hold the same base —
    // which is what makes each of them believe its own write is safe.
    await slowRun.hydrate();
    await fastRun.hydrate();
    // Edited AFTER hydrate: hydrate lays the collection down into the place,
    // so a place seeded beforehand is overwritten and both flushes no-op.
    await slowPlace.write("artifacts/shared.md", "slow edit");
    await fastPlace.write("artifacts/shared.md", "fast edit");

    arm();
    const slowFlush = slowRun.flush();
    await until(parked);
    const fastReport = await fastRun.flush();
    release();
    const slowReport = await slowFlush;

    const kinds = [...slowReport.outcomes, ...fastReport.outcomes].map((o) => o.kind);
    // THE discriminating assertion. Two writers, one file, overlapping in
    // time: exactly one may write. Both writing means the first one's work is
    // gone and it was told the write succeeded.
    expect(kinds.filter((k) => k === "written")).toHaveLength(1);
    expect(kinds).toContain("contested");
  });

  it("keeps a flush's claims when a put finishes underneath it", async () => {
    // `put` and `flush` are two operations on ONE projection, and a projection
    // has one identity. Releasing "everything this projection holds" at the
    // end of the shorter one drops the claims the longer one is still relying
    // on, and another run can take those paths mid-commit.
    const claims = createClaimRegistry();
    const collection = createFakeCollection("artifacts/**", { "held.md": "original" });
    const { gated, arm, release } = gateWrite(collection, "held.md");
    const place = createMemoryPlace();
    const projection = createProjection({
      place,
      mounts: [{ prefix: "artifacts", collection: gated, writable: true }],
      claims,
    });
    await projection.hydrate();
    // After hydrate, for the same reason as above.
    await place.write("artifacts/held.md", "edited");

    arm();
    const flushing = projection.flush(); // claims held.md, parks in its write
    await until(() => claims.heldBy("artifacts/held.md") !== undefined);
    expect(claims.heldBy("artifacts/held.md")).toBeDefined();

    await projection.put("artifacts/other.md", "unrelated");

    // THE discriminating assertion: the in-flight flush still holds its path.
    expect(claims.heldBy("artifacts/held.md")).toBeDefined();

    release();
    await flushing;
    expect(claims.heldBy("artifacts/held.md")).toBeUndefined();
  });
});
