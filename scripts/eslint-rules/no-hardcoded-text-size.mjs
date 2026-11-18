/**
 * `fsd/no-hardcoded-text-size`: a lab's text takes its size from the type scale.
 *
 * The Labs size text with Tailwind's steps (`text-xs` … `text-2xl`), whose
 * values are the design system's `type.css`, so one edit there resizes every
 * lab. A hard-coded size compiles to a literal no value reaches, so it is the
 * one way a size drifts off the scale. The rule reads string and template
 * literals (so `className="…"`, `cn(…)`, conditionals and template strings
 * alike), with any variant prefix, and reports:
 *
 * - an arbitrary text size: `text-[11px]`, `text-[0.7rem]/5`,
 *   `text-[clamp(…)]`, `text-[length:var(--x)]`, `text-(length:--x)`;
 * - an arbitrary font-size property: `[font-size:11px]`;
 * - `fontSize` in a JSX `style` object.
 *
 * `text-[var(--x)]`, `text-[#hex]` and `text-(--x)` paint a colour in
 * Tailwind v4, not a size, and are left alone. There is no allow-list: a glyph
 * drawn at a fixed size in a fixed box takes a reasoned
 * `eslint-disable-next-line` on its line.
 */

/** Where the rule reads: the three labs' source, Shift Manager's, and the registry's components. */
export const TYPE_SCALE_SOURCE = {
  files: [
    "labs/*/src/**/*.{ts,tsx}",
    "packages/shift-manager/src/**/*.{ts,tsx}",
    "packages/ui/registry/components/**/*.{ts,tsx}",
  ],
  ignores: ["**/*.test.{ts,tsx}", "**/*.stories.tsx"],
};

/** The steps, smallest first, at the type file's values in px: what a size maps to. */
const STEPS = [
  ["text-xs", 12],
  ["text-sm", 14],
  ["text-base", 16],
  ["text-lg", 18],
  ["text-xl", 22],
  ["text-2xl", 26],
];

/** A class that hard-codes a font size. Group 1 is the size class itself, for the message. */
const HARDCODED = new RegExp(
  [
    // `text-[…]` holding a length: a number with a unit, a CSS function, or a `length:` hint.
    String.raw`(?<![\w-])(text-\[(?:length:[^\]\s]+|-?[\d.]+(?:px|rem|em|pt|%|vw|vh|ch|ex|lh|rlh|vmin|vmax|cqw|cqh)|(?:clamp|calc|min|max)\([^\]\s]*\))\])`,
    // Tailwind v4's shorthand with a length hint: `text-(length:--x)`.
    String.raw`(?<![\w-])(text-\(length:[^)\s]+\))`,
    // An arbitrary property.
    String.raw`(\[font-size:[^\]\s]+\])`,
  ].join("|"),
  "g",
);

/** The step a hard-coded `px` or `rem` size maps to: the nearest one not smaller, and never below the floor. */
function suggest(found) {
  const m = /\[(-?[\d.]+)(px|rem)\]/.exec(found);
  if (m === null) return "the step of its role";
  const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
  const step = STEPS.find(([, size]) => size >= px) ?? STEPS[STEPS.length - 1];
  return `\`${step[0]}\``;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Size a lab's text with a step of the type scale, never a hard-coded size" },
    schema: [],
    messages: {
      size:
        "Hard-coded text size `{{found}}`. Use {{step}}: a step reads its size from the design system's type.css " +
        "(xs meta, labels and ids · sm controls, lists and code · base the feed's body and the composer · lg–2xl headings).",
      style:
        "`fontSize` in a style sets a size no type-scale value reaches. Use a text step class " +
        "(xs meta, labels and ids · sm controls, lists and code · base the feed's body and the composer · lg–2xl headings).",
    },
  },
  create(context) {
    const read = (node, text) => {
      for (const match of text.matchAll(HARDCODED)) {
        const found = match[1] ?? match[2] ?? match[3];
        context.report({ node, messageId: "size", data: { found, step: suggest(found) } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") read(node, node.value);
      },
      TemplateElement(node) {
        read(node, node.value.cooked ?? node.value.raw);
      },
      "JSXAttribute[name.name='style'] Property"(node) {
        const key = node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (key === "fontSize" || key === "font-size") context.report({ node, messageId: "style" });
      },
    };
  },
};

/** The rule, merged into the `fsd` plugin in `eslint.config.mjs`. */
export default { rules: { "no-hardcoded-text-size": rule } };
