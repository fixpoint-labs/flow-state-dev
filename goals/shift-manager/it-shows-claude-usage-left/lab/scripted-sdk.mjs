/**
 * The Claude Code Agent SDK, scripted, loaded where `claudeCodeAgent` loads
 * the real one (the goal points `sdk-client.ts`'s module name here).
 *
 * A run is a `query` with a string prompt. Its prompt carries a tag,
 * `[[usage:<tag>]]`, and the setup file (`CLAUDE_USAGE_GOAL_SETUP`) says what
 * that run sends: the `rate_limit_event`s, each as the pinned CLI builds one
 * (FIX-2142's POC), and the account its `accountInfo()` names. Every run is
 * logged (`RUN <tag> <ms>`) so the check can see it started.
 *
 * A query with no prompt is the account probe. With `probe.mode` `real`, it
 * goes to the real SDK, so legs read the real `probeClaudeAccount` on an
 * empty home and on an API key; with `scripted`, it answers the setup's
 * account, standing in for a sign-in no check machine has.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const SETUP = process.env.CLAUDE_USAGE_GOAL_SETUP;
const setup = () => JSON.parse(readFileSync(SETUP, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function query(args) {
  const current = setup();
  if (typeof args.prompt !== "string") return probe(args, current.probe);
  const tag = /\[\[usage:([a-z0-9-]+)\]\]/.exec(args.prompt)?.[1] ?? "untagged";
  const script = current.runs?.[tag] ?? { events: [] };
  appendFileSync(current.log, `RUN ${tag} ${Date.now()}\n`);
  const sessionId = `sess-${tag}`;
  const messages = (async function* () {
    yield { type: "system", subtype: "init", session_id: sessionId };
    for (const event of script.events) {
      // Held until the check says go, so a look can land while the run is going.
      if (event.waitFor !== undefined) while (!existsSync(event.waitFor)) await sleep(100);
      yield { type: "rate_limit_event", session_id: sessionId, uuid: `${tag}-${Date.now()}`, rate_limit_info: event.info };
    }
    yield { type: "result", subtype: "success", is_error: false, result: `Answered ${tag}.`, session_id: sessionId };
  })();
  return Object.assign(messages, {
    async accountInfo() {
      if (script.accountDelayMs) await sleep(script.accountDelayMs);
      return script.account ?? {};
    },
    close() {},
  });
}

/** The account probe's idle query: the real SDK's, or the setup's account. */
function probe(args, how) {
  if (how?.mode === "real") {
    let real;
    const handle = import("@anthropic-ai/claude-agent-sdk").then((sdk) => (real = sdk.query(args)));
    return {
      accountInfo: () => handle.then((q) => q.accountInfo()),
      close: () => real?.close?.(),
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
  }
  return {
    accountInfo: async () => how?.account ?? {},
    close() {},
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
}
