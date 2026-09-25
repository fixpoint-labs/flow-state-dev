/**
 * The guide's code excerpts are cut from this example's tested source, so a
 * snippet can't drift into teaching something the tests never ran.
 *
 * An excerpt passes when every line of it appears in the source, in order.
 * Trailing `//` comments and blank lines are ignored, and a line with `…`
 * marks elided code. Only the excerpts that claim to be the example's code are
 * checked; the illustrative filters on the page are not.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const GUIDE = join(ROOT, "../../../apps/docs/docs/resources/searching.md");
const SOURCE = ["src/facets.ts", "src/index-facets.ts", "src/flow.ts"];

/** First lines of the excerpts that must be verbatim cuts of the source. */
const CHECKED = ["export const ticketQuestions = {", "await ref.updateState((state) =>"];

function normalize(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+\/\/.*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.includes("…"));
}

function tsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/** The first excerpt line that can't be found in order, or undefined. */
function firstMissing(excerpt: string[], source: string[]): string | undefined {
  let at = 0;
  for (const line of excerpt) {
    const found = source.indexOf(line, at);
    if (found === -1) return line;
    at = found + 1;
  }
  return undefined;
}

const source = normalize(SOURCE.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n"));
const excerpts = tsBlocks(readFileSync(GUIDE, "utf8")).filter((b) =>
  CHECKED.some((first) => b.trimStart().startsWith(first)),
);

describe("the guide's excerpts are cut from the example", () => {
  it("finds every checked excerpt on the page", () => {
    expect(excerpts).toHaveLength(CHECKED.length);
  });

  for (const [n, excerpt] of excerpts.entries()) {
    it(`excerpt ${n + 1} appears in the source, in order`, () => {
      expect(firstMissing(normalize(excerpt), source)).toBeUndefined();
    });
  }

  it("negative control: a drifted line is caught", () => {
    const drifted = normalize(excerpts[1]!.replace("state.indexedAs === token", "state.body === body"));
    expect(firstMissing(drifted, source)).toContain("state.body === body");
  });
});
