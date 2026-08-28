/**
 * The projection's behaviour, against an in-memory place.
 *
 * Every case below is reachable with no sandbox, no harness and no model,
 * which is the property that makes the seam worth having: the concurrency bug
 * this component exists to fix is a pure-data question once the place is
 * swappable.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlace } from "../src/memory-place";
import { createProjection, hashContent } from "../src/projection";
import type { Mount } from "../src/types";
import { createFakeCollection, type FakeCollection } from "./fake-collection";

/** One writable mount at `artifacts`, seeded with whatever the case needs. */
function setup(seed: Record<string, string> = {}) {
  const collection = createFakeCollection("artifacts/**", seed);
  const place = createMemoryPlace();
  const mounts: Mount[] = [{ prefix: "artifacts", collection, writable: true }];
  const projection = createProjection({ mounts, place });
  return { collection, place, projection };
}

const kinds = (report: { outcomes: readonly { kind: string; path: string }[] }) =>
  report.outcomes.map((o) => `${o.kind}:${o.path}`);

describe("hydrate lays the collection down and remembers what it laid", () => {
  it("writes every entry under the mount prefix", async () => {
    const { place, projection } = setup({ "spec.md": "one", "src/a.ts": "two" });

    await projection.hydrate();

    expect(place.snapshot()).toEqual({
      "artifacts/spec.md": "one",
      "artifacts/src/a.ts": "two",
    });
  });

  it("owns exactly what it laid down", async () => {
    const { projection } = setup({ "spec.md": "one" });
    await projection.hydrate();
    expect(projection.ownedPaths()).toEqual(["artifacts/spec.md"]);
  });

  it("never hydrates a collection's own metadata", async () => {
    // Leading-underscore keys are the collection's bookkeeping. Hydrating them
    // would put them in front of the agent; worse, a later flush would read
    // their absence from the place as a delete.
    const { place, projection } = setup({ "_index": "bookkeeping", "spec.md": "one" });

    await projection.hydrate();

    expect(place.snapshot()).toEqual({ "artifacts/spec.md": "one" });
  });
});

describe("each flush outcome, on its own", () => {
  it("unchanged: the run never touched the file", async () => {
    const { projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    const report = await projection.flush();

    expect(kinds(report)).toEqual(["unchanged:artifacts/spec.md"]);
  });

  it("created: no baseline, nothing in the collection", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();
    await place.write("artifacts/new.md", "fresh");

    const report = await projection.flush();

    expect(kinds(report)).toEqual(["created:artifacts/new.md"]);
    expect(collection.contents()).toEqual({ "new.md": "fresh" });
  });

  it("written: the collection still holds what we last put there", async () => {
    const { collection, place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();
    await place.write("artifacts/spec.md", "edited");

    const report = await projection.flush();

    expect(kinds(report)).toEqual(["written:artifacts/spec.md"]);
    expect(collection.contents()["spec.md"]).toBe("edited");
  });

  it("converged: the collection already holds what we would write", async () => {
    const { collection, place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();
    await place.write("artifacts/spec.md", "same");
    collection.setExternal("spec.md", "same");

    const report = await projection.flush();

    expect(kinds(report)).toEqual(["converged:artifacts/spec.md"]);
  });

  it("conflict: carries base, theirs and ours", async () => {
    // The three hashes are the whole point — a conflict that cannot say what
    // it is between is a refusal, not a report.
    const { collection, place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();
    await place.write("artifacts/spec.md", "ours");
    collection.setExternal("spec.md", "theirs");

    const report = await projection.flush();

    expect(report.conflicts).toEqual([
      {
        kind: "conflict",
        path: "artifacts/spec.md",
        base: hashContent("one"),
        theirs: hashContent("theirs"),
        ours: hashContent("ours"),
      },
    ]);
    // Uncontested work still lands; a conflict is an outcome, not an abort.
    expect(collection.contents()["spec.md"]).toBe("theirs");
  });
});

describe("the baseline advances, which is what keeps ordinary work quiet", () => {
  it("a second flush over a path the first wrote is clean", async () => {
    // The ordinary two-command shell edit. No concurrency anywhere, and a
    // projection that did not advance would report a conflict against its own
    // write.
    const { place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    await place.write("artifacts/spec.md", "second");
    expect(kinds(await projection.flush())).toEqual(["written:artifacts/spec.md"]);

    await place.write("artifacts/spec.md", "third");
    const report = await projection.flush();

    expect(report.conflicts).toEqual([]);
    expect(kinds(report)).toEqual(["written:artifacts/spec.md"]);
  });

  it("advances on the converged no-op too", async () => {
    // The branch that writes nothing still commits a fact: the collection
    // holds what we would have written. Leaving `base` behind here compares
    // the next edit against a version nobody holds.
    const { collection, place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    await place.write("artifacts/spec.md", "same");
    collection.setExternal("spec.md", "same");
    expect(kinds(await projection.flush())).toEqual(["converged:artifacts/spec.md"]);

    await place.write("artifacts/spec.md", "after");
    const report = await projection.flush();

    expect(report.conflicts).toEqual([]);
    expect(kinds(report)).toEqual(["written:artifacts/spec.md"]);
  });
});

describe("the delete pass walks what we own, not what we hydrated", () => {
  it("create, flush, delete, flush — the file leaves the collection", async () => {
    // Never hydrated, so a hydrate-time delete set would keep it forever with
    // nobody told. Two ordinary commands.
    const { collection, place, projection } = setup();
    await projection.hydrate();

    await place.write("artifacts/new.md", "fresh");
    await projection.flush();
    expect(collection.contents()).toEqual({ "new.md": "fresh" });

    place.remove("artifacts/new.md");
    const report = await projection.flush();

    expect(kinds(report)).toEqual(["deleted:artifacts/new.md"]);
    expect(collection.contents()).toEqual({});
  });

  it("a path we hold no baseline for is not ours to delete", async () => {
    // FIX-998's delete-by-absence, which is the whole bug: a second run's
    // file is absent from OUR place because we never hydrated it, not
    // because anybody deleted it.
    const { collection, projection } = setup();
    await projection.hydrate();
    collection.setExternal("theirs.md", "another run's work");

    const report = await projection.flush();

    expect(report.outcomes).toEqual([]);
    expect(collection.contents()).toEqual({ "theirs.md": "another run's work" });
  });

  it("a delete we cannot prove safe is a conflict, not a quiet no-op", async () => {
    // edit-vs-delete. Quiet would leave the collection holding a file the
    // workspace no longer has, forever, with nobody told.
    const { collection, place, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    place.remove("artifacts/spec.md");
    collection.setExternal("spec.md", "somebody edited it");

    const report = await projection.flush();

    expect(report.conflicts).toEqual([
      {
        kind: "conflict",
        path: "artifacts/spec.md",
        base: hashContent("one"),
        theirs: hashContent("somebody edited it"),
        ours: null,
      },
    ]);
    expect(collection.contents()["spec.md"]).toBe("somebody edited it");
  });
});

describe("two runs over one collection", () => {
  it("disjoint paths both land and neither is contested", async () => {
    // §10's first goal, at the projection layer. A check coarser than the
    // path rules this out rather than delivering it.
    const collection = createFakeCollection("artifacts/**", { "spec.md": "spec" });
    const mountsFor = (place: ReturnType<typeof createMemoryPlace>): Mount[] => [
      { prefix: "artifacts", collection, writable: true },
    ];
    const placeA = createMemoryPlace();
    const placeB = createMemoryPlace();
    const runA = createProjection({ mounts: mountsFor(placeA), place: placeA });
    const runB = createProjection({ mounts: mountsFor(placeB), place: placeB });

    await runA.hydrate();
    await runB.hydrate();

    await placeA.write("artifacts/new.md", "A created this");
    await placeB.write("artifacts/spec.md", "B edited this");

    const reportA = await runA.flush();
    const reportB = await runB.flush();

    expect(reportA.conflicts).toEqual([]);
    expect(reportB.conflicts).toEqual([]);
    expect(collection.contents()).toEqual({
      "spec.md": "B edited this",
      "new.md": "A created this",
    });
  });

  it("the same path is a reported conflict, not a lost update", async () => {
    const collection = createFakeCollection("artifacts/**", { "spec.md": "spec" });
    const placeA = createMemoryPlace();
    const placeB = createMemoryPlace();
    const mounts = (): Mount[] => [{ prefix: "artifacts", collection, writable: true }];
    const runA = createProjection({ mounts: mounts(), place: placeA });
    const runB = createProjection({ mounts: mounts(), place: placeB });

    await runA.hydrate();
    await runB.hydrate();
    await placeA.write("artifacts/spec.md", "A's version");
    await placeB.write("artifacts/spec.md", "B's version");

    await runA.flush();
    const reportB = await runB.flush();

    expect(reportB.conflicts.map((c) => c.path)).toEqual(["artifacts/spec.md"]);
    // A's write survives: B is told rather than silently winning by arriving second.
    expect(collection.contents()["spec.md"]).toBe("A's version");
  });
});

describe("the floor: a flush that decided nothing says so", () => {
  it("a genuine no-op reports no writes, no conflicts, no deletes", async () => {
    // Without this the conflict check could pass by reporting everything.
    const { projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    const report = await projection.flush();

    expect(report.conflicts).toEqual([]);
    expect(report.outcomes.filter((o) => o.kind !== "unchanged")).toEqual([]);
  });
});

describe("routing and the things a flush must not touch", () => {
  it("the longest matching prefix wins", async () => {
    const outer = createFakeCollection("artifacts/**");
    const inner = createFakeCollection("artifacts/drafts/**");
    const place = createMemoryPlace();
    const projection = createProjection({
      mounts: [
        { prefix: "artifacts", collection: outer, writable: true },
        { prefix: "artifacts/drafts", collection: inner, writable: true },
      ],
      place,
    });
    await projection.hydrate();
    await place.write("artifacts/drafts/d.md", "a draft");
    await place.write("artifacts/top.md", "not a draft");

    await projection.flush();

    expect(inner.contents()).toEqual({ "d.md": "a draft" });
    expect(outer.contents()).toEqual({ "top.md": "not a draft" });
  });

  it("a neighbouring prefix is not a match", async () => {
    // `artifacts-old/x` starts with `artifacts` and belongs to neither that
    // mount nor, silently, its collection.
    const { collection, place, projection } = setup();
    await projection.hydrate();
    await place.write("artifacts-old/x.md", "somebody else's tree");

    const report = await projection.flush();

    expect(report.outcomes).toEqual([]);
    expect(collection.contents()).toEqual({});
  });

  it("a write under no writable mount is reported, never guessed", async () => {
    const { collection, place, projection } = setup();
    await projection.hydrate();
    await place.write("artifacts/ok.md", "mine");
    // Listed because the place is asked for the mount's prefix, but owned by
    // no mount once routing runs.
    await place.write("artifacts", "a file where the mount root is");

    const report = await projection.flush();

    expect(collection.contents()).toEqual({ "ok.md": "mine" });
    // The mount root itself is an orphan, not an entry under the empty key —
    // which is what the first version of the router quietly produced, and
    // what asserting only on the collection's contents would have let stand.
    expect(kinds(report)).toEqual(
      expect.arrayContaining(["created:artifacts/ok.md", "orphan:artifacts"]),
    );
  });

  it("a read-only mount is hydrated and then left alone", async () => {
    const readonly = createFakeCollection("skills/**", { "how-to.md": "reference" });
    const place = createMemoryPlace();
    const projection = createProjection({
      mounts: [{ prefix: "skills", collection: readonly, writable: false }],
      place,
    });
    await projection.hydrate();
    expect(place.snapshot()).toEqual({ "skills/how-to.md": "reference" });

    await place.write("skills/how-to.md", "the run scribbled on it");
    const report = await projection.flush();

    expect(report.outcomes).toEqual([]);
    expect(readonly.contents()["how-to.md"]).toBe("reference");
  });
});

describe("an unreadable place aborts the flush", () => {
  it("throws, and deletes nothing", async () => {
    // The failure that made the old machinery destructive: a failed listing
    // read as "the run deleted everything".
    const { collection, projection, place } = setup({ "spec.md": "one" });
    await projection.hydrate();
    place.breakListing("find: permission denied");

    await expect(projection.flush()).rejects.toThrow(/permission denied/);
    expect(collection.contents()).toEqual({ "spec.md": "one" });
  });
});

describe("the second path (BP-035) — every outcome against a changed collection", () => {
  it("a second flush reaches each outcome, not just a first flush on a fresh one", async () => {
    const { collection, place, projection } = setup({
      "keep.md": "keep",
      "edit.md": "edit",
      "gone.md": "gone",
    });
    await projection.hydrate();

    // First flush: establish that the projection has committed real state.
    await place.write("artifacts/edit.md", "edited once");
    await place.write("artifacts/made.md", "created");
    expect((await projection.flush()).conflicts).toEqual([]);

    // Now change the collection underneath us and run everything again.
    collection.setExternal("contested.md", "not ours");
    await place.write("artifacts/edit.md", "edited twice");
    place.remove("artifacts/gone.md");
    await place.write("artifacts/made.md", "created, then changed");

    const report = await projection.flush();

    expect(report.conflicts).toEqual([]);
    expect(kinds(report)).toEqual(
      expect.arrayContaining([
        "unchanged:artifacts/keep.md",
        "written:artifacts/edit.md",
        "written:artifacts/made.md",
        "deleted:artifacts/gone.md",
      ]),
    );
    // The other writer's file is untouched throughout — we never owned it.
    expect(collection.contents()["contested.md"]).toBe("not ours");
  });
});

describe("put commits one named path without walking the place", () => {
  it("creates when neither side holds the path", async () => {
    const { collection, projection } = setup();

    const outcome = await projection.put("artifacts/new.md", "fresh");

    expect(outcome).toEqual({ kind: "created", path: "artifacts/new.md" });
    expect(collection.contents()["new.md"]).toBe("fresh");
  });

  it("writes over a path it hydrated, because the collection still holds what it left", async () => {
    const { collection, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();

    const outcome = await projection.put("artifacts/spec.md", "two");

    expect(outcome).toEqual({ kind: "written", path: "artifacts/spec.md" });
    expect(collection.contents()["spec.md"]).toBe("two");
  });

  it("refuses a path somebody else changed since we last committed it", async () => {
    const { collection, projection } = setup({ "spec.md": "one" });
    await projection.hydrate();
    collection.setExternal("spec.md", "theirs");

    const outcome = await projection.put("artifacts/spec.md", "ours");

    expect(outcome).toMatchObject({ kind: "conflict", path: "artifacts/spec.md" });
    // Neither writer wins by arriving second.
    expect(collection.contents()["spec.md"]).toBe("theirs");
  });

  it("takes ownership, so a later flush can delete what it put there", async () => {
    const { collection, place, projection } = setup();

    await projection.put("artifacts/new.md", "fresh");
    // The write went straight to the collection; mirror it into the place the
    // way the consumer's own write channel would, then remove it.
    await place.write("artifacts/new.md", "fresh");
    place.remove("artifacts/new.md");

    const report = await projection.flush();

    expect(kinds(report)).toEqual(["deleted:artifacts/new.md"]);
    expect(collection.contents()["new.md"]).toBeUndefined();
  });

  it("normalizes a model-supplied `./` path the same way a flush does", async () => {
    const { collection, projection } = setup();

    const outcome = await projection.put("./artifacts/new.md", "fresh");

    expect(outcome).toEqual({ kind: "created", path: "artifacts/new.md" });
    expect(collection.contents()["new.md"]).toBe("fresh");
  });

  it("reports a path under no writable mount as an orphan rather than filing it", async () => {
    const { collection, projection } = setup();

    const outcome = await projection.put("nowhere/loose.md", "content");

    expect(outcome).toEqual({ kind: "orphan", path: "nowhere/loose.md" });
    expect(collection.contents()).toEqual({});
  });

  it("has nothing to decide for a read-only mount", async () => {
    const reference = createFakeCollection("reference/**", { "doc.md": "read me" });
    const projection = createProjection({
      mounts: [{ prefix: "reference", collection: reference, writable: false }],
      place: createMemoryPlace(),
    });

    expect(await projection.put("reference/doc.md", "edited")).toBeUndefined();
    expect(reference.contents()["doc.md"]).toBe("read me");
  });

  it("has nothing to decide for a collection's own metadata", async () => {
    const { collection, projection } = setup();

    expect(await projection.put("artifacts/_meta.json", "{}")).toBeUndefined();
    expect(collection.contents()).toEqual({});
  });
});
