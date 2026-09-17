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

/**
 * Ways of writing one path that all name the same entry, so every primitive
 * must answer for them identically.
 *
 * Only trailing separators, because those are the only part of a spelling that
 * provably cannot change which entry is denoted — which is exactly why the
 * refusal normalizes them and nothing else. `<path>/./` is **not** here: see
 * "a trailing `.` segment is a known gap" below.
 */
const sameEntrySpellings = (target: string): string[] => [
  target,
  `${target}${sep}`,
  `${target}${sep}${sep}`,
];

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

    for (const spelling of sameEntrySpellings(linked)) {
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
    // Same bypass `openRoot` was fixed for, reachable through the primitives
    // this subpath publishes. See `classify`'s JSDoc for the filesystem
    // semantics; this test is about spellings and expectations.
    const { real, linked } = linkedRoot();

    for (const spelling of sameEntrySpellings(linked)) {
      expect(await classify(spelling)).toEqual({ kind: "symlink" });

      // `reportAs` is only the label a refusal is filed under, so "root" is
      // what these paths actually are — the structural helper is being used
      // here as a stand-in for any path classified the same way.
      const opened = await openStructuralDirectory(spelling, "root");
      expect(opened.entries).toBeUndefined();
      expect(opened.refusal?.reason).toBe("symlink");
    }

    // Controls: the tree behind the link is ordinary at either spelling, so the
    // refusals above are the link and not the trailing separator.
    expect(await classify(real)).toEqual({ kind: "directory" });
    expect(await classify(`${real}${sep}`)).toEqual({ kind: "directory" });
    expect((await openStructuralDirectory(`${real}${sep}`, "root")).entries).toEqual(["teams"]);
  });

  it("classify the entry that openStructuralDirectory will open, even across `..`", async () => {
    // The normalization must not reshape *segments*. `path.resolve` and
    // `path.normalize` collapse `..` lexically; the kernel applies it after
    // traversing a symlinked component, so the two disagree precisely when a
    // link is involved. Classifying the collapsed form answers about one entry
    // while `readdir` opens another — and the gap fails *open*: the caller is
    // told the path is an ordinary directory and then lists the linked tree.
    //
    // `a` -> sub/b, so the kernel's `..` from `a` lands in `sub`, not in `dir`.
    const dir = base();
    mkdirSync(join(dir, "outside", "teams"), { recursive: true });
    mkdirSync(join(dir, "sub", "b"), { recursive: true });
    symlinkSync(join("sub", "b"), join(dir, "a"));
    symlinkSync(join("..", "outside"), join(dir, "sub", "c"));
    // Where a lexical collapse of `a/../c` would land: an ordinary directory.
    mkdirSync(join(dir, "c", "decoy"), { recursive: true });

    // Built as a raw string on purpose — `path.join` would collapse `..` before
    // the path ever reached the filesystem, hiding the whole question.
    const spelled = `${dir}${sep}a${sep}..${sep}c`;

    expect(await classify(spelled)).toEqual({ kind: "symlink" });

    const opened = await openStructuralDirectory(spelled, "teams");
    expect(opened.refusal?.reason).toBe("symlink");
    // The point of the test: without this, `entries` came back as the outside
    // tree's `["teams"]` — read through the link, past the no-follow contract.
    expect(opened.entries).toBeUndefined();
  });

  it("does not refuse a trailing `.` segment — a known gap, not a guarantee", async () => {
    // `<link>/.` still reaches the directory behind the link, because `.` is a
    // segment and the normalization deliberately touches none. Covering it
    // would mean reshaping segments, which is what made the `..` case above
    // fail open, so the narrow rule is kept and the gap is pinned here instead
    // of being silently absent.
    //
    // Failing open on this spelling and on a symlinked ancestor are the same
    // open question, and it is a product decision rather than a review one.
    const { linked } = linkedRoot();

    expect(await classify(`${linked}${sep}.${sep}`)).toEqual({ kind: "directory" });
  });
});
