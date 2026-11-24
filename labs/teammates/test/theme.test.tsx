// @vitest-environment happy-dom
/**
 * The Paper and Night themes come from one set of tokens: every colour a
 * component draws is a token, both themes set every token, the quietest text
 * stays readable on every ground, and the switch draws the page in the other
 * theme and keeps the pick. Day breaks in the conversation say Today,
 * Yesterday or the date.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayLabel } from "../src/components/Conversation";
import { applyTheme, initialTheme, useTheme } from "../src/lib/theme";

const SRC = join(__dirname, "../src");
const css = readFileSync(join(SRC, "lib/theme.css"), "utf8");

/** The custom properties one theme's block sets, by name. */
function themeBlock(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const paper = themeBlock(':root[data-theme="paper"]');
const night = themeBlock(':root[data-theme="night"]');

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Every file under `dir`. */
const filesIn = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesIn(join(dir, name)) : [join(dir, name)]));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the themes' tokens", () => {
  it("sets the same tokens in Paper and Night, so a component reads one set in either", () => {
    expect(Object.keys(night).sort()).toEqual(Object.keys(paper).sort());
  });

  it("keeps every text step at 4.5:1 or more on every ground, the smallest grey label included", () => {
    for (const [name, theme] of [["paper", paper], ["night", night]] as const) {
      for (const ink of ["ink", "ink2", "ink3", "ink4"]) {
        for (const ground of ["bg", "sidebar", "inspector", "card"]) {
          expect(contrast(theme[ink]!, theme[ground]!), `${name} ${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Your message's bubble holds only its words, in ink; its time sits under it, on the page.
      expect(contrast(theme.ink!, theme.mine!), `${name} ink on mine`).toBeGreaterThanOrEqual(4.5);
      // The words on the highlighter, and blue, green and red words on the page.
      expect(contrast(theme.onhl!, theme.hl!), `${name} onhl on hl`).toBeGreaterThanOrEqual(4.5);
      for (const word of ["blue", "done", "red"]) expect(contrast(theme[word]!, theme.bg!), `${name} ${word} on bg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps Night's large surfaces dark: your message's bubble and every ground", () => {
    for (const ground of ["bg", "sidebar", "inspector", "card", "mine"]) expect(luminance(night[ground]!), ground).toBeLessThan(0.05);
  });

  it("leaves no hard-coded colour in the lab's own components: each is a token", () => {
    // The registry's copies (`flow-state/`, `ui/`) are byte copies the lab doesn't edit; they read the same tokens.
    const own = filesIn(join(SRC, "components")).filter((file) => !/[\\/](flow-state|ui)[\\/]/.test(file));
    const found = own.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/.test(line) ? [`${file.slice(SRC.length)}:${i + 1}`] : [])),
    );
    expect(found).toEqual([]);
  });
});

function Switch() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      {theme}
    </button>
  );
}

describe("the theme switch", () => {
  it("draws the page in the other theme, Night with the dark class, and keeps the pick for the next load", () => {
    applyTheme("paper");
    render(<Switch />);
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("paper");
    expect(root.classList.contains("dark")).toBe(false);
    act(() => fireEvent.click(screen.getByRole("button")));
    expect(root.dataset.theme).toBe("night");
    expect(root.classList.contains("dark")).toBe(true);
    expect(initialTheme()).toBe("night");
    act(() => fireEvent.click(screen.getByRole("button")));
    expect(root.dataset.theme).toBe("paper");
    expect(initialTheme()).toBe("paper");
  });

  it("follows the system's setting until the viewer picks: Night is the dark default", () => {
    const dark = (matches: boolean) => (window.matchMedia = ((media: string) => ({ matches: matches && media === "(prefers-color-scheme: dark)", media, addEventListener() {}, removeEventListener() {} })) as never);
    dark(true);
    expect(initialTheme()).toBe("night");
    dark(false);
    expect(initialTheme()).toBe("paper");
  });
});

describe("a day break", () => {
  it("says Today, Yesterday, or the date", () => {
    const now = new Date(2026, 10, 24, 15, 0).getTime();
    expect(dayLabel(new Date(2026, 10, 24, 0, 5).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 23, 23, 55).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 20, 12, 0).getTime(), now)).toMatch(/20/);
    expect(dayLabel(new Date(2026, 10, 20, 12, 0).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
});
