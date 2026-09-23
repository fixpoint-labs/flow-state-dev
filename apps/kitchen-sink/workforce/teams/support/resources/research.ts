/**
 * A capability the support team wrote, in the folder the team already keeps
 * its Markdown in.
 *
 * Nothing imports this file by hand. `fsdev gen` walks every `resources/`
 * folder in this tree, puts each TypeScript file on the generated
 * `resourceModules` map under the ref its path mints, and `hire.ts` hands the
 * capabilities half to the worker kind. Add a file, re-run the command, done.
 *
 * Neither preset is on by default, so a seat that says nothing carries nothing
 * from here — which is what makes the two seats beside it tell a story.
 */
import { defineCapability } from "@flow-state-dev/core";

export default defineCapability({
  name: "research",
  presets: {
    /** How the team says the desk is doing this week. */
    briefing: {
      context: [
        "This week's briefing: the desk is quiet, and two shipments are late.",
      ],
    },
    /** What the desk is allowed to sign off without asking. */
    ledger: {
      context: ["Signing limit: any refund up to 50 without a second pair of eyes."],
    },
    default: [],
  },
});
