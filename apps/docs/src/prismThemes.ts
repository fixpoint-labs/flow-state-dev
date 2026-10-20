/**
 * flow-state.dev — Paper and Night syntax themes.
 *
 * Code blocks take the Flow State brand inks that Shift Manager and the
 * DevTool paint with: warm ink on a card surface, blueprint for keywords and
 * types, green for strings, the brand red for literals. The highlighter yellow
 * never appears; it is reserved for "a person must act".
 *
 * Light and dark share an identical token→scope mapping and differ only in
 * their color values, so both are built from a small palette via `buildTheme`.
 * The background reads the design-system's `--card` token, so the code surface
 * follows the page theme.
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
      { types: ["function"], style: { color: p.function, fontWeight: "500" } },
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

// Every foreground clears WCAG AA (>= 4.5:1) against its card surface;
// comments in particular carry explanatory text.
export const paperTheme: PrismTheme = buildTheme({
  background: "var(--card)",
  plain: "#1b1a15",
  comment: "#6e6a5e",
  punctuation: "#57544a",
  operator: "#57544a",
  keyword: "#2c4f8c",
  literal: "#a83e28",
  string: "#3d6b45",
  function: "#1b1a15",
  className: "#2c4f8c",
  property: "#3d3a32",
  deleted: "#a83e28",
});

export const nightTheme: PrismTheme = buildTheme({
  background: "var(--card)",
  plain: "#ece7da",
  comment: "#a6a08f",
  punctuation: "#a6a08f",
  operator: "#cbc5b5",
  keyword: "#8fabe2",
  literal: "#e27a5f",
  string: "#8cc39a",
  function: "#ece7da",
  className: "#8fabe2",
  property: "#cbc5b5",
  deleted: "#e27a5f",
});
