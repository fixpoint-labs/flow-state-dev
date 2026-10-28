/**
 * flow-state.dev — the ink-only syntax theme, for Paper and Night.
 *
 * Code is drawn in ink, like the rest of the page: no hue tells one token
 * kind from another. Keywords are bold, comments italic and lighter,
 * punctuation and operators lighter still, and a deleted line is struck
 * through. Every value is a page-register token from
 * `@flow-state-dev/design-system/page.css`, so the one theme follows the
 * colour mode by itself and Docusaurus gets it as both its light and its
 * dark theme.
 */
import type { PrismTheme } from "prism-react-renderer";

export const inkTheme: PrismTheme = {
  plain: {
    color: "var(--ink1)",
    backgroundColor: "var(--paper-card)",
  },
  styles: [
    {
      types: ["comment", "prolog", "cdata", "doctype"],
      style: { color: "var(--ink4)", fontStyle: "italic" },
    },
    { types: ["punctuation"], style: { color: "var(--ink3)" } },
    { types: ["operator", "entity", "url"], style: { color: "var(--ink3)" } },
    {
      types: ["keyword", "atrule", "tag", "builtin", "important"],
      style: { color: "var(--ink1)", fontWeight: "600" },
    },
    {
      types: ["number", "boolean", "constant", "symbol"],
      style: { color: "var(--ink1)" },
    },
    {
      types: ["string", "char", "attr-value", "inserted", "regex"],
      style: { color: "var(--ink2)" },
    },
    { types: ["function", "class-name"], style: { color: "var(--ink1)", fontWeight: "500" } },
    {
      types: ["property", "variable", "attr-name"],
      style: { color: "var(--ink2)" },
    },
    { types: ["deleted"], style: { color: "var(--ink3)", textDecorationLine: "line-through" } },
    { types: ["bold"], style: { fontWeight: "bold" } },
    { types: ["italic"], style: { fontStyle: "italic" } },
  ],
};
