#!/usr/bin/env node
/**
 * A scripted `codex app-server` for legs a, d, e, g and h: newline-delimited
 * JSON-RPC on stdio, answering `initialize`, `account/read` and
 * `account/rateLimits/read` in the shape the pinned CLI's `generate-ts`
 * publishes (`@openai/codex` 0.152.1). What it answers is read from the setup
 * file the check writes before each leg (`USAGE_GOAL_SETUP`):
 *
 *   { "mode": "signed-in" | "api-key" | "hang", "rateLimits": <GetAccountRateLimitsResponse>, "log": <path> }
 *
 * Every start appends `START` to `log`, so a leg counts children.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const setup = JSON.parse(readFileSync(process.env.USAGE_GOAL_SETUP, "utf8"));
appendFileSync(setup.log, `START ${setup.mode}\n`);
const say = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
let initialized = false;

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "" || setup.mode === "hang") continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") say({ id: message.id, result: { userAgent: "scripted" } });
  else if (message.method === "initialized") initialized = true;
  else if (!initialized) say({ id: message.id, error: { code: -32002, message: "Not initialized" } });
  else if (message.method === "account/read") {
    const account = setup.mode === "api-key" ? { type: "apiKey" } : { type: "chatgpt", email: "goal@example.com", planType: "pro" };
    say({ id: message.id, result: { account, requiresOpenaiAuth: true } });
  } else if (message.method === "account/rateLimits/read") {
    if (setup.mode !== "signed-in") say({ id: message.id, error: { code: -32600, message: "chatgpt authentication required to read rate limits" } });
    else say({ id: message.id, result: setup.rateLimits });
  } else say({ id: message.id, error: { code: -32601, message: "unknown method" } });
}
