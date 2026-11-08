/**
 * `fsd/no-tracker-ids`: no tracker or process id in what an adopter reads.
 *
 * An adopter reads a JSDoc block (tsc copies it, and only it, into the
 * published `.d.ts`, so it is the editor hover) and runtime text: string and
 * template literals and JSX text, which become errors, log lines, UI copy and
 * conformance test titles. A `//` or `/* *\/` pointer stays ours (BP-006).
 * With `{ comments: "all" }`, for a file an adopter copies whole, every
 * comment counts. There is no allow-list: a real exception takes a reasoned
 * `eslint-disable-next-line`.
 */

import { neverPublish } from "../validate-publish-set.mjs";

/**
 * The one pattern: our Linear keys and our process ids. Every check that looks
 * for a tracker id imports it, so they cannot drift.
 */
export const TRACKER_ID = /\b(?:FIX|LAB|FLC|TL|BP|BR)-\d+\b/;

const SOURCE = "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}";

/**
 * The files the rule reads, derived from the publish set rather than listed:
 * every package's `src` except the ones `validate-publish-set.mjs` holds out,
 * plus the three roots that ship from outside `src`. A package that starts
 * publishing is covered with no edit here.
 */
export const SHIPPED_SOURCE = {
  files: [
    `packages/*/src/**/${SOURCE}`,
    `packages/shift-manager/cli/**/${SOURCE}`,
    `packages/cursor/runtime/**/${SOURCE}`,
    // `@flow-state-dev/devtool`'s `dist-client` is built from here.
    `apps/devtool/src/**/${SOURCE}`,
  ],
  ignores: neverPublish.map((dir) => `packages/${dir}/src/**`),
};

/** Files an adopter copies into their own repo whole, so every comment counts. */
export const COPIED_WHOLE = { files: [`packages/ui/registry/**/${SOURCE}`, `examples/**/${SOURCE}`] };

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Keep tracker and process ids out of what an adopter reads" },
    schema: [
      {
        type: "object",
        properties: { comments: { enum: ["jsdoc", "all"] } },
        additionalProperties: false,
      },
    ],
    messages: {
      id: "{{id}} in {{where}}. An adopter reads this: say what it does, and keep the pointer in a `//` comment.",
      copied: "{{id}} in {{where}}. An adopter copies this file whole, comments included: say what it does instead.",
    },
  },
  create(context) {
    const copied = context.options[0]?.comments === "all";
    const report = (node, text, where) => {
      const match = TRACKER_ID.exec(text);
      if (match) context.report({ loc: node.loc, messageId: copied ? "copied" : "id", data: { id: match[0], where } });
    };
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          // tsc keeps `/**` and `/*!` blocks in a `.d.ts`, so both are hovers.
          const jsdoc = comment.type === "Block" && /^[*!]/.test(comment.value);
          if (jsdoc) report(comment, comment.value, "a JSDoc block");
          else if (copied) report(comment, comment.value, "a comment");
        }
      },
      Literal(node) {
        if (typeof node.value === "string") report(node, node.value, "a string");
      },
      TemplateElement(node) {
        // The text an adopter reads: `\nFIX-1` raw has no word boundary before
        // `FIX`. `cooked` is null for an invalid escape in a tagged template.
        report(node, node.value.cooked ?? node.value.raw, "a template literal");
      },
      JSXText(node) {
        report(node, node.value, "JSX text");
      },
    };
  },
};

/** The plugin, registered as `fsd` in `eslint.config.mjs`. */
export default { rules: { "no-tracker-ids": rule } };
