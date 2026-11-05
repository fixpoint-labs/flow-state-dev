/**
 * POC, throwaway: the shape of the tracker-id rule this spec settles. Not
 * production code; the implementer writes the real rule against the code.
 *
 * Reports a tracker or process id in what an adopter reads: a JSDoc block (it
 * reaches the published .d.ts and every hover), a string or template literal,
 * and JSX text (runtime text: errors, logs, UI copy, conformance titles). With
 * `comments: "all"`, every comment counts, for files an adopter copies whole.
 */

export const TRACKER_ID = /\b(?:FIX|LAB|FLC|TL|BP|BR)-\d+\b/;

export const noTrackerIds = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { comments: { enum: ["jsdoc", "all"] } }, additionalProperties: false }],
    messages: {
      id: "{{id}} in {{where}}. An adopter reads this: name the behaviour or link the docs, and keep the pointer in a `//` comment.",
    },
  },
  create(context) {
    const all = context.options[0]?.comments === "all";
    const report = (node, text, where) => {
      const m = TRACKER_ID.exec(text);
      if (m) context.report({ loc: node.loc, messageId: "id", data: { id: m[0], where } });
    };
    return {
      Program() {
        for (const c of context.sourceCode.getAllComments()) {
          const jsdoc = c.type === "Block" && c.value.startsWith("*");
          if (jsdoc || all) report(c, c.value, jsdoc ? "a JSDoc block" : "a comment in a copied file");
        }
      },
      Literal(node) {
        if (typeof node.value === "string") report(node, node.value, "a string");
      },
      TemplateElement(node) {
        report(node, node.value.raw, "a template literal");
      },
      JSXText(node) {
        report(node, node.value, "JSX text");
      },
    };
  },
};

export default { rules: { "no-tracker-ids": noTrackerIds } };
