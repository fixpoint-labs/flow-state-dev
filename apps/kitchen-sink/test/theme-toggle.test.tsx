// @vitest-environment happy-dom
/**
 * Kitchen Sink has two themes and one button between them. Light is the
 * design system's warm Draft stock, so the root must match the selector its
 * evening values sit under and never carry `dark`; dark must carry
 * `.dark`, which both the design system's night values and Tailwind's `dark:`
 * variant key on. The first paint counts too: next-themes' inline script runs
 * before React does, and what it writes must already match that selector, or a
 * light visitor sees day until hydration.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppThemeProvider } from "../components/theme-provider";
import { ThemeToggle } from "../components/theme-toggle";

const root = () => document.documentElement;

/** The selector the design system puts its evening (Draft) values under, read from its stylesheet. */
const EVENING = (() => {
  const css = readFileSync(createRequire(import.meta.url).resolve("@flow-state-dev/design-system/shift-manager.css"), "utf8");
  const selector = /([^{}]*evening[^{}]*)\{/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1]?.trim();
  if (!selector) throw new Error("no evening rule in the design system");
  return selector;
})();

function mount(stored: "light" | "dark") {
  localStorage.setItem("theme", stored);
  render(
    <AppThemeProvider>
      <ThemeToggle />
    </AppThemeProvider>,
  );
}

/** Runs the inline script the server renders, as the browser would before hydration. */
function runPrePaintScript(stored: "light" | "dark") {
  localStorage.setItem("theme", stored);
  const html = renderToString(<AppThemeProvider>{null}</AppThemeProvider>);
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  expect(script, "next-themes renders its pre-paint script").toBeTruthy();
  new Function(script!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"))();
}

beforeEach(() => {
  localStorage.clear();
  root().className = "";
  root().removeAttribute("style");
});
afterEach(cleanup);

describe("the theme toggle", () => {
  it("paints light as the Draft stock, not plain day", () => {
    mount("light");
    expect(root().matches(EVENING)).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("paints the Draft stock before hydration, not day", () => {
    runPrePaintScript("light");
    expect(root().matches(EVENING)).toBe(true);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("paints night before hydration for a dark visitor", () => {
    runPrePaintScript("dark");
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().matches(EVENING)).toBe(false);
  });

  it("flips light to dark and back with one press each", async () => {
    mount("light");
    await act(async () => fireEvent.click(screen.getByTestId("theme-toggle")));
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().matches(EVENING)).toBe(false);
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-label")).toBe("Switch to light theme");

    await act(async () => fireEvent.click(screen.getByTestId("theme-toggle")));
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().matches(EVENING)).toBe(true);
  });
});
