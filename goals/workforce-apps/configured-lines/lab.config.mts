/**
 * The Lab both legs serve: the Teammates lab's own host (`labs/teammates/host.mts`)
 * on its own workers, with only the model scripted. Teammates serves it with `fsdev dev --config`, Shift
 * Manager with its command's `--config`, each on its own store.
 *
 * Chief of Staff's turn is picked by the line it is handed:
 *
 * - `MESSAGE`: sends researcher a message, whose answer comes back as one.
 * - `FILE`: files a task for researcher, which it does in words.
 * - `LOOK`: one tool call, a steps line.
 * - `FAIL`: the turn throws, a failed line.
 * - `HOLD`: waits until it is stopped, a stopped line.
 *
 * Researcher answers a message by sending one back, and does a task in words.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelResolver } from "@flow-state-dev/core/types";
import * as contractModule from "../../../labs/test-support/contract.ts";
import { openTeammates } from "../../../labs/teammates/host.mts";
import { ANSWER, ASK, CHIEF, RESEARCHER, TASK_GOAL } from "./ids.mts";

// fsdev loads its config with a cache-busting query, under which `contract.ts` (no package type
// near it) loads as CommonJS: its functions are then on the default export, not named ones.
const contract = ((contractModule as { default?: typeof contractModule }).default ?? contractModule) as typeof contractModule;
const { scriptedModels, waitFor } = contract;

const need = (key: string) => {
  const value = process.env[key];
  if (value === undefined || value === "") throw new Error(`configured-lines lab: ${key} is unset`);
  return value;
};

/** The last line the person sent, from a step's serialized messages, and whether this turn already called a tool. */
const lastAsk = (said: string) => {
  const asks = [...said.matchAll(/(MESSAGE|FILE|LOOK|FAIL|HOLD)-\d+/g)];
  const last = asks.at(-1);
  // The history holds earlier turns' tool results too: only one after the ask is this turn's.
  return { ask: last?.[1], called: last !== undefined && said.lastIndexOf('"role":"tool"') > (last.index ?? 0) };
};

const model = scriptedModels(
  {
    "agent-answer": async ({ said, signal }) => {
      if (/You are researcher[,.]/i.test(said)) {
        // A task's brief, from Chief of Staff's filing: done in words, which ends the task.
        if (said.includes(TASK_GOAL)) return { text: "Fixed the typo." };
        return said.includes('"role":"tool"') ? { text: "Answered." } : { call: { name: "sendMessage", args: { to: CHIEF, text: ANSWER } } };
      }
      // A message landing from researcher: a turn of its own, answered in words.
      if (said.lastIndexOf(ANSWER) > Math.max(...Object.values(ASK).map((a) => said.lastIndexOf(`${a}-`)))) return { text: "Thanks, noted." };
      const { ask, called } = lastAsk(said);
      if (ask === ASK.message) return !called ? { call: { name: "sendMessage", args: { to: RESEARCHER, text: "When is the launch?" } } } : { text: "Asked researcher." };
      if (ask === ASK.file) {
        return !called ? { call: { name: "createTask", args: { assignee: RESEARCHER, title: "Fix the README typo", goal: TASK_GOAL } } } : { text: "Filed it." };
      }
      if (ask === ASK.look) return !called ? { call: { name: "listRoutines", args: {} } } : { text: "No routines yet." };
      if (ask === ASK.fail) throw new Error("The model is unavailable.");
      if (ask === ASK.hold) {
        await waitFor(120_000, signal);
        throw new DOMException("The turn was stopped.", "AbortError");
      }
      return { text: "Noted." };
    },
    "memory/observe": () => ({ output: { items: [] } }),
  },
  () => ({ text: "ok" }),
) as ModelResolver;

const store = need("GOAL_STORE");
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: "test/scripted",
  userId: need("GOAL_USER"),
  workdir: need("GOAL_WORKDIR"),
  runsRoot: join(dirname(store), "runs"),
  modelResolver: model,
});
