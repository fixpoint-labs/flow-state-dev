/**
 * The local workspace host, for a run with no repository.
 *
 * The kept files are the whole record here — there is no git to check into —
 * so the properties are about that record: the first run starts from nothing,
 * what a run writes is in the collection after a save, the next run starts
 * from it, a lost place comes back from it, and one owner's runs never see
 * another's.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localWorkspaceHost } from "../src/local-host";
import type { FilesRunSource } from "../src/run-source";
import { createFakeCollection, type FakeCollection } from "./fake-collection";
import { tempDir } from "./git-fixtures";

let root: string;
let collection: FakeCollection;

beforeEach(() => {
  root = tempDir("files");
  collection = createFakeCollection("project-files/**");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const host = () =>
  localWorkspaceHost({
    root,
    remotes: { allow: [] },
    source: () => ({ kind: "refused", reason: "unused", message: "unused" }),
  });

const files = (projectId: string): FilesRunSource => ({
  kind: "files",
  projectId,
  files: { collection, collectionId: "project-files" },
});

describe("a run with no repository works in workspace/", () => {
  it("starts the first run from an empty directory", async () => {
    const place = await host().provision(files("sandbox"), { place: ["run-1"] });

    expect(place.kind).toBe("files");
    expect(place.cwd).toBe(join(root, "run-1", "workspace"));
    expect(place.filesDir).toBe(place.cwd);
    expect(readdirSync(place.cwd)).toEqual([]);
    expect(place.repo).toBeUndefined();
  });

  it("saves what the run wrote into the collection, under the run's key prefix", async () => {
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });

    writeFileSync(join(place.cwd, "index.html"), "<h1>hi</h1>");
    const report = await h.save(place);

    expect(report.outcomes).toContainEqual({ kind: "created", path: "workspace/index.html" });
    expect(collection.contents()).toEqual({ "sandbox/index.html": "<h1>hi</h1>" });
  });

  it("never saves a directory the caller asked to keep out", async () => {
    // The caller's own files (a question for a person, say) sit in the
    // working directory because that is where the worker can write, but
    // they are not the project's work.
    const h = host();
    const ignored = { dir: join(".fsdev", "ask"), rule: ".fsdev/ask/", why: "the caller's own files" };
    const place = await h.provision(files("sandbox"), { place: ["run-1"], ignored });

    writeFileSync(join(place.cwd, "index.html"), "<h1>hi</h1>");
    mkdirSync(join(place.cwd, ".fsdev", "ask"), { recursive: true });
    writeFileSync(join(place.cwd, ".fsdev", "ask", "1.md"), "Which option?");
    await h.save(place);

    expect(collection.contents()).toEqual({ "sandbox/index.html": "<h1>hi</h1>" });
  });

  it("starts the next run from what the last one saved, nested paths included", async () => {
    const h = host();
    const first = await h.provision(files("sandbox"), { place: ["run-1"] });
    mkdirSync(join(first.cwd, "src", "lib"), { recursive: true });
    writeFileSync(join(first.cwd, "src", "lib", "a.ts"), "export const a = 1;");
    await h.save(first);
    await h.release(first);

    const second = await h.provision(files("sandbox"), { place: ["run-2"] });

    expect(readFileSync(join(second.cwd, "src", "lib", "a.ts"), "utf8")).toBe("export const a = 1;");
  });

  it("propagates a delete the run made", async () => {
    collection.setExternal("sandbox/old.md", "stale");
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });

    rmSync(join(place.cwd, "old.md"));
    await h.save(place);

    expect(collection.contents()).toEqual({});
  });

  it("never shows one owner's files to another owner's run", async () => {
    collection.setExternal("sandbox/mine.md", "sandbox's");
    collection.setExternal("platform/theirs.md", "platform's");

    const place = await host().provision(files("platform"), { place: ["run-1"] });

    expect(readdirSync(place.cwd)).toEqual(["theirs.md"]);
    expect(collection.listCalls()).toEqual(["platform/"]);
  });

  it("hydrates a lost place again from the collection", async () => {
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });
    writeFileSync(join(place.cwd, "kept.md"), "kept");
    await h.save(place);

    rmSync(join(root, "run-1"), { recursive: true, force: true });
    const again = await h.provision(files("sandbox"), { place: ["run-1"] });

    expect(readFileSync(join(again.cwd, "kept.md"), "utf8")).toBe("kept");
  });

  it("hands the same live place back to a retry in this process, unsaved work intact", async () => {
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });
    writeFileSync(join(place.cwd, "draft.md"), "not saved yet");

    const retry = await h.provision(files("sandbox"), { place: ["run-1"] });

    expect(readFileSync(join(retry.cwd, "draft.md"), "utf8")).toBe("not saved yet");
    await h.save(retry);
    expect(collection.contents()).toEqual({ "sandbox/draft.md": "not saved yet" });
  });

  it("reports two runs editing one file as a conflict, never an overwrite", async () => {
    collection.setExternal("sandbox/shared.md", "v1");
    const h = host();
    const a = await h.provision(files("sandbox"), { place: ["run-a"] });
    const b = await h.provision(files("sandbox"), { place: ["run-b"] });

    writeFileSync(join(a.cwd, "shared.md"), "a's edit");
    writeFileSync(join(b.cwd, "shared.md"), "b's edit");
    await h.save(a);
    const report = await h.save(b);

    expect(report.conflicts.map((c) => c.path)).toEqual(["workspace/shared.md"]);
    expect(collection.contents()["sandbox/shared.md"]).toBe("a's edit");
  });
});

describe("slice-2 seams are declared and do nothing yet", () => {
  it("checkpoint and restore leave the place and the collection as they were", async () => {
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });
    writeFileSync(join(place.cwd, "a.md"), "a");

    await h.checkpoint(place);
    await h.restore(place);

    expect(collection.contents()).toEqual({});
    expect(readFileSync(join(place.cwd, "a.md"), "utf8")).toBe("a");
  });

  it("release keeps the directory", async () => {
    const h = host();
    const place = await h.provision(files("sandbox"), { place: ["run-1"] });

    await h.release(place);

    expect(existsSync(place.cwd)).toBe(true);
  });
});
