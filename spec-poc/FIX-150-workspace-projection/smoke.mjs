// Throwaway smoke test: can we reach a model through the SDK at all?
import { query } from "@anthropic-ai/claude-agent-sdk";

const t0 = Date.now();
try {
  for await (const m of query({
    prompt: "Reply with exactly the word: PONG",
    options: { maxTurns: 1, tools: [] },
  })) {
    console.log(JSON.stringify({ type: m.type, subtype: m.subtype ?? null }).slice(0, 200));
    if (m.type === "result") {
      console.log("RESULT:", JSON.stringify(m.result ?? m.subtype).slice(0, 300));
    }
  }
} catch (err) {
  console.log("ERROR:", err?.message?.slice(0, 500));
}
console.log("elapsed ms", Date.now() - t0);
