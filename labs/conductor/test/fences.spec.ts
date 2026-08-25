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
