/**
 * flow-state.dev — earthy/golden syntax themes.
 *
 * Replaces the default dracula palette (loud purple + pink) so code blocks
 * sit in the same golden/earthy register as the rest of the site
 * (brand accent #B27D40). Keywords lean amber-gold, strings a muted sage,
 * literals a warm copper — no high-saturation magenta.
 *
 * Light and dark share an identical token→scope mapping and differ only in
 * their color values, so both are built from a small palette via `buildTheme`.
 * The `background` here is the single source of truth for the code-block
 * surface in both modes (custom.css no longer overrides it).
 */
import type { PrismTheme } from "prism-react-renderer";

interface Palette {
  background: string;
  plain: string;
  comment: string;
  punctuation: string;
  operator: string;
  keyword: string;
  literal: string; // number / boolean / constant / symbol
  string: string;
  function: string;
  className: string;
  property: string;
  deleted: string;
}

function buildTheme(p: Palette): PrismTheme {
  return {
    plain: {
      color: p.plain,
      backgroundColor: p.background,
    },
    styles: [
      {
        types: ["comment", "prolog", "cdata"],
        style: { color: p.comment, fontStyle: "italic" },
      },
      { types: ["punctuation"], style: { color: p.punctuation } },
      { types: ["operator", "entity", "url"], style: { color: p.operator } },
      {
        types: ["keyword", "atrule", "tag", "builtin"],
        style: { color: p.keyword },
      },
      {
        types: ["number", "boolean", "constant", "symbol"],
        style: { color: p.literal },
      },
      {
        types: ["string", "char", "attr-value", "inserted", "regex"],
        style: { color: p.string },
      },
      { types: ["function"], style: { color: p.function } },
      { types: ["class-name"], style: { color: p.className } },
      {
        types: ["property", "variable", "attr-name"],
        style: { color: p.property },
      },
      { types: ["deleted"], style: { color: p.deleted } },
      { types: ["important", "bold"], style: { fontWeight: "bold" } },
      { types: ["italic"], style: { fontStyle: "italic" } },
    ],
  };
}

// Light-mode colors are tuned to clear WCAG AA (>= 4.5:1) against the
// #faf8f4 code surface — code comments in particular carry explanatory text.
export const earthyLight: PrismTheme = buildTheme({
  background: "#faf8f4",
  plain: "#3b352b",
  comment: "#746a58",
  punctuation: "#7a7060",
  operator: "#6e6455",
  keyword: "#9c6122",
  literal: "#ab5730",
  string: "#5e6e4a",
  function: "#8f6330",
  className: "#7a5a2a",
  property: "#5f5847",
  deleted: "#b04a3a",
});

export const earthyDark: PrismTheme = buildTheme({
  background: "#0c0c14",
  plain: "#e4ddd0",
  comment: "#857c6a",
  punctuation: "#9a9182",
  operator: "#b8ae9c",
  keyword: "#c79a5b",
  literal: "#cb8e5e",
  string: "#a3b18a",
  function: "#e0b87a",
  className: "#d9c18a",
  property: "#dccdb4",
  deleted: "#c56b5b",
});
