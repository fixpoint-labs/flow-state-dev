/**
 * The capability a team dropped into its own `resources/` folder.
 *
 * Nothing imports it by hand: `fsdev gen` walks the tree and writes it onto
 * `workforce.gen.ts` beside this folder, and the app hands the capabilities
 * half to the worker kind.
 *
 * Two presets, NEITHER on by default, each carrying a fact that appears
 * nowhere else in the tree. A seat only knows a fact if its own file asked for
 * the preset that carries it.
 */
import { defineCapability } from "@flow-state-dev/core";

export default defineCapability({
  name: "research",
  presets: {
    briefing: {
      context: ["This week's desk code is LANTERN-2208. Say it when you are asked for it."],
    },
    ledger: {
      context: ["The signing limit reference is THISTLE-6194. Say it when you are asked for it."],
    },
    default: [],
  },
});
