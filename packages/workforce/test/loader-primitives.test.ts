/**
 * Specs for the walk primitives the `./loader` subpath publishes.
 *
 * The readers have their own suites; these are the guarantees a *consumer* of
 * the primitives gets, which the readers cannot prove on their own — that the
 * shared ignore list cannot be changed out from under every reader in the
 * process, that the root refusal holds for every spelling of a root rather than
 * only the one the readers' fixtures happen to use, and that a report the walk
 * cannot see the end of is not lost.
 *
 * Real temp trees and the real functions, like the reader suites: what a
 * symlink does is a filesystem behaviour, not something a mock can assert.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IGNORED_ENTRIES,
  classify,
  openRoot,
  openStructuralDirectory,
  walkTeams,
} from "../src/loader";

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temp directory, cleaned up after the test. */
function base(): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-loader-primitives-"));
  roots.push(dir);
  return dir;
}

/** A temp root holding `real/teams/engineering/`, with `linked` pointing at `real`. */
function linkedRoot(): { real: string; linked: string } {
  const dir = base();
  const real = join(dir, "real");
  mkdirSync(join(real, "teams", "engineering"), { recursive: true });
  const linked = join(dir, "linked");
  symlinkSync(real, linked);
  return { real, linked };
}

describe("IGNORED_ENTRIES", () => {
  it("cannot be mutated, so a consumer cannot make every reader skip a real team", async () => {
    // The published value is consulted by `walkTeams` and by all four readers'
    // leaf loops. Handing out the readers' own backing set would let any
    // consumer run `IGNORED_ENTRIES.add("engineering")` once and silently erase
    // that team from every later read in the process — nothing thrown, nothing
    // reported. A `ReadonlySet` annotation alone does not stop it: types erase.
    const mutable = IGNORED_ENTRIES as unknown as Set<string>;

    expect(() => mutable.add("engineering")).toThrow();
    expect(() => mutable.delete(".DS_Store")).toThrow();
    expect(() => mutable.clear()).toThrow();

    // And the walk still sees the list it was built with.
    const { real } = linkedRoot();
    const walked: string[] = [];
    for await (const team of walkTeams(real, () => {})) walked.push(team.id);

    expect(walked).toEqual(["engineering"]);
    expect(IGNORED_ENTRIES.has("engineering")).toBe(false);
  });

  it("still answers as a read-only set", () => {
    expect(IGNORED_ENTRIES.has(".DS_Store")).toBe(true);
    expect(IGNORED_ENTRIES.has("Thumbs.db")).toBe(true);
    expect(IGNORED_ENTRIES.has("WORKER.md")).toBe(false);
    expect(IGNORED_ENTRIES.size).toBe(2);
    expect([...IGNORED_ENTRIES].sort()).toEqual([".DS_Store", "Thumbs.db"]);
  });
});

describe("openRoot", () => {
  it("refuses a symlinked root however the caller spelled the path", async () => {
    // `lstat` resolves the final symlink when the path ends in a separator, so
    // `<root>/` reports `directory` where `<root>` reports `symlink`. The
    // trailing form is the more common spelling — it falls out of config, env
    // vars and hand-written paths — and without normalizing first, the
    // no-follow guarantee this subpath publishes is one character from bypassed.
    const { real, linked } = linkedRoot();

    // Control: the tree behind the link opens, so the refusals below are the link.
    await expect(openRoot(real)).resolves.toBeUndefined();

    const spellings = [
      linked,
      `${linked}${sep}`,
      `${linked}${sep}${sep}`,
      `${linked}${sep}.${sep}`,
    ];
    for (const spelling of spellings) {
      await expect(openRoot(spelling)).rejects.toThrow(
        /^Symlinked workforce directory ".+" — refused for safety$/,
      );
    }
  });

  it("still opens an ordinary root spelled with a trailing separator", async () => {
    const { real } = linkedRoot();

    await expect(openRoot(`${real}${sep}`)).resolves.toBeUndefined();
  });

  it("still throws the unreadable wording for a root that is not there", async () => {
    await expect(openRoot(join(tmpdir(), "fsd-loader-primitives-absent-4b71"))).rejects.toThrow(
      /^Failed to read workforce directory "/,
    );
  });

  it("does not take a file for a root", async () => {
    const file = join(base(), "workforce.txt");
    writeFileSync(file, "not a tree\n");

    await expect(openRoot(file)).rejects.toThrow(/^Failed to read workforce directory "/);
  });
});

describe("walkTeams reporting", () => {
  it("surfaces a rejecting report to the caller rather than losing it", async () => {
    // The callback is published for the next convention's author, and TypeScript
    // lets an `async` function be passed wherever a `void`-returning one is
    // expected. Unawaited, a reporter that rejects becomes an unhandled
    // rejection the caller never sees, and one that does I/O is still running
    // after the walk has returned.
    const root = base();
    mkdirSync(join(root, "teams"), { recursive: true });
    mkdirSync(join(root, "outside"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "teams", "borrowed"));

    await expect(async () => {
      for await (const _team of walkTeams(root, async () => {
        await Promise.resolve();
        throw new Error("reporter failed");
      })) {
        // The refused team is the only entry; nothing is expected to yield.
      }
    }).rejects.toThrow(/reporter failed/);
  });
});

describe("classify and openStructuralDirectory", () => {
  it("refuse a symlink however the caller spelled the path", async () => {
    // The same bypass `openRoot` was fixed for, reachable through the two
    // primitives this subpath publishes for the next convention's author:
    // `lstat` resolves the *final* symlink when a path ends in a separator, so
    // `<link>/` reports the directory behind the link. These two are the
    // surface the README promises operates without following symlinks, and the
    // trailing form is the ordinary way a directory gets written down, so the
    // promise has to hold for it as much as for the bare spelling.
    const { real, linked } = linkedRoot();

    const spellings = [linked, `${linked}${sep}`, `${linked}${sep}${sep}`, `${linked}${sep}.${sep}`];
    for (const spelling of spellings) {
      expect(await classify(spelling)).toEqual({ kind: "symlink" });

      const opened = await openStructuralDirectory(spelling, "teams");
      expect(opened.entries).toBeUndefined();
      expect(opened.refusal?.reason).toBe("symlink");
    }

    // Controls: the tree behind the link is ordinary at either spelling, so the
    // refusals above are the link and not the trailing separator.
    expect(await classify(real)).toEqual({ kind: "directory" });
    expect(await classify(`${real}${sep}`)).toEqual({ kind: "directory" });
    expect((await openStructuralDirectory(`${real}${sep}`, "teams")).entries).toEqual(["teams"]);
  });
});
