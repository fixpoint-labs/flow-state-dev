/**
 * A local stand-in for an OpenAI-compatible model endpoint, for the adopter
 * goal's First hour leg. The leg points `OPENAI_BASE_URL` at it with a
 * placeholder `OPENAI_API_KEY`, so a reader's code runs its real generator path
 * (the installed `@ai-sdk/openai`, the framework's model resolver, streaming)
 * without a key or a network call. Every turn answers {@link STUB_ANSWER}.
 *
 * Serves the Responses API (`POST /v1/responses`, which `@ai-sdk/openai` calls
 * by default) and Chat Completions (`POST /v1/chat/completions`), each
 * streamed or not, as the request asks. Anything else is a 404.
 *
 * Run as a process: `node stub-model.mjs <port-file>` listens on a free port
 * on 127.0.0.1, writes `http://127.0.0.1:<port>/v1` to `<port-file>`, and
 * appends one line per request served to `<port-file>.log`. It runs until
 * killed.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** The text every stubbed turn answers. The leg looks for it in the run's output. */
export const STUB_ANSWER = "Hello from the stub model.";

const usage = { input_tokens: 5, output_tokens: 6, total_tokens: 11 };

/** Serve one request. */
export function handle(req, res, onServed = () => {}) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {}
    const model = parsed.model ?? "stub";
    const stream = parsed.stream === true;
    const path = (req.url ?? "").replace(/\?.*$/, "");
    if (req.method === "POST" && path.endsWith("/responses")) {
      onServed(`${path} stream=${stream}`);
      return stream ? responsesStream(res, model) : json(res, responsesBody(model));
    }
    if (req.method === "POST" && path.endsWith("/chat/completions")) {
      onServed(`${path} stream=${stream}`);
      return stream ? chatStream(res, model) : json(res, chatBody(model));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `stub-model serves no ${req.method} ${path}` } }));
  });
}

function json(res, value) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end("data: [DONE]\n\n");
}

const now = () => Math.floor(Date.now() / 1000);

function responsesBody(model) {
  return {
    id: "resp_stub",
    object: "response",
    created_at: now(),
    model,
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_stub",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: STUB_ANSWER, annotations: [] }],
      },
    ],
    usage,
  };
}

function responsesStream(res, model) {
  const response = { id: "resp_stub", created_at: now(), model };
  const item = { type: "message", id: "msg_stub", role: "assistant", status: "in_progress", content: [] };
  sse(res, [
    { type: "response.created", response },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_text.delta", item_id: "msg_stub", output_index: 0, content_index: 0, delta: STUB_ANSWER },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { ...item, status: "completed", content: [{ type: "output_text", text: STUB_ANSWER, annotations: [] }] },
    },
    { type: "response.completed", response: { ...response, status: "completed", usage } },
  ]);
}

function chatBody(model) {
  return {
    id: "chatcmpl_stub",
    object: "chat.completion",
    created: now(),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: STUB_ANSWER }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
  };
}

function chatStream(res, model) {
  const base = { id: "chatcmpl_stub", object: "chat.completion.chunk", created: now(), model };
  sse(res, [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: STUB_ANSWER }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } },
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const portFile = process.argv[2];
  if (!portFile) throw new Error("usage: node stub-model.mjs <port-file>");
  const server = createServer((req, res) => handle(req, res, (line) => appendFileSync(`${portFile}.log`, `${line}\n`)));
  server.listen(0, "127.0.0.1", () => {
    writeFileSync(portFile, `http://127.0.0.1:${server.address().port}/v1`);
  });
}
