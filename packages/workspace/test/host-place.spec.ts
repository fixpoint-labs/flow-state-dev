/**
 * The host place, against real files.
 *
 * Every test here pins a property the projection depends on rather than a
 * property of `fs`: what a broken listing does, what an escaping path does,
 * and that content survives the round trip unchanged.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostPlace } from "../src/host-place";
import { createProjection } from "../src/projection";
import { createFakeCollection } from "./fake-collection";

const scratch = () => mkdtempSync(join(tmpdir(), "fsd-workspace-"));
const discard = (root: string) => rmSync(root, { recursive: true, force: true });

describe("a place backed by a directory", () => {
  it("round-trips content and lists only what is under a prefix", async () => {
    const root = scratch();
    const place = createHostPlace(root);

    await place.write("artifacts/notes/one.md", "first");
    await place.write("elsewhere/two.md", "second");

    expect(await place.read("artifacts/notes/one.md")).toBe("first");
    expect(await place.list(["artifacts"])).toEqual(["artifacts/notes/one.md"]);

    discard(root);
  });

  it("reports a missing file as absent, not as a failure", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    expect(await place.read("artifacts/nope.md")).toBeNull();
    discard(root);
  });

  it("lists a prefix that was never created as empty — a mount may hydrate nothing", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    expect(await place.list(["artifacts"])).toEqual([]);
    discard(root);
  });

  it("throws when the root itself is gone, so a flush never reads it as emptiness", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    await place.write("artifacts/one.md", "content");

    discard(root);

    await expect(place.list(["artifacts"])).rejects.toThrow();
  });

  it("leaves the collection intact when the place breaks under it", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    const collection = createFakeCollection("artifacts", { "one.md": "content" });
    const projection = createProjection({
      mounts: [{ prefix: "artifacts", collection, writable: true }],
      place,
    });

    await projection.hydrate();
    expect(await place.read("artifacts/one.md")).toBe("content");

    discard(root);

    await expect(projection.flush()).rejects.toThrow();
    expect(collection.contents()).toEqual({ "one.md": "content" });
  });

  it("refuses a path that would land outside the root", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    await expect(place.write("../escaped.md", "x")).rejects.toThrow(/escapes/);
    await expect(place.read("artifacts/../../escaped.md")).rejects.toThrow(/escapes/);
    discard(root);
  });

  it("neither lists nor follows a symlink planted inside it", async () => {
    const root = scratch();
    const outside = scratch();
    writeFileSync(join(outside, "secret.md"), "secret");
    const place = createHostPlace(root);
    mkdirSync(join(root, "artifacts"), { recursive: true });
    // Both shapes, because they fail differently: a link to a file would be
    // listed as a path the place cannot honestly claim, and a link to a
    // directory would walk straight out of the root.
    symlinkSync(join(outside, "secret.md"), join(root, "artifacts", "link.md"));
    symlinkSync(outside, join(root, "artifacts", "dirlink"));

    expect(await place.list(["artifacts"])).toEqual([]);

    discard(root);
    discard(outside);
  });

  it("carries a run's edits, additions and deletions back through a real directory", async () => {
    const root = scratch();
    const place = createHostPlace(root);
    const collection = createFakeCollection("artifacts", {
      "keep.md": "kept",
      "gone.md": "doomed",
    });
    const projection = createProjection({
      mounts: [{ prefix: "artifacts", collection, writable: true }],
      place,
    });

    await projection.hydrate();
    await place.write("artifacts/keep.md", "edited");
    await place.write("artifacts/new.md", "added");
    rmSync(join(root, "artifacts", "gone.md"));

    const report = await projection.flush();

    expect(collection.contents()).toEqual({
      "keep.md": "edited",
      "new.md": "added",
    });
    expect(report.conflicts).toEqual([]);

    discard(root);
  });
});
