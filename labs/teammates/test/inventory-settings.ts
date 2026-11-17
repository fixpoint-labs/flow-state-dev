/**
 * The lab's settings for the shared inventory (`labs/test-support/inventory.ts`):
 * every rule, the files that go, what is left of its read model, and the
 * types its screen computes itself. `inventory.test.ts` runs them against
 * `inventory-allowlist.json`, which only shrinks.
 */
import type { AppInventory } from "../../test-support/inventory.ts";

export const teammates: AppInventory = {
  path: "labs/teammates",
  entry: "src/main.tsx",
  rules: ["L1", "L2", "L3", "L4", "H", "own sessions"],
  gone: ["src/adapter.ts", "test/fake-app.ts"],
  typesSkip: ["src/components/"],
  /** `src/app/` is the read model the screen still reaches the server through: no file there may grow, and a new one fails. */
  readModel: ["src/app/"],
  /**
   * The types the screen computes itself, by the module that exports them:
   * where you are (`Address`), a teammate's look, and what the screen works
   * out from several reads (its status line, what it needs from you, what
   * it alerts on, a task's word). Every type in `src/app/` stays on the
   * allowlist: it is the read model's, and goes with it. A type that leaves
   * the allowlist for this list names its reason ({ name, reason }).
   */
  screenTypes: {
    "src/lib/address.ts": ["Address"],
    "src/lib/attention.ts": ["Alert", "TeammateAttention"],
    "src/lib/looks.ts": ["TeammateColor", "Look"],
    "src/lib/status.ts": ["StatusInputs", "Status", "Need"],
    "src/lib/task-presentation.ts": ["TaskPresentation"],
  },
};
