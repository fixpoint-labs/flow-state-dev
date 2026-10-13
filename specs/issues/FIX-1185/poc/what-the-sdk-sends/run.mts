/**
 * FIX-1185 POC · what the Agent SDK tells the agent process its system prompt is.
 *
 * Model-free and throwaway. It drives the real `query()` from
 * `@anthropic-ai/claude-agent-sdk` with three `systemPrompt` values, and swaps the
 * agent process for a stub (the SDK's own `spawnClaudeCodeProcess` hook) that
 * records the first control message the SDK writes, then exits. No model is
 * called and no credential is needed.
 *
 * The question: is the SDK path's prompt different from the CLI's before the
 * model sees anything? The CLI starts from Claude Code's own prompt. If the SDK,
 * given no prompt, sends an empty one, the two drivers differ at prompt
 * assembly, which is where FIX-1185's measurement put the cause (one added
 * instruction restored the plan-tool calls).
 *
 * Run:   pnpm tsx specs/issues/FIX-1185/poc/what-the-sdk-sends/run.mts
 * Needs: `pnpm install` (the SDK resolves through the `goals` workspace). Nothing else.
 * Seen:  SDK 0.3.234 on 2026-10-12 — omitted `[""]`, `""` `[""]`, preset `appendSystemPrompt` only.
 * Exit:  0 when the premise holds, 1 when it is refuted.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// This file sits outside every workspace package, so resolve the SDK the way the
// `goals` workspace (which depends on it) does. FIX1185_SDK overrides the path.
const sdkPath =
  process.env.FIX1185_SDK ??
  createRequire(new URL("../../../../../goals/package.json", import.meta.url)).resolve(
    "@anthropic-ai/claude-agent-sdk",
  );
const { query } = (await import(pathToFileURL(sdkPath).href)) as typeof import("@anthropic-ai/claude-agent-sdk");

// The stub agent process: write the first stdin line (the SDK's initialize
// request) to stderr, then exit without answering.
const STUB = `process.stdin.once("data", (b) => { process.stderr.write(String(b).split("\\n")[0]); process.exit(0); });`;

async function firstControlMessage(systemPrompt: unknown): Promise<Record<string, unknown>> {
  let captured = "";
  const q = query({
    prompt: "noop",
    options: {
      ...(systemPrompt === OMITTED ? {} : { systemPrompt: systemPrompt as never }),
      // Never executed: the stub below replaces the process. Set so the SDK does
      // not refuse to start on a host without its optional native binary.
      pathToClaudeCodeExecutable: process.execPath,
      spawnClaudeCodeProcess: (opts) => {
        const child = spawn(process.execPath, ["-e", STUB], { env: opts.env as NodeJS.ProcessEnv });
        child.stderr.on("data", (b) => (captured += String(b)));
        return child as never;
      },
    },
  });
  try {
    for await (const _ of q) break;
  } catch {
    // Expected: the stub exits instead of answering.
  }
  await new Promise((r) => setTimeout(r, 200));
  return JSON.parse(captured) as Record<string, unknown>;
}

const OMITTED = Symbol("omitted");
const arms: Array<[string, unknown]> = [
  ["omitted (today's default)", OMITTED],
  ['"" (explicit empty)', ""],
  ["preset claude_code + append", { type: "preset", preset: "claude_code", append: "Commit your work." }],
];

let refuted = false;
for (const [label, value] of arms) {
  const req = ((await firstControlMessage(value)).request ?? {}) as Record<string, unknown>;
  const shown = { systemPrompt: req.systemPrompt, appendSystemPrompt: req.appendSystemPrompt };
  console.log(`${label.padEnd(30)} -> ${JSON.stringify(shown)}`);
  if (value === OMITTED && JSON.stringify(req.systemPrompt) !== JSON.stringify([""])) refuted = true;
  if (typeof value === "object" && req.systemPrompt !== undefined) refuted = true;
}
console.log(
  refuted
    ? "REFUTED: the omitted arm does not send an empty prompt, or the preset arm sends a custom one"
    : "HOLDS: omitted sends an empty custom prompt; the preset sends none, so the agent process keeps Claude Code's own",
);
process.exit(refuted ? 1 : 0);
