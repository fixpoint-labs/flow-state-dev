/**
 * The host place, against real files.
 *
 * Every test here pins a property the projection depends on rather than a
 * property of `fs`: what a broken listing does, what an escaping path does,
 * and that content survives the round trip unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  it("throws when the root is gone rather than reading it as empty", async () => {
    // The failure the projection cannot survive: a walk that reports emptiness
    // for a workspace it could not read, which the delete pass acts on.
    const root = scratch();
    const place = createHostPlace(root);
    await place.write("artifacts/one.md", "first");
    discard(root);

    await expect(place.list(["artifacts"])).rejects.toThrow();
  });

  it("reads a genuinely empty mount as empty", async () => {
    // The other half: a prefix that was never created is a collection with
    // nothing in it, and must not fail the walk.
    const root = scratch();
    const place = createHostPlace(root);
    expect(await place.list(["never-hydrated"])).toEqual([]);
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
      mounts: [{ prefix: "artifacts", collectionId: "artifacts", collection, writable: true }],
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
      mounts: [{ prefix: "artifacts", collectionId: "artifacts", collection, writable: true }],
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

describe("createHostPlace symlink containment", () => {
  it("refuses to write through a symlinked file planted in the place", async () => {
    // The containment check is lexical — it resolves `..` and rejects what
    // lands outside. A symlink is not a `..`: the path stays inside the root
    // and the kernel walks out of it anyway. An agent that can write in its
    // own workspace can plant one, and the next hydrate follows it.
    const root = mkdtempSync(join(tmpdir(), "hp-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "hp-outside-"));
    const victim = join(outside, "victim.txt");
    writeFileSync(victim, "do not touch");

    mkdirSync(join(root, "artifacts"), { recursive: true });
    symlinkSync(victim, join(root, "artifacts", "notes.md"));

    const place = createHostPlace(root);
    await expect(place.write("artifacts/notes.md", "clobbered")).rejects.toThrow();
    expect(readFileSync(victim, "utf-8")).toBe("do not touch");

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses to write through a symlinked directory planted in the place", async () => {
    // The parent, not the leaf. `mkdir -p` on a path whose parent is a link
    // succeeds silently, and the write lands wherever the link points.
    const root = mkdtempSync(join(tmpdir(), "hp-symlink-dir-"));
    const outside = mkdtempSync(join(tmpdir(), "hp-outside-dir-"));

    symlinkSync(outside, join(root, "artifacts"));

    const place = createHostPlace(root);
    await expect(place.write("artifacts/planted.md", "escaped")).rejects.toThrow();
    expect(existsSync(join(outside, "planted.md"))).toBe(false);

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses to read through a symlink planted in the place", async () => {
    // The other direction: a link is a way to pull a host file the run was
    // never given into a collection that is then durable and readable.
    const root = mkdtempSync(join(tmpdir(), "hp-symlink-read-"));
    const outside = mkdtempSync(join(tmpdir(), "hp-outside-read-"));
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "host secret");

    mkdirSync(join(root, "artifacts"), { recursive: true });
    symlinkSync(secret, join(root, "artifacts", "leak.md"));

    const place = createHostPlace(root);
    await expect(place.read("artifacts/leak.md")).rejects.toThrow();

    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses a symlink that points back inside the place", async () => {
    // Not an escape — and still refused. `walk` does not list a symlink, so
    // writing through one would put content in the place under a name the
    // place will never report, and reading through one would hand the same
    // file back under two paths. The projection keys its baseline by path;
    // one file wearing two of them is how a flush decides a run created
    // something it did not.
    const root = mkdtempSync(join(tmpdir(), "hp-symlink-inside-"));
    mkdirSync(join(root, "artifacts"), { recursive: true });
    writeFileSync(join(root, "artifacts", "real.md"), "real content");
    symlinkSync(join(root, "artifacts", "real.md"), join(root, "artifacts", "alias.md"));

    const place = createHostPlace(root);
    await expect(place.read("artifacts/alias.md")).rejects.toThrow();
    await expect(place.write("artifacts/alias.md", "via the alias")).rejects.toThrow();
    // The target is untouched, and the listing never mentioned the alias.
    expect(readFileSync(join(root, "artifacts", "real.md"), "utf-8")).toBe("real content");
    expect(await place.list(["artifacts"])).toEqual(["artifacts/real.md"]);

    rmSync(root, { recursive: true, force: true });
  });

  it("lists a file once when nested prefixes both cover it", async () => {
    // Nested mounts are supported — `routePath` resolves them by longest
    // prefix. The walk runs per prefix, so the outer one reaches
    // `artifacts/drafts/x.md` and the inner one reaches it again. A flush
    // then decides one physical file twice and reports `written` followed by
    // `unchanged` for the same path, which is not a report anyone can read.
    // `createMemoryPlace` filters one key set and never doubled.
    const root = mkdtempSync(join(tmpdir(), "hp-nested-"));
    mkdirSync(join(root, "artifacts", "drafts"), { recursive: true });
    writeFileSync(join(root, "artifacts", "drafts", "x.md"), "nested");
    writeFileSync(join(root, "artifacts", "top.md"), "outer");

    const place = createHostPlace(root);
    const listed = await place.list(["artifacts", "artifacts/drafts"]);

    expect([...listed].sort()).toEqual(["artifacts/drafts/x.md", "artifacts/top.md"]);

    rmSync(root, { recursive: true, force: true });
  });
});
