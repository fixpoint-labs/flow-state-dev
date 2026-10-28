#!/usr/bin/env node
/**
 * A stand-in `codex app-server` for the usage-read spec.
 *
 * Speaks newline-delimited JSON-RPC on stdio the way the pinned CLI does, for
 * the requests `readCodexUsage` and `listCodexModels` send. It refuses `account/read` until
 * `initialize` has been answered and `initialized` received, so a reader that
 * doesn't await the handshake fails here as it would on the real CLI.
 *
 * `FAKE_APP_SERVER_MODE` steers it: signed-in (default) · signed-out ·
 * api-key · bedrock · refuse-limits · hang · exit. `FAKE_RATE_LIMITS` is the
 * JSON `account/rateLimits/read` answers with when signed in. `FAKE_MODEL_PAGES`
 * is a JSON array of `model/list` answers, one per page, the cursor the index.
 * `FAKE_APP_SERVER_LOG` gets one line per start and per request.
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_APP_SERVER_MODE ?? "signed-in";
const log = process.env.FAKE_APP_SERVER_LOG;
const note = (line) => {
  if (log) appendFileSync(log, `${line}\n`);
};
note(`START ${process.argv.slice(2).join(" ")}`);
if (mode === "exit") process.exit(3);

const say = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
let initialized = false;

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const message = JSON.parse(line);
  note(`REQUEST ${message.method}`);
  if (mode === "hang") continue;
  if (message.method === "initialize") {
    say({ id: message.id, result: { userAgent: "fake" } });
    continue;
  }
  if (message.method === "initialized") {
    initialized = true;
    continue;
  }
  if (!initialized) {
    say({ id: message.id, error: { code: -32002, message: "Not initialized" } });
    continue;
  }
  if (message.method === "account/read") {
    const account =
      mode === "signed-out"
        ? null
        : mode === "api-key"
          ? { type: "apiKey" }
          : mode === "bedrock"
            ? { type: "amazonBedrock", usesCodexManagedCredentials: false }
            : { type: "chatgpt", email: "someone@example.com", planType: "pro" };
    say({ id: message.id, result: { account, requiresOpenaiAuth: true } });
    continue;
  }
  if (message.method === "account/rateLimits/read") {
    if (mode !== "signed-in") {
      say({ id: message.id, error: { code: -32600, message: "chatgpt authentication required to read rate limits" } });
      continue;
    }
    say({ id: message.id, result: JSON.parse(process.env.FAKE_RATE_LIMITS ?? "{}") });
    continue;
  }
  if (message.method === "model/list") {
    const pages = JSON.parse(process.env.FAKE_MODEL_PAGES ?? "[]");
    const page = pages[Number(message.params?.cursor ?? 0)];
    if (page === undefined) say({ id: message.id, error: { code: -32600, message: "no such page" } });
    else say({ id: message.id, result: page });
    continue;
  }
  say({ id: message.id, error: { code: -32601, message: "unknown method" } });
}
