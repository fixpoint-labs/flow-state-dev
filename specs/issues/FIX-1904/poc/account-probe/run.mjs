/**
 * V1 premise check for FIX-1904 D1 (shared with FIX-1915): can the Agent SDK say whether a
 * Claude Code account is in reach, without a model turn, in a second or two?
 *
 * Opens a streaming-input `query()` whose input never yields (so no user message is sent and no
 * turn starts), asks `accountInfo()`, then closes. Prints, per case, the wall time, which
 * credential fields came back, and every message the query emitted (expected: none).
 *
 * Run from a folder where `@anthropic-ai/claude-agent-sdk` resolves:
 *   node run.mjs                 # empty home, fake API key, fake OAuth token, this home
 * Retained evidence; not part of any test run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

async function probe(env, timeoutMs = 15000) {
  let release;
  const hold = new Promise((r) => (release = r));
  async function* input() { await hold; }
  const t0 = Date.now();
  const q = query({ prompt: input(), options: { env, settingSources: [] } });
  const messages = [];
  const drain = (async () => {
    try { for await (const m of q) messages.push(m.type); } catch (e) { messages.push(`error: ${e.message}`); }
  })();
  let result;
  try {
    const info = await Promise.race([
      q.accountInfo(),
      new Promise((_, j) => setTimeout(() => j(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)),
    ]);
    result = { fields: Object.keys(info).sort(), apiKeySource: info.apiKeySource ?? null, tokenSource: info.tokenSource ?? null };
  } catch (e) {
    result = { error: e.message };
  }
  const ms = Date.now() - t0;
  release();
  q.close?.();
  await Promise.race([drain, new Promise((r) => setTimeout(r, 2000))]);
  return { ms, ...result, messages };
}

const empty = mkdtempSync(join(tmpdir(), "v1-home-"));
const base = { PATH: process.env.PATH };
const cases = {
  "empty home, no variable": { ...base, HOME: empty },
  "empty home, ANTHROPIC_API_KEY (fake)": { ...base, HOME: empty, ANTHROPIC_API_KEY: "sk-ant-api03-not-a-real-key" },
  "empty home, CLAUDE_CODE_OAUTH_TOKEN (fake)": { ...base, HOME: empty, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-not-real" },
  "this machine's home": { ...base, HOME: process.env.HOME },
};
for (const [label, env] of Object.entries(cases)) console.log(JSON.stringify({ label, ...(await probe(env)) }));
process.exit(0);
