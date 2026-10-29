/**
 * The Claude Code Agent SDK, scripted and paused mid-run, loaded where
 * `claudeCodeAgent` loads the real one (the goal points `sdk-client.ts`'s
 * module name here).
 *
 * A run is a `query` with a string prompt carrying a tag, `[[usage:<tag>]]`.
 * The setup file (`TASK_SPEND_GOAL_SETUP`) says what each attempt of that tag
 * sends: the init message's model, one assistant message per step with its
 * usage, and the result's whole-query `modelUsage`, answer and account.
 * Every run is logged (`RUN <tag> <ms>`), and its attempt is how many ran
 * before it. With `pause`, the run stops after the init message and after
 * each step (`pause()` in `pause.mjs`) until the check releases it.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { pause } from "./pause.mjs";

const SETUP = process.env.TASK_SPEND_GOAL_SETUP;
const setup = () => JSON.parse(readFileSync(SETUP, "utf8"));

export function query(args) {
  const current = setup();
  if (typeof args.prompt !== "string") throw new Error("this check probes no account");
  const tag = /\[\[usage:([a-z0-9-]+)\]\]/.exec(args.prompt)?.[1] ?? "untagged";
  const attempt = readFileSync(current.log, "utf8").split("\n").filter((line) => line.startsWith(`RUN ${tag} `)).length;
  appendFileSync(current.log, `RUN ${tag} ${Date.now()}\n`);
  const attempts = current.runs?.[tag] ?? [];
  const script = attempts[Math.min(attempt, attempts.length - 1)] ?? { answer: `Answered ${tag}.`, steps: [] };
  const sessionId = `sess-${tag}-${attempt + 1}`;
  const signal = args.options?.abortController?.signal;
  const stop = (n) => (script.pause === true ? pause(current, `${tag}-${attempt + 1}`, n, signal) : Promise.resolve());
  const messages = (async function* () {
    yield { type: "system", subtype: "init", session_id: sessionId, model: script.model ?? "claude-sonnet-4-5" };
    await stop(0);
    let n = 0;
    for (const step of script.steps ?? []) {
      n += 1;
      yield {
        type: "assistant",
        session_id: sessionId,
        message: {
          id: `msg-${tag}-${attempt + 1}-${n}`,
          content: [{ type: "text", text: `Step ${n}.` }],
          usage: { input_tokens: step.input, output_tokens: step.output },
        },
      };
      await stop(n);
    }
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: script.answer,
      session_id: sessionId,
      ...(script.modelUsage === undefined ? {} : { modelUsage: script.modelUsage }),
    };
  })();
  return Object.assign(messages, {
    async accountInfo() {
      return script.account ?? { email: "user@goal.test", subscriptionType: "max" };
    },
    close() {},
  });
}
