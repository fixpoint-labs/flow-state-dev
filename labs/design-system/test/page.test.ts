/**
 * The page register: Paper and Night set the same tokens, Night reaches the page by
 * every route page.css promises (explicit theme, `.dark`, the OS setting when no theme
 * is set), hairlines and the grid are ink at their fixed opacities, and the only hues
 * are the highlighter and red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT, rule, stripImportsAndComments, toRgb } from "./theme";

const css = readFileSync(join(PACKAGE_ROOT, "page.css"), "utf8");
const paper = rule(css, ":root");
const night = rule(css, ':root[data-theme="dark"], :root[data-theme="night"], .dark');
const nightByOs = rule(css, ":root:not([data-theme])");

/** `rgba(r, g, b, a)` as its colour and its alpha. */
function rgba(value: string): { rgb: number[]; alpha: number } {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
  if (m === null) throw new Error(`not rgba(): ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) };
}

describe("Paper and Night", () => {
  it("Night redefines every Paper colour token except the highlighter, which is the same in both", () => {
    const colours = Object.keys(paper).filter((name) => /^(#|rgba)/.test(paper[name]!));
    expect(colours.length).toBeGreaterThan(12);
    const unchanged = colours.filter((name) => night[name] === undefined);
    expect(unchanged.sort()).toEqual(["--highlighter", "--on-highlighter"]);
    for (const name of colours.filter((n) => !unchanged.includes(n))) expect(night[name], name).not.toBe(paper[name]);
  });

  it("applies the same Night under the OS setting as under an explicit theme", () => {
    expect(Object.keys(night).length).toBeGreaterThan(8);
    expect(nightByOs).toEqual(night);
    // The OS block only reaches a root with no explicit theme, so the site toggle wins.
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \{/);
  });
});

describe("hairlines and the grid", () => {
  for (const [name, mode] of [["Paper", paper], ["Night", { ...paper, ...night }]] as const) {
    it(`draws them in ${name}'s ink at .45, .25 and the grid opacity`, () => {
      const ink = toRgb(mode["--ink1"]!);
      const want = { "--hairline-structural": 0.45, "--hairline-internal": 0.25, "--grid-line": name === "Paper" ? 0.07 : 0.06 };
      for (const [token, alpha] of Object.entries(want)) {
        expect(rgba(mode[token]!), token).toEqual({ rgb: ink, alpha });
      }
    });
  }
});

describe("colour marks emphasis", () => {
  it("names no colour outside paper, the inks, the highlighter and red", () => {
    const allowed = new Set(
      [paper, night].flatMap((mode) =>
        ["--paper", "--paper-band", "--paper-card", "--ink1", "--ink2", "--ink3", "--ink4", "--highlighter", "--on-highlighter", "--red"]
          .map((token) => mode[token])
          .filter((v): v is string => v !== undefined),
      ),
    );
    const hexes = stripImportsAndComments(css).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexes.length).toBeGreaterThan(15);
    expect(hexes.filter((hex) => !allowed.has(hex.toLowerCase()))).toEqual([]);
  });
});
