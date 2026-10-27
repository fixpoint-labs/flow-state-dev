/**
 * The Claude Code Agent SDK, scripted, loaded where `claudeCodeAgent` loads
 * the real one (the goal points `sdk-client.ts`'s module name here).
 *
 * A run is a `query` with a string prompt. Its prompt carries a tag,
 * `[[usage:<tag>]]`, and the setup file (`WORKER_USAGE_GOAL_SETUP`) says what
 * each attempt of that tag sends: its answer, the usage and
 * `total_cost_usd` on its result message, and the account its
 * `accountInfo()` names. A run of the Error Reporter's draft (its prompt asks
 * for `stepsToReproduce`) is tagged `report` and answers a draft. Every run is
 * logged (`RUN <tag> <ms>`), and its attempt is how many ran before it.
 */
import { appendFileSync, readFileSync } from "node:fs";

const SETUP = process.env.WORKER_USAGE_GOAL_SETUP;
const setup = () => JSON.parse(readFileSync(SETUP, "utf8"));

const DRAFT = {
  title: "A task's run answers nothing",
  summary: "The coder's run ends with an empty answer on every attempt.",
  stepsToReproduce: ["File a task tagged h for the coder."],
  expected: "An answer.",
  actual: "An empty answer.",
  suspectedCause: "The scripted run.",
  questions: [],
};

export function query(args) {
  const current = setup();
  if (typeof args.prompt !== "string") throw new Error("this check probes no account");
  const tag = args.prompt.includes("stepsToReproduce")
    ? "report"
    : (/\[\[usage:([a-z0-9-]+)\]\]/.exec(args.prompt)?.[1] ?? "untagged");
  const attempt = readFileSync(current.log, "utf8").split("\n").filter((line) => line.startsWith(`RUN ${tag} `)).length;
  appendFileSync(current.log, `RUN ${tag} ${Date.now()}\n`);
  const attempts = current.runs?.[tag] ?? [];
  const script = attempts[Math.min(attempt, attempts.length - 1)] ?? { answer: `Answered ${tag}.` };
  const sessionId = `sess-${tag}-${attempt + 1}`;
  const answer = tag === "report" ? "```json\n" + JSON.stringify(DRAFT) + "\n```" : script.answer;
  const messages = (async function* () {
    yield { type: "system", subtype: "init", session_id: sessionId };
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: answer,
      session_id: sessionId,
      ...(script.usage === undefined ? {} : { usage: script.usage }),
      ...(script.costUsd === undefined ? {} : { total_cost_usd: script.costUsd }),
    };
  })();
  return Object.assign(messages, {
    async accountInfo() {
      return script.account ?? {};
    },
    close() {},
  });
}
