/**
 * Mechanics probe — no LLM required.
 *
 * Answers two questions the epic's Kill line rests on, without needing a model
 * call (the authoring sandbox has no outbound network):
 *   1. Does an extension loaded via `-e` in `--mode json` actually register a
 *      tool, so a spawned run could call it?
 *   2. Can an extension handler BLOCK on a remote answer — i.e. does pi await an
 *      async handler across a multi-second round trip to the host?
 *
 * Writes findings to probe-result.json.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DIR = new URL("./mailbox/", import.meta.url).pathname;
const OUT = new URL("./probe-result.json", import.meta.url).pathname;

async function callHost(kind: string, payload: unknown): Promise<any> {
  const { writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } =
    await import("node:fs");
  mkdirSync(DIR, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(`${DIR}${id}.req`, JSON.stringify({ kind, payload }));
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (existsSync(`${DIR}${id}.res`)) {
      const raw = readFileSync(`${DIR}${id}.res`, "utf8");
      unlinkSync(`${DIR}${id}.res`);
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`host wrote a malformed answer: ${raw.slice(0, 120)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("host did not answer within 20s");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "flow_ask",
    label: "Ask the operator",
    description: "Ask the human operator a question and wait for their answer.",
    parameters: Type.Object({ question: Type.String() }),
    async execute(_id, params) {
      const r = await callHost("ask", { question: params.question });
      return {
        content: [{ type: "text", text: String(r.answer) }],
        details: {},
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const { writeFileSync } = await import("node:fs");
    const findings: Record<string, unknown> = {
      mode: ctx.mode,
      hasUI: ctx.hasUI,
    };

    // 1. Is the tool actually registered and visible to the run?
    const all = pi.getAllTools().map((t) => t.name);
    findings.toolRegistered = all.includes("flow_ask");
    findings.toolCount = all.length;

    // 2. Does pi await a handler across a slow remote round trip?
    const t0 = Date.now();
    try {
      const answer = await callHost("ask", {
        question: "probe: blocking round trip",
      });
      findings.blockingRoundTrip = {
        ok: true,
        elapsedMs: Date.now() - t0,
        answer,
      };
    } catch (error) {
      findings.blockingRoundTrip = { ok: false, error: String(error) };
    }

    writeFileSync(OUT, JSON.stringify(findings, null, 2));
  });
}
