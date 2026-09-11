/**
 * The companion extension, loaded into a spawned pi run via `pi -e`.
 *
 * Proves two things the epic's Kill line rests on:
 *   1. APPROVAL — a `tool_call` handler can block a tool on a REMOTE decision.
 *   2. ASK — a registered tool can suspend the run on a remote answer.
 *
 * Throwaway. No auth, no correlation, no liveness handling — those are exactly
 * the concerns the epic must own if this shape survives.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DIR = new URL("./mailbox/", import.meta.url).pathname;

async function callHost(kind: string, payload: unknown): Promise<any> {
  const { writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } =
    await import("node:fs");
  mkdirSync(DIR, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(`${DIR}${id}.req`, JSON.stringify({ kind, payload }));
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (existsSync(`${DIR}${id}.res`)) {
      const out = JSON.parse(readFileSync(`${DIR}${id}.res`, "utf8"));
      unlinkSync(`${DIR}${id}.res`);
      return out;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("host did not answer within 30s");
}

export default function (pi: ExtensionAPI) {
  // 1. Approval: block a tool call on a decision the host makes.
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;
    const verdict = await callHost("approval", {
      tool: event.toolName,
      input: event.input,
    });
    if (verdict.decision === "deny") {
      return { block: true, reason: verdict.message };
    }
    return undefined;
  });

  // 2. Spontaneous ask: a seam the run can reach for on its own.
  pi.registerTool({
    name: "flow_ask",
    label: "Ask the operator",
    description: "Ask the human operator a question and wait for their answer.",
    promptSnippet:
      "Ask the operator a blocking question and wait for the answer",
    parameters: Type.Object({
      question: Type.String({
        description: "The question to put to the operator",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = await callHost("ask", { question: params.question });
      return {
        content: [{ type: "text", text: String(result.answer) }],
        details: {},
      };
    },
  });
}
