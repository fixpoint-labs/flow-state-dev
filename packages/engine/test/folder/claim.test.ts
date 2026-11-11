/**
 * The claim pass: every entry in a kit's folder is used or refused. A reader
 * claims what it consumed; whatever is left, past the names that never mean
 * anything, is reported by path, all of it at once.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKitFolder } from "../../src/folder";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder holding `files` (slash paths; a trailing slash is an empty directory). */
function folderWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-claim-"));
  dirs.push(dir);
  for (const file of files) {
    const target = join(dir, ...file.split("/").filter(Boolean));
    if (file.endsWith("/")) mkdirSync(target, { recursive: true });
    else {
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, "x");
    }
  }
  return dir;
}

describe("the claim pass", () => {
  it("refuses every entry no reader claimed, each by its path, all at once", async () => {
    const dir = folderWith(["greeting.txt", "notes.txt", "drafts/a.md", "teams/eng/team.md", "teams/stray.md"]);
    const opened = await openKitFolder(dir, 'folder of kit "b"');
    opened.folder.claim("greeting.txt");
    opened.folder.claim("teams/eng");

    const refused = await opened.unclaimed();
    // A fully unclaimed directory is named once, not file by file; a partly
    // claimed one is walked, so its stray file is named on its own.
    expect(refused.map((report) => report.path).sort()).toEqual(["drafts", "notes.txt", "teams/stray.md"]);
    expect(refused.every((report) => report.kind === "unclaimed")).toBe(true);
    expect(refused.find((report) => report.path === "notes.txt")?.error.message).toMatch(/notes\.txt/);
  });

  it("passes only the names that never mean anything", async () => {
    const dir = folderWith(["used.txt", ".DS_Store", "sub/Thumbs.db", "sub/used.md"]);
    const opened = await openKitFolder(dir, "folder");
    opened.folder.claim("used.txt");
    opened.folder.claim("sub/used.md");
    expect(await opened.unclaimed()).toEqual([]);
  });

  it("claims a directory with everything under it, however the path is spelled", async () => {
    const dir = folderWith(["teams/eng/team.md", "teams/ops/team.md"]);
    const opened = await openKitFolder(dir, "folder");
    opened.folder.claim("./teams/");
    expect(await opened.unclaimed()).toEqual([]);
  });

  it("refuses a claim that leaves the folder", async () => {
    const dir = folderWith(["a.txt"]);
    const opened = await openKitFolder(dir, "folder");
    expect(() => opened.folder.claim("../elsewhere")).toThrow(/outside the folder/);
    expect(() => opened.folder.claim(join(dir, "a.txt"))).toThrow(/relative/);
  });

  it("reports a symlink it would have to walk through, without following it", async () => {
    const dir = folderWith(["real/inner.txt"]);
    const outside = folderWith(["secret.txt"]);
    symlinkSync(outside, join(dir, "linked"));
    const opened = await openKitFolder(dir, "folder");
    opened.folder.claim("real");
    opened.folder.claim("linked/secret.txt");
    const refused = await opened.unclaimed();
    expect(refused.map((report) => [report.path, report.kind])).toEqual([["linked", "symlink"]]);
  });

  it("opens the folder through openRoot, so a missing folder is a refusal naming it", async () => {
    await expect(openKitFolder(join(tmpdir(), "fsd-claim-absent-91c2"), 'folder of kit "b"')).rejects.toThrow(
      /^Failed to read folder of kit "b"/,
    );
  });
});
