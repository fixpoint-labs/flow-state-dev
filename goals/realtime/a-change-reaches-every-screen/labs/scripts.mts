/**
 * The scripted model both labs' configs answer on (`labs/test-support`'s
 * `scriptedModels`, as the labs' contract tests use it). Only the model is
 * scripted: every tool runs for real, and a coding task runs on
 * harness-manager's scripted coder.
 *
 * The lead's turn is picked by the last line it was handed:
 *
 * - `SAY-<tag>`: answers `answer <tag>` at once.
 * - `HOLD-<tag>`: waits `GOAL_HOLD_MS` (default 2500), then answers `held <tag>`.
 * - `FILE-<tag>`: files a task `Task <tag>` for `coder`, then answers `filed <tag>`.
 *
 * Anything else (a task's result, a memory read) answers in a word. The goal
 * judge that reads each coding run says it is done, as the labs' tests' judge does.
 */
import type { ModelResolver } from "@flow-state-dev/core/types";
import { GOAL_JUDGE_QUESTION, GOAL_JUDGE_WHY_QUESTION } from "@flow-state-dev/harness-manager";
import * as contractModule from "../../../../labs/test-support/contract.ts";

// fsdev loads its config with a cache-busting query, under which `contract.ts` (no package type
// near it) loads as CommonJS: its functions are then on the default export, not named ones.
const contract = ((contractModule as { default?: typeof contractModule }).default ?? contractModule) as typeof contractModule;
const { scriptedModels, waitFor } = contract;

const HOLD_MS = Number(process.env.GOAL_HOLD_MS ?? 2_500);

/** The last line the lead was handed, and whether this turn already called a tool after it. */
function lastAsk(said: string): { kind?: string; tag?: string; called: boolean } {
  const last = [...said.matchAll(/(SAY|HOLD|FILE)-([A-Za-z0-9]+)/g)].at(-1);
  // The history holds earlier turns' tool results too: only one after the ask is this turn's.
  return { kind: last?.[1], tag: last?.[2], called: last !== undefined && said.lastIndexOf('"role":"tool"') > (last.index ?? 0) };
}

/** An evaluation model that gives harness-manager's goal judge a confident "done" on every run. */
const doneJudge = {
  specificationVersion: "v4",
  provider: "test",
  modelId: "test/judge",
  supportedQuestionTypes: ["choice", "score", "boolean"],
  async doEvaluate() {
    return {
      answers: { [GOAL_JUDGE_QUESTION]: { type: "choice", choice: "done" }, [GOAL_JUDGE_WHY_QUESTION]: { type: "choice", choice: "off-target" } },
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
      providerMetadata: { typesafe: { confidence: { [GOAL_JUDGE_QUESTION]: 0.99 } } },
    };
  },
};

/** The resolver: `lead` picks the lead's steps out of every worker's, `coder` is who its tasks go to. */
export function labModels(lead: RegExp, coder: string, extra: Parameters<typeof scriptedModels>[0] = {}): ModelResolver {
  const resolver = scriptedModels(
    {
      "agent-answer": async ({ said, signal }) => {
        if (!lead.test(said)) return { text: "Done." };
        const { kind, tag, called } = lastAsk(said);
        if (kind === "SAY") return { text: `answer ${tag}` };
        if (kind === "HOLD") {
          await waitFor(HOLD_MS, signal);
          if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
          return { text: `held ${tag}` };
        }
        if (kind === "FILE") return called ? { text: `filed ${tag}` } : { call: { name: "createTask", args: { assignee: coder, title: `Task ${tag}`, goal: `Note ${tag} in NOTES.md.` } } };
        return { text: "Noted." };
      },
      "memory/observe": () => ({ output: { items: [] } }),
      ...extra,
    },
    () => ({ text: "ok" }),
  ) as ModelResolver;
  return Object.assign(resolver, { resolveEvaluationModel: () => doneJudge }) as ModelResolver;
}
