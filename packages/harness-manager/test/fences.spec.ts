/**
 * Every fence's refusal is read.
 *
 * `openRunRow` and `writeRunRow` return `"refused"` when this attempt no longer
 * holds the row. **A refusal that nobody reads is not a fence** — the worker
 * walks on into checkout preparation and paid agent execution for a row another
 * attempt now owns, and can take the tree ahead of its rightful holder, which
 * is obligation B's harm arriving through the mechanism built to prevent it.
 *
 * ## Why this is a source check
 *
 * The window it guards is between the board's claim write and the worker's
 * first statement, and the public surface has no hook there: every seam a test
 * can reach — `buildPrompt`, `isDone`, the stubbed agent — runs *after* the
 * opening fence. Staging it would mean racing the dispatch, and a flaky test
 * asserting an isolation property is worse than none.
 *
 * So the invariant is checked where it actually lives: the shape of the call.
 * TypeScript cannot express "this value must be inspected", and the defect this
 * lab exists to remove is precisely a verdict that was reported and never read
 * — so it is worth a check that keeps holding as the file changes, rather than
 * one review that was true once.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANAGER = readFileSync(join(__dirname, "..", "src", "manager.ts"), "utf8");

/** Every call to a fenced write, with the text leading up to it. */
function fenceCallSites(): string[] {
  const sites: string[] = [];
  const pattern = /(openRunRow|writeRunRow)\s*\(/g;
  for (let m = pattern.exec(MANAGER); m !== null; m = pattern.exec(MANAGER)) {
    // Skip the import list at the top of the file.
    const before = MANAGER.slice(Math.max(0, m.index - 420), m.index);
    if (/from "\.\/run-record"/.test(MANAGER.slice(m.index, m.index + 200))) continue;
    if (/import\s*\{[^}]*$/.test(before)) continue;
    sites.push(before);
  }
  return sites;
}

describe("every fence's refusal is read", () => {
  it("finds the call sites at all", () => {
    // Or the assertion below passes because it examined nothing — the exact
    // shape of check this whole lab exists to remove.
    expect(fenceCallSites().length).toBeGreaterThanOrEqual(4);
  });

  it("wraps every fenced write except the one documented discard", () => {
    const unwrapped = fenceCallSites().filter((before) => !/fenced\(\s*$/.test(before));

    // `recordFailure` is the single deliberate exception: it is already
    // unwinding and re-throws whatever happens, so a refusal there means only
    // that a superseded attempt recorded nothing — the correct outcome. It says
    // so in a comment directly above the call, and that comment is what this
    // assertion recognises. Any OTHER unwrapped call is the defect.
    for (const before of unwrapped) {
      expect(before, `an unwrapped fenced write: ...${before.slice(-90)}`).toMatch(
        /refusal that is deliberately not read/,
      );
    }
    expect(unwrapped).toHaveLength(1);
  });
});


/**
 * Every child process this package spawns is bounded.
 *
 * A source check, for the same reason the fence check is one: the property is
 * "no call site anywhere lacks a wall clock", and that is a statement about the
 * SET of call sites rather than about any behaviour a single test can drive. A
 * wedged `gh` or `git` is exactly what cannot be staged reliably.
 *
 * This exists because the rule kept reopening at new doors. It was applied in
 * `exec.ts`, then missed at the goal script's three `execFileSync` calls, then
 * missed again at the two startup git queries in `guards.ts` — each found
 * by a review round rather than by the previous fix. A check over the set is
 * what makes the next door fail here instead.
 */
const SPAWNING_FILES = [
  join(__dirname, "..", "src", "guards.ts"),
  join(__dirname, "..", "src", "exec.ts"),
  // This package's own goal check. A goal script spawns git and it is not
  // exempt: the sweep follows the files, not the directory.
  join(
    __dirname,
    "..",
    "..",
    "..",
    "goals",
    "harness-manager",
    "answered-run-continues-its-session",
    "run.mts",
  ),
];

describe("every child process is bounded", () => {
  it("finds the spawning call sites at all", () => {
    // Or the assertion below examines nothing and passes vacuously.
    //
    // **The floor moved because the SUBJECTS split, and both halves are swept.**
    // This list used to name a goal script belonging to `labs/conductor`. That
    // script did not move with this package, so leaving it here was wrong and
    // dropping it silently was worse — for the length of one PR nothing
    // asserted it bounded its spawns at all, which is precisely the failure
    // this file's header records happening three times. It is swept by
    // `labs/conductor/test/spawn-bounds.spec.ts` now, and this package sweeps
    // its own sources and its own goal.
    const total = SPAWNING_FILES.map((f) => readFileSync(f, "utf8"))
      .join("\n")
      .match(/execFileSync\s*\(|execFileAsync\s*\(/g);
    expect(total?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("gives every spawn a wall clock", () => {
    for (const file of SPAWNING_FILES) {
      const src = readFileSync(file, "utf8");
      const pattern = /(execFileSync|execFileAsync)\s*\(/g;
      for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
        // The options object of a spawn ends at the closing paren of the call;
        // a 600-char window covers every call in these files and is checked for
        // a timeout the call actually carries.
        const window = src.slice(m.index, m.index + 600);
        expect(
          /timeout:/.test(window),
          `an unbounded spawn in ${file.split("/").pop()}: ${window.slice(0, 110)}`,
        ).toBe(true);
      }
    }
  });
});
