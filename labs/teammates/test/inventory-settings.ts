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
   * where you are (`Address`), a teammate's look and its bot's state, the
   * page's theme, what the screen works out
   * from several reads (its status line, what it needs from you, what it
   * alerts on, a task's word), and a conversation drawn from its stored
   * items. A type that left the allowlist for this list names its reason
   * ({ name, reason }).
   */
  screenTypes: {
    "src/lib/address.ts": ["Address"],
    "src/lib/conversation.ts": [
      {
        name: "ConversationView",
        reason: "What the conversation's follower assembles from three reads: the session feed's items (as React's `conversationLines` reads them, with the turns), the session turns view's turns and the screen's own Stop.",
      },
      {
        name: "WindowMark",
        reason: "The divider: which line the worker's word-for-word window starts at, computed by `windowMarkOf` from the items, a turn's `historyStart` and the summary's mark.",
      },
    ],
    "src/lib/files.ts": [
      { name: "AppConnection", reason: "The page's own base path and fetch, which `fsdev dev` serves it with, for reading a line's files outside the client; no server read." },
    ],
    "src/lib/attention.ts": ["Alert", "TeammateAttention"],
    "src/lib/looks.ts": ["TeammateColor", "BotFace", "BotStatus", "Look"],
    "src/lib/status.ts": ["StatusInputs", "Status", "Need"],
    "src/lib/task-presentation.ts": ["TaskPresentation"],
    "src/lib/theme.ts": ["Theme"],
  },
};
