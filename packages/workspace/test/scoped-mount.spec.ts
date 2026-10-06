/**
 * A mount scoped to one key prefix of its collection.
 *
 * One collection holds every owner's files under `<owner>/…`, and a run must
 * only ever see and write its own owner's keys. So the scope is applied where
 * the rows are read, not after: a run that listed the whole collection and
 * dropped the rest has still read everybody's files.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlace } from "../src/memory-place";
import { createProjection } from "../src/projection";
import type { Mount } from "../src/types";
import { createFakeCollection } from "./fake-collection";

/** One collection, two owners' keys, a place mounted on `a` only. */
function setup() {
  const collection = createFakeCollection("files/**", {
    "a/notes.md": "a's notes",
    "a/src/index.ts": "a's code",
    "b/notes.md": "b's notes",
    // Shares `a` as a STRING prefix but is another owner's key.
    "ab/secret.md": "ab's secret",
  });
  const place = createMemoryPlace();
  const mounts: Mount[] = [
    { prefix: "workspace", scope: "a", collection, collectionId: "files", writable: true },
  ];
  const projection = createProjection({ mounts, place });
  return { collection, place, projection };
}

describe("a scoped mount sees only its own keys", () => {
  it("lists at the source with the scope, bounded by a separator", async () => {
    const { collection, projection } = setup();

    await projection.hydrate();

    expect(collection.listCalls()).toEqual(["a/"]);
  });

  it("hydrates its keys with the scope stripped, and never reads another's", async () => {
    const { collection, place, projection } = setup();

    await projection.hydrate();

    expect(place.snapshot()).toEqual({
      "workspace/notes.md": "a's notes",
      "workspace/src/index.ts": "a's code",
    });
    expect(collection.contentReads().every((key) => key.startsWith("a/"))).toBe(true);
  });

  it("flushes a new file under the scope, not at the collection's root", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();

    await place.write("workspace/new.md", "fresh");
    const report = await projection.flush();

    expect(report.outcomes).toContainEqual({ kind: "created", path: "workspace/new.md" });
    expect(collection.contents()["a/new.md"]).toBe("fresh");
    expect(collection.contents()["new.md"]).toBeUndefined();
    expect(collection.contents()["b/notes.md"]).toBe("b's notes");
    expect(collection.contents()["ab/secret.md"]).toBe("ab's secret");
  });

  it("writes an edit back to the scoped key", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();

    await place.write("workspace/notes.md", "edited");
    await projection.flush();

    expect(collection.contents()["a/notes.md"]).toBe("edited");
  });

  it("a put lands under the scope too", async () => {
    const { collection, projection } = setup();
    await projection.hydrate();

    const outcome = await projection.put("workspace/put.md", "one file");

    expect(outcome).toEqual({ kind: "created", path: "workspace/put.md" });
    expect(collection.contents()["a/put.md"]).toBe("one file");
  });
});

describe("a scoped run deletes only what it hydrated", () => {
  it("removing a hydrated file deletes its scoped key and nothing else", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();

    place.remove("workspace/notes.md");
    const report = await projection.flush();

    expect(report.outcomes).toContainEqual({ kind: "deleted", path: "workspace/notes.md" });
    expect(Object.keys(collection.contents()).sort()).toEqual([
      "a/src/index.ts",
      "ab/secret.md",
      "b/notes.md",
    ]);
  });

  it("an empty place deletes the scope's files, never another owner's", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();

    place.remove("workspace/notes.md");
    place.remove("workspace/src/index.ts");
    await projection.flush();

    expect(Object.keys(collection.contents()).sort()).toEqual(["ab/secret.md", "b/notes.md"]);
  });
});

describe("a scope is a key prefix, not a path", () => {
  for (const scope of ["", "/a", "a/", "../a", "a/../b", "a//b", "./a"]) {
    it(`refuses ${JSON.stringify(scope)}`, () => {
      const collection = createFakeCollection("files/**");
      expect(() =>
        createProjection({
          place: createMemoryPlace(),
          mounts: [{ prefix: "workspace", scope, collection, collectionId: "files", writable: true }],
        }),
      ).toThrow(/scope/);
    });
  }

  it("accepts a nested scope", async () => {
    const collection = createFakeCollection("files/**", { "org/a/x.md": "x", "org/b/y.md": "y" });
    const place = createMemoryPlace();
    const projection = createProjection({
      place,
      mounts: [{ prefix: "w", scope: "org/a", collection, collectionId: "files", writable: true }],
    });

    await projection.hydrate();

    expect(place.snapshot()).toEqual({ "w/x.md": "x" });
  });
});

describe("an unscoped mount is unchanged", () => {
  it("lists the whole collection", async () => {
    const collection = createFakeCollection("files/**", { "a/x.md": "x" });
    const place = createMemoryPlace();
    const projection = createProjection({
      place,
      mounts: [{ prefix: "files", collection, collectionId: "files", writable: true }],
    });

    await projection.hydrate();

    expect(collection.listCalls()).toEqual([undefined]);
    expect(place.snapshot()).toEqual({ "files/a/x.md": "x" });
  });
});
