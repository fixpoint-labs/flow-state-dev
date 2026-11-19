/**
 * The lab's settings for the shared inventory (`labs/test-support/inventory.mts`):
 * every rule, the files that go, what is left of its read model, and the
 * types its screen computes itself. `inventory.test.ts` runs them against
 * `inventory-allowlist.json`, which only shrinks.
 */
import type { AppInventory } from "../../test-support/inventory.mts";

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
   * where you are (`Address`), a teammate's look, what the screen works out
   * from several reads (its status line, what it needs from you, what it
   * alerts on, a task's word), and a conversation drawn from its stored
   * items. A type that left the allowlist for this list names its reason
   * ({ name, reason }).
   */
  screenTypes: {
    "src/lib/address.ts": ["Address"],
    "src/lib/conversation.ts": [
      {
        name: "ConversationEntry",
        reason: "One line the conversation draws, worked out by `toEntries` from the session's stored items and its turns; no view returns it.",
      },
      {
        name: "ConversationView",
        reason: "What the conversation's follower assembles from three reads: the session feed's items, the session turns view's rows and the screen's own Stop.",
      },
      {
        name: "WindowMark",
        reason: "The divider: which drawn entry the worker's word-for-word window starts at, computed by `windowMarkOf` from the items, a turn's `historyStart` and the summary's mark.",
      },
    ],
    "src/lib/files.ts": [
      { name: "AppConnection", reason: "The page's own base path and fetch, which `fsdev dev` serves it with, for reading a line's files outside the client; no server read." },
    ],
    "src/lib/items.ts": [
      { name: "Item", reason: "A stored item read loosely, as the screen's pure reads take one: each read checks the fields it uses, as Claude Code-style's `Item` does." },
    ],
    "src/lib/steps.ts": [
      { name: "SessionStep", reason: "One step of a session as a popup or a run line draws it, worked out by `toSteps` and `toolStep` from its stored items." },
      { name: "StepRun", reason: "A run of a turn's tool calls in a row, summed up as one line (`stepRun`) in the UI registry's words; computed, not read." },
      { name: "RunSummary", reason: "What a run's summary line says (files touched, commands run, time), passed to `runSummaryLine`; computed from its steps." },
    ],
    "src/lib/attention.ts": ["Alert", "TeammateAttention"],
    "src/lib/looks.ts": ["TeammateColor", "Look"],
    "src/lib/status.ts": ["StatusInputs", "Status", "Need"],
    "src/lib/task-presentation.ts": ["TaskPresentation"],
  },
};
