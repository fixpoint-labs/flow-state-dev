/**
 * The goals' length-guard check (`goals/scripts/check-tell-suppress.mjs`) over
 * fixture files: the one shape it refuses (a `length > 0 &&` guard ahead of a
 * failure, which skips the check on an empty list), and the shapes it must
 * leave alone so it can gate CI without an allowlist.
 */
import { describe, expect, it } from "vitest";
import {
  PLANTS,
  control,
  scanFile,
  // @ts-expect-error — goals check script, plain .mjs with no type declarations.
} from "../../../goals/scripts/check-tell-suppress.mjs";

type Hit = { path: string; line: number; text: string };

const lines = (source: string): number[] => (scanFile("x/run.mts", source) as Hit[]).map((h) => h.line);

describe("the check refuses a length guard ahead of a failure", () => {
  it.each([
    ["> 0", 'if (seqs.length > 0 && !ordered(seqs)) failures.push("ordering");'],
    ["!== 0", 'if (rows.length !== 0 && rows.some(bad)) fail(leg, "a bad row");'],
    [">= 1", 'if (done.length >= 1 && made !== 1) failures.push("made");'],
    ["a helper's fail", 'if (xs.length > 0 && !ok) r.fail("b4", "x");'],
  ])("%s", (_guard, source) => {
    expect(lines(source)).toEqual([1]);
  });

  it("across lines, through a block and a comment, and after an else", () => {
    const source = [
      "if (missing) note();",
      "else if (rows.length > 0 &&",
      "    rows.some((r) => r.owner !== who)) {",
      "  // someone else's",
      '  failures.push("an open answered another owner");',
      "}",
    ].join("\n");
    expect(lines(source)).toEqual([2]);
  });

  it.each([
    ["a quote", `const re = /'/; if (xs.length > 0 && !ok(xs)) failures.push("bad");`],
    ["a quote in a class", `const re = /["/]/g; if (xs.length > 0 && !ok(xs)) failures.push("bad");`],
    ["a backtick after return", "function f() { return /`/.test(s); } if (xs.length > 0 && !ok(xs)) failures.push(1);"],
  ])("after a regex literal holding %s", (_what, source) => {
    expect(lines(source)).toEqual([1]);
  });
});

describe("the check leaves alone what only looks like it", () => {
  it.each([
    ["a polling loop that waits rather than fails", "if (opened.length > 0 && opened.every(ready)) {\n  if (opened.length > 1) fail(leg, \"two\");\n  return opened[0];\n}"],
    ["a sameness check, which needs two", 'if (answers.length > 1 && new Set(answers).size === 1) failures.push("all the same");'],
    ["a guard ahead of a break", "if (rows.length > 0 && rows.every(settled)) break;"],
    ["a guard ahead of a note, not a failure", "if (failures.length > 0 && notes.length > 0) {\n  return { failures: [...failures, ...notes] };\n}"],
    ["a failure only when something is there", 'if (extra.length > 0) failures.push("extra rows");'],
    ["the shape in a comment", '// if (xs.length > 0 && !ok) failures.push("x");'],
    ["the shape in a string", 'const example = "if (xs.length > 0 && !ok) failures.push(1)";'],
    ["the shape in a template literal", "const example = `if (xs.length > 0 && !ok) fail(${leg}, 1)`;"],
    ["the shape in a regex literal", "const re = /if (xs.length > 0 && !ok) failures.push(1)/;"],
    ["a division, not a regex", 'const half = total / 2; const s = "if (xs.length > 0 && !ok) fail(1)"; const q = n / 3;'],
  ])("%s", (_what, source) => {
    expect(lines(source)).toEqual([]);
  });
});

describe("--control", () => {
  it("reads every plant as it must, on a tree that has none of its own", () => {
    const { results, ok } = control(new Map()) as { results: Array<{ what: string; right: boolean }>; ok: boolean };
    expect(results.filter((r) => !r.right)).toEqual([]);
    expect(ok).toBe(true);
    expect((PLANTS as Array<{ refuse: boolean }>).filter((p) => p.refuse).length).toBeGreaterThanOrEqual(3);
  });
});
