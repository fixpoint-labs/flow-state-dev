/**
 * Every child process this lab spawns is bounded.
 *
 * A source check, because the property is "no call site anywhere lacks a wall
 * clock", and that is a statement about the SET of call sites rather than about
 * a behaviour a single test can drive. A wedged `gh` or `git` is exactly what
 * cannot be staged reliably.
 *
 * **This exists because the rule kept reopening at new doors**, and once
 * already because a sweep moved without its subjects. It was applied in the
 * exec helper, then missed at the goal script's `execFileSync` calls, then
 * missed again at two startup git queries — each found by a review round rather
 * than by the previous fix. When the loop was extracted to
 * `@flow-state-dev/harness-manager` the sweep went with it, and the goal script
 * it also covered stayed here with nothing watching it. That is the same class
 * of failure the sweep exists to catch, committed by moving the sweep.
 *
 * So: the package sweeps its own sources and its own goal, and this sweeps the
 * goal that belongs to this lab.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPAWNING_FILES = [
  join(
    __dirname,
    "..",
    "..",
    "..",
    "goals",
    "conductor",
    "implement-phase-opens-a-pr",
    "run.mts",
  ),
];

describe("every child process this lab spawns is bounded", () => {
  it("finds the spawning call sites at all", () => {
    // Or the assertion below examines nothing and passes vacuously — which is
    // the shape this whole lab exists to remove, and the shape the sweep was in
    // for the length of one PR.
    const total = SPAWNING_FILES.map((f) => readFileSync(f, "utf8"))
      .join("\n")
      .match(/execFileSync\s*\(|execFileAsync\s*\(/g);
    expect(total?.length ?? 0).toBeGreaterThanOrEqual(5);
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
