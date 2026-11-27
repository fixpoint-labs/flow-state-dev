// FIX-2551.
/**
 * `fsd/one-coalescer`: one coalescer, in the client.
 *
 * Every screen kept current on change notices goes through the client's live
 * read (`client.live`), whose coalescer — one read in flight, at most one
 * waiting — lives in one file. A second copy is how the five that came before
 * it drifted: one missed a bare notice, one had no retry, one merged before it
 * filtered. The signature this rule reads is that coalescer's: a flag that
 * queues one more read, set to `true` (`queued = true`). The one file allowed
 * to set it is {@link COALESCER_HOME}; anything else calls `client.live`.
 */

/** The one file a coalescer may live in. */
export const COALESCER_HOME = "packages/client/src/live/coalesce.ts";

const SOURCE = "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}";

/** Where the rule reads: the shipped and app code a live screen is written in, never tests. */
export const LIVE_READ_SOURCE = {
  files: [`packages/*/src/**/${SOURCE}`, `labs/**/${SOURCE}`, `apps/**/${SOURCE}`, `examples/**/${SOURCE}`],
  ignores: [COALESCER_HOME, "**/test/**", "**/tests/**", "**/__tests__/**", `**/*.test.${SOURCE.slice(2)}`, `**/*.spec.${SOURCE.slice(2)}`],
};

/** The name a queued-read flag goes by. */
const QUEUED = /queued/i;

/** The name an assignment's target goes by: `queued`, `state.queued`, `this["queued"]`. */
function targetName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return undefined;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  return node.property.type === "Literal" && typeof node.property.value === "string" ? node.property.value : undefined;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Keep the one coalescer in the client: call client.live instead of queueing reads by hand" },
    schema: [],
    messages: {
      second:
        "A second coalescer: `{{name}} = true` queues a read by hand. Keep a screen current with `client.live` (one read in flight, one waiting, retry and filter included); the coalescer lives in " +
        COALESCER_HOME +
        " only.",
    },
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.right.type !== "Literal" || node.right.value !== true) return;
        const name = targetName(node.left);
        if (name !== undefined && QUEUED.test(name)) context.report({ node, messageId: "second", data: { name } });
      },
    };
  },
};

/** The rule, merged into the `fsd` plugin in `eslint.config.mjs`. */
export default { rules: { "one-coalescer": rule } };
