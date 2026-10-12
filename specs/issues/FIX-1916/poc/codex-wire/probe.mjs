// FIX-1916 characterization POC: what the pinned Codex SDK's real CLI does on the
// three paths Codex mode rests on. Throwaway; retained as design evidence.
//
// It runs the real `codex` binary through the real `@openai/codex-sdk` (the version
// packages/codex pins), against a scripted Responses endpoint on 127.0.0.1, so it
// needs no API key and no network. Nothing reads ~/.codex: each run gets its own
// CODEX_HOME under a fresh temp directory.
//
// Run: pnpm install && node specs/issues/FIX-1916/poc/codex-wire/probe.mjs
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
// The SDK packages/codex pins, read from its own install (the package is ESM-only,
// so it is addressed by path rather than through require.resolve).
// CODEX_SDK_DIR points at another install, to ask the same questions of a newer release.
const sdkDir = process.env.CODEX_SDK_DIR ?? join(repo, "packages/codex/node_modules/@openai/codex-sdk");
const { Codex } = await import(pathToFileURL(join(sdkDir, "dist/index.js")).href);
const sdkVersion = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version;

// --- the scripted model -----------------------------------------------------
// Turn 1 of each thread: one `update_plan` call, as a Codex model plans. Then a reply.
let script = [];
const seenTools = [];
const toolOutputs = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // The CLI tries a websocket first and falls back to HTTP; refuse the upgrade.
    if (req.method !== "POST" || !req.url.endsWith("/responses")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const j = JSON.parse(body);
    seenTools.push((j.tools ?? []).map((t) => t.name ?? t.type));
    for (const i of j.input ?? []) {
      if (i.type === "function_call_output") toolOutputs.push(i.output);
    }
    const next = script.shift() ?? { type: "message", text: "done" };
    // A model that never answers: the turn stays in flight until the caller stops it.
    if (next.type === "hang") return;
    const id = `resp_${Math.random().toString(36).slice(2)}`;
    const item =
      next.type === "plan"
        ? {
            type: "function_call",
            call_id: `call_${id}`,
            name: "update_plan",
            arguments: JSON.stringify({ plan: next.plan }),
          }
        : {
            type: "message",
            role: "assistant",
            id: `msg_${id}`,
            content: [{ type: "output_text", text: next.text }],
          };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const e of [
      { type: "response.created", response: { id } },
      { type: "response.output_item.done", item },
      {
        type: "response.completed",
        response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      },
    ]) {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    }
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const root = mkdtempSync(join(tmpdir(), "fix-1916-codex-wire-"));
const home = mkdtempSync(join(root, "home-"));
const work = mkdtempSync(join(root, "work-"));
const codex = new Codex({
  env: { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: home },
  apiKey: "sk-scripted",
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
});
const threadOptions = {
  workingDirectory: work,
  skipGitRepoCheck: true,
  model: process.env.CODEX_MODEL ?? "gpt-5.4-codex",
};

async function turn(thread, prompt, { stopAfterTurnStarted = false } = {}) {
  const events = [];
  let threw = null;
  const stop = new AbortController();
  try {
    const { events: stream } = await thread.runStreamed(prompt, { signal: stop.signal });
    for await (const e of stream) {
      events.push(e);
      if (stopAfterTurnStarted && e.type === "turn.started") stop.abort();
    }
  } catch (err) {
    threw = String(err?.message ?? err);
  }
  return { events, threw };
}
const threadIds = (r) => r.events.filter((e) => e.type === "thread.started").map((e) => e.thread_id);
const todoEvents = (r) => r.events.filter((e) => e.item?.type === "todo_list");

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

// Leg A · a fresh thread names its id.
script = [
  { type: "plan", plan: [{ step: "Read the file", status: "in_progress" }, { step: "Append", status: "pending" }] },
  { type: "plan", plan: [{ step: "Read the file", status: "completed" }, { step: "Append", status: "in_progress" }] },
  { type: "message", text: "done" },
];
const first = await turn(codex.startThread(threadOptions), "plan the job and do it");
const [id] = threadIds(first);
check("A · a new thread names its id", typeof id === "string" && first.threw === null, { id, threw: first.threw });

// Leg B · a resumed turn names the SAME id again (so `onSession` fires on every continued turn).
script = [{ type: "message", text: "again" }];
const second = await turn(codex.resumeThread(id, threadOptions), "continue");
check("B · a resumed turn re-names the same id", JSON.stringify(threadIds(second)) === JSON.stringify([id]), {
  named: threadIds(second),
  threw: second.threw,
});

// Leg C · an id Codex does not have is REFUSED: the run throws and names no thread.
const unknown = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const refused = await turn(codex.resumeThread(unknown, threadOptions), "continue");
check(
  "C · an unknown id is refused, no thread named, no new thread started",
  refused.threw !== null && threadIds(refused).length === 0,
  { named: threadIds(refused), threw: refused.threw?.match(/thread\/resume failed[^\n]*/)?.[0] ?? refused.threw },
);

// Leg E · a turn stopped mid-run leaves the thread continuable under the same id.
script = [{ type: "hang" }];
const stopped = await turn(codex.resumeThread(id, threadOptions), "a long job", { stopAfterTurnStarted: true });
script = [{ type: "message", text: "after the stop" }];
const afterStop = await turn(codex.resumeThread(id, threadOptions), "continue");
check(
  "E · after a stop, the next turn continues the same id",
  stopped.threw !== null && JSON.stringify(threadIds(afterStop)) === JSON.stringify([id]) && afterStop.threw === null,
  { stoppedThrew: stopped.threw?.slice(0, 80), named: threadIds(afterStop), threw: afterStop.threw },
);

// Leg D · the to-do list. Does the model get a plan tool, and does a plan call surface?
const toolsTurn1 = seenTools[0] ?? [];
// Self-check first, so "no plan tool" below can't pass on an unread request.
check("D0 · the probe reads the offered tools (exec_command is among them)", toolsTurn1.includes("exec_command"), {
  tools: toolsTurn1,
});
check("D1 · Codex offers the model a plan tool (update_plan)", toolsTurn1.includes("update_plan"), {
  tools: toolsTurn1,
});
check("D2 · a scripted update_plan call surfaces as a todo_list item", todoEvents(first).length > 0, {
  todoEvents: todoEvents(first).length,
  whatTheCliAnsweredTheCall: toolOutputs.filter((o) => /update_plan/.test(String(o))).slice(0, 1),
});

server.close();
console.log(JSON.stringify({ sdkVersion, model: threadOptions.model, results }, null, 2));
