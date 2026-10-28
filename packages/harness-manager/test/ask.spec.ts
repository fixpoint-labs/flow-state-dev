/**
 * The ask marker at its own seam: where a run writes its question, that the
 * path is new for every run of an attempt, and which tracked paths count as
 * markers.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { ASK_MARKER_DIR, askMarkerPath, isAskMarkerPath, readAskMarker } from "../src/ask";

describe("the marker — inside the checkout, gitignored, and per run", () => {
  it("derives a path INSIDE the checkout, under this attempt's and this run's own name", () => {
    const checkout = join(sep, "runs", "checkout");
    const path = askMarkerPath(checkout, 3, 5);
    // Inside, because outside is unwritable: the SDK denies an out-of-tree
    // Write under exactly the config every call site uses, and reports the run
    // as a success anyway.
    expect(path.startsWith(`${checkout}${sep}`)).toBe(true);
    expect(path).not.toContain("..");
    expect(path.endsWith(join(ASK_MARKER_DIR, "3-5.md"))).toBe(true);
    // Per attempt, and per run within one: an answered question's next turn
    // shares its attempt, and must not read the question the turn before asked.
    expect(askMarkerPath(checkout, 1, 1)).not.toBe(askMarkerPath(checkout, 2, 1));
    expect(askMarkerPath(checkout, 1, 1)).not.toBe(askMarkerPath(checkout, 1, 2));
  });

  it("is IGNORED by this repository's own .gitignore", () => {
    // The guarantee that a question never rides into the product PR is
    // coupled to that entry staying accurate. Narrow the pattern or rename the
    // directory and this fails rather than leaking the question text into a diff.
    const derived = askMarkerPath(process.cwd(), 1, 1);
    const ignored = execFileSync("git", ["check-ignore", derived], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(ignored.trim()).toBe(derived);
  });

  it("reads only THIS run's file, so an earlier run's marker cannot fake a question", async () => {
    // The checkout survives a retry and an answered question's next turn, so
    // an earlier run's question file is still on disk when the next run starts.
    const dir = mkdtempSync(join(tmpdir(), "harness-marker-"));
    try {
      const first = askMarkerPath(dir, 1, 1);
      mkdirSync(dirname(first), { recursive: true });
      writeFileSync(first, "run one's question");

      expect(await readAskMarker(dir, 1, 1)).toBe("run one's question");
      // The same attempt's next run, and the next attempt's: neither asked.
      expect(await readAskMarker(dir, 1, 2)).toBeUndefined();
      expect(await readAskMarker(dir, 2, 2)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a blank marker as NO question", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-marker-"));
    try {
      const path = askMarkerPath(dir, 1, 1);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "   \n\n  ");
      expect(await readAskMarker(dir, 1, 1)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifying a tracked path as a marker", () => {
  // The caller hands this `git ls-files -- <ASK_MARKER_DIR>` output, so every
  // entry is already inside that directory whatever the checkout's case rules
  // are. Shape and depth are what is left to decide.
  const at = (name: string) => `${ASK_MARKER_DIR}/${name}`.split(sep).join("/");

  it("accepts the names a run actually writes", () => {
    expect(isAskMarkerPath(at("1-1.md"))).toBe(true);
    expect(isAskMarkerPath(at("12-40.md"))).toBe(true);
  });

  it("accepts the index's own spelling on a case-folding checkout", () => {
    // Git resolves `.FSDEV/ask/1-1.md` and `.fsdev/ask/1-1.md` to ONE file
    // where the filesystem folds case, so `ls-files` can hand back a spelling
    // the run never used — and it is the file the run is about to collide with.
    expect(isAskMarkerPath(".FSDEV/ask/1-1.md")).toBe(true);
  });

  it("rejects a neighbour a run could never write", () => {
    // Tracked and ignored are independent, so a target may keep a `.gitkeep`
    // beside the markers and be in no danger from it.
    expect(isAskMarkerPath(at(".gitkeep"))).toBe(false);
    expect(isAskMarkerPath(at("README.md"))).toBe(false);
    expect(isAskMarkerPath(at("notes/1-1.md"))).toBe(false);
    // The shape before a run was counted: no run writes it now.
    expect(isAskMarkerPath(at("1.md"))).toBe(false);
  });

  it("treats a name SHAPED like a marker as one", () => {
    // `007-1.md` is not what attempt 7 writes, and it is refused anyway: the
    // check is about a repository many runs will work in, so it cannot know
    // which numbers those will be.
    expect(isAskMarkerPath(at("007-1.md"))).toBe(true);
  });
});
