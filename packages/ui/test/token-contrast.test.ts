/**
 * Dark-mode `destructive` is readable as text.
 *
 * Components paint error messages, failed tool states and critical audit
 * notes with `text-destructive` straight on the card or page background. In
 * dark mode that text has to clear WCAG AA for normal-size text (4.5:1)
 * against both, or the one colour that says "this failed" is the hardest one
 * to read. The reverse use has to clear it too: a destructive action (the
 * approval card's Reject button) paints `text-destructive-foreground` on a
 * solid `bg-destructive` fill, so lightening the red for text must not leave
 * the button's label unreadable, at rest or while hovered: the hover fill
 * is the one the user reads at the moment they act. Checked on the `tokens`
 * item's defaults, which are what an install writes and what
 * `registry/token-defaults.css` is held to.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registryTokenDefaults } from "../scripts/token-defaults";

/** WCAG AA minimum for normal-size text. */
const AA_TEXT = 4.5;

/** `hsl(H S% L%)`, the only form the `tokens` item authors, to sRGB 0–1. */
function hslToRgb(value: string): [number, number, number] {
  const match = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value);
  if (!match) throw new Error(`not an hsl() token value: ${value}`);
  const h = Number(match[1]);
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

type Rgb = [number, number, number];

/** WCAG 2.x relative luminance of a token value or an already-resolved sRGB colour. */
function luminance(value: string | Rgb): number {
  const [r, g, b] = (typeof value === "string" ? hslToRgb(value) : value).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio between two colours, order-independent. */
function contrast(a: string | Rgb, b: string | Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `a` blended toward `b` by `t` (0–1), per channel in sRGB, as `color-mix(in srgb, …)` and alpha compositing both do. */
function mix(a: string, b: string, t: number): Rgb {
  const [x, y] = [hslToRgb(a), hslToRgb(b)];
  return x.map((c, i) => c * (1 - t) + y[i]! * t) as Rgb;
}

const APPROVAL = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../registry/components/approval.tsx"),
  "utf8",
);

/**
 * The fill the approval card's Reject button paints while hovered, resolved
 * against `tokens`. Reads the shipped class so the check follows the
 * component; a hover form it doesn't know fails here rather than passing
 * unmeasured.
 */
function rejectHoverFill(tokens: Record<string, string>): Rgb {
  const className = /className="([^"]*\bbg-destructive [^"]*)"/.exec(APPROVAL)?.[1];
  const hover = className && /\bhover:bg-(\S+)/.exec(className)?.[1];
  if (!hover) throw new Error("no hover fill on the Reject button");
  const alpha = /^destructive\/(\d+)$/.exec(hover);
  // Partial opacity lets the card show through.
  if (alpha) return mix(tokens.card!, tokens.destructive!, Number(alpha[1]) / 100);
  const toward = /^\[color-mix\(in_srgb,var\(--color-destructive\),var\(--color-foreground\)_(\d+)%\)\]$/.exec(hover);
  if (toward) return mix(tokens.destructive!, tokens.foreground!, Number(toward[1]) / 100);
  throw new Error(`unrecognised Reject hover fill: ${hover}`);
}

describe("dark destructive as text", () => {
  const { dark } = registryTokenDefaults();

  it.each(["card", "background"])("clears AA on %s", (surface) => {
    expect(contrast(dark.destructive!, dark[surface]!)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the label on a solid destructive fill at AA", () => {
    expect(contrast(dark["destructive-foreground"]!, dark.destructive!)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the label on the hovered Reject fill at AA", () => {
    expect(contrast(dark["destructive-foreground"]!, rejectHoverFill(dark))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("fails a hover that lets the dark card show through the fill", () => {
    // The shape that shipped unreadable: the fill at 90% opacity over the card.
    expect(contrast(dark["destructive-foreground"]!, mix(dark.card!, dark.destructive!, 0.9))).toBeLessThan(AA_TEXT);
  });

  it("fails a red too dark to read on the dark background", () => {
    // The kind of value that ships unreadable: a deep red meant as a fill.
    expect(contrast("hsl(0 62.8% 30.6%)", dark.background!)).toBeLessThan(AA_TEXT);
  });

  it("measures the reference pair WCAG publishes", () => {
    // Black on white is 21:1 by definition, so the formula is not off by a scale.
    expect(contrast("hsl(0 0% 0%)", "hsl(0 0% 100%)")).toBeCloseTo(21, 5);
  });
});
