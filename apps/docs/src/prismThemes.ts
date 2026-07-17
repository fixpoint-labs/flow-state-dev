/**
 * flow-state.dev — earthy/golden syntax themes.
 *
 * Replaces the default dracula palette (loud purple + pink) so code blocks
 * sit in the same golden/earthy register as the rest of the site
 * (brand accent #B27D40). Keywords lean amber-gold, strings a muted sage,
 * literals a warm copper — no high-saturation magenta.
 */
import type { PrismTheme } from "prism-react-renderer";

export const earthyDark: PrismTheme = {
  plain: {
    color: "#e4ddd0",
    backgroundColor: "#0c0c14",
  },
  styles: [
    {
      types: ["comment", "prolog", "cdata"],
      style: { color: "#6e6656", fontStyle: "italic" },
    },
    {
      types: ["punctuation"],
      style: { color: "#9a9182" },
    },
    {
      types: ["operator", "entity", "url"],
      style: { color: "#b8ae9c" },
    },
    {
      types: ["keyword", "atrule", "tag", "builtin"],
      style: { color: "#c79a5b" },
    },
    {
      types: ["number", "boolean", "constant", "symbol"],
      style: { color: "#cb8e5e" },
    },
    {
      types: ["string", "char", "attr-value", "inserted", "regex"],
      style: { color: "#a3b18a" },
    },
    {
      types: ["function"],
      style: { color: "#e0b87a" },
    },
    {
      types: ["class-name"],
      style: { color: "#d9c18a" },
    },
    {
      types: ["property", "variable", "attr-name"],
      style: { color: "#dccdb4" },
    },
    {
      types: ["deleted"],
      style: { color: "#c56b5b" },
    },
    {
      types: ["important", "bold"],
      style: { fontWeight: "bold" },
    },
    {
      types: ["italic"],
      style: { fontStyle: "italic" },
    },
  ],
};

export const earthyLight: PrismTheme = {
  plain: {
    color: "#3b352b",
    backgroundColor: "#faf8f4",
  },
  styles: [
    {
      types: ["comment", "prolog", "cdata"],
      style: { color: "#9a8f7a", fontStyle: "italic" },
    },
    {
      types: ["punctuation"],
      style: { color: "#7a7060" },
    },
    {
      types: ["operator", "entity", "url"],
      style: { color: "#6e6455" },
    },
    {
      types: ["keyword", "atrule", "tag", "builtin"],
      style: { color: "#a66a2e" },
    },
    {
      types: ["number", "boolean", "constant", "symbol"],
      style: { color: "#b05e36" },
    },
    {
      types: ["string", "char", "attr-value", "inserted", "regex"],
      style: { color: "#5e6e4a" },
    },
    {
      types: ["function"],
      style: { color: "#9a6d38" },
    },
    {
      types: ["class-name"],
      style: { color: "#7a5a2a" },
    },
    {
      types: ["property", "variable", "attr-name"],
      style: { color: "#5f5847" },
    },
    {
      types: ["deleted"],
      style: { color: "#b04a3a" },
    },
    {
      types: ["important", "bold"],
      style: { fontWeight: "bold" },
    },
    {
      types: ["italic"],
      style: { fontStyle: "italic" },
    },
  ],
};
