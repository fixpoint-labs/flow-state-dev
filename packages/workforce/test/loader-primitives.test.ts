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
import { walkTeams } from "../src/loader";

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

