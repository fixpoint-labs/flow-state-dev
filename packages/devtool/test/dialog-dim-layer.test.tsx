/**
 * The dim layer behind a DevTools dialog follows the panel theme: a dark,
 * see-through layer in every theme, painted from one shared theme token. A
 * dim layer drawn in ink turns light tan in the dark theme, where ink is the
 * light text color, and the page behind the dialog looks broken.
 *
 * happy-dom does not compile Tailwind, so the test resolves the dim layer's
 * `bg-fs-*` utility against the theme tokens in the panel stylesheet.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { JsonViewer } from "../src/react/components/shared/json-viewer";

const stylesheet = readFileSync(resolve(__dirname, "../src/react/styles.css"), "utf8");

/** The custom properties declared by the panel rule for one theme. */
function themeTokens(theme: "light" | "draft" | "dark"): Record<string, string> {
  const rule = new RegExp(
    String.raw`\.fsd-devtool-panel\[data-fs-theme="${theme}"\]\s*\{([^}]*)\}`,
  ).exec(stylesheet);
  if (!rule) throw new Error(`no ${theme} theme rule in styles.css`);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of rule[1].matchAll(/(--fs-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

/** `#rrggbb` or `rgb(r g b / a)` to channels plus alpha. */
function parseColor(value: string): { r: number; g: number; b: number; a: number } {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) {
    return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  }
  throw new Error(`unparsed theme color: ${value}`);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Opens the value dialog inside a panel themed `theme`; returns its dim layer. */
function openDialog(theme: "light" | "draft" | "dark"): HTMLElement {
  render(
    <div className="fsd-devtool-panel" data-fs-theme={theme}>
      <JsonViewer data={{ repo: "fixpoint-labs/flow-state-dev" }} />
    </div>,
  );
  fireEvent.click(screen.getByTitle("Open in dialog"));
  const layer = screen.getByText("Value").closest<HTMLElement>(".fixed.inset-0");
  if (!layer) throw new Error("dialog rendered without a dim layer");
  return layer;
}

/** The theme color the dim layer paints with, opacity modifier applied. */
function dimLayerColor(layer: HTMLElement, theme: "light" | "draft" | "dark") {
  const utility = [...layer.classList]
    .map((c) => /^bg-fs-([\w-]+?)(?:\/(\d+))?$/.exec(c))
    .find((m) => m !== null);
  if (!utility) throw new Error(`dim layer has no bg-fs-* color: ${layer.className}`);
  const [, token, opacity] = utility;
  // Tailwind only generates `bg-fs-<token>` for a token mapped in `@theme inline`.
  if (!stylesheet.includes(`--color-fs-${token}: var(--fs-${token});`)) {
    throw new Error(`bg-fs-${token} has no --color-fs-${token} mapping in @theme`);
  }
  const value = themeTokens(theme)[`--fs-${token}`];
  if (!value) throw new Error(`--fs-${token} is not defined in the ${theme} theme`);
  const color = parseColor(value);
  return { token, ...color, a: color.a * (opacity === undefined ? 1 : +opacity / 100) };
}

describe("the dim layer behind a dialog", () => {
  it.each(["dark", "light", "draft"] as const)(
    "is a dark, see-through layer in the %s theme",
    (theme) => {
      const color = dimLayerColor(openDialog(theme), theme);
      expect(luminance(color)).toBeLessThan(0.05);
      expect(color.a).toBeGreaterThan(0);
      expect(color.a).toBeLessThan(1);
    },
  );

  it("paints from the shared scrim token, not a text color", () => {
    expect(dimLayerColor(openDialog("dark"), "dark").token).toBe("scrim");
  });
});
