/**
 * A long conversation with a worker keeps its early turns: once turns are about to
 * leave the history window, the built-in worker flow folds them into a running
 * summary the worker reads with the turns after it. On by default, for every
 * worker, with no app wiring.
 *
 * Why it matters: past the window, the oldest turns drop out of what the model
 * is sent, and a decision made at the start of a conversation is forgotten.
 * These pin that the default folds; that a worker can turn it off in one line
 * (and then pays no summary call); that `defaults: false` turns it off with the
 * rest; that an app bringing its own summary gets exactly one, its own; and
 * that the fold runs on the worker's own model.
 *
 * Asserted on which model calls ran and what the answering model was sent,
 * never on the summary's words beyond the scripted marker.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, utility } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";

const WORKER = "support.desk";
const WINDOW = 4;
/** Enough turns that the oldest have been folded before the last answer. */
const TURNS = 7;
const SUMMARY = "SUMMARY-MARKER: the user chose plan B.";
const APP_SUMMARY = "APP-SUMMARY-MARKER: the user chose plan B.";

type Call = { input: unknown; model: string; blockName?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: { text?: string }) => c.text ?? "").join("");
  return JSON.stringify(content);
}

/** The system text and the user turns the answering model was sent on its last call. */
function lastAnswer(calls: Call[]) {
  const messages = calls.at(-1)!.input as Array<{ role: string; content: unknown }>;
  return {
    system: messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n"),
    users: messages.filter((m) => m.role === "user").map((m) => textOf(m.content))
  };
}

/**
 * One worker, with a history window of {@link WINDOW} turns, talked to for
 * {@link TURNS} turns in one conversation. Unmocked generators refuse to run,
 * so a summary call nobody scripted fails the turn.
 */
async function talk(options: {
  declared?: Record<string, unknown>;
  flow?: ReturnType<typeof defineAgentWorkerFlow>;
}) {
  const [minted] = mintWorkers([{ id: WORKER, declared: options.declared ?? {}, body: "You help." }], {
    workerFlows: options.flow === undefined ? {} : { [AGENT_FLOW]: options.flow }
  });
  const worker: FlowInstance = {
    ...minted!,
    session: { ...(minted!.session ?? {}), historyWindow: { turns: WINDOW } }
  } as FlowInstance;
  const answer = mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "noted" } }] });
  const summary = mockGenerator({
    name: "earlier-turns",
    script: [{ when: () => true, then: { structuredOutput: { summary: SUMMARY } } }]
  });
  const appSummary = mockGenerator({
    name: "app-earlier-turns",
    script: [{ when: () => true, then: { structuredOutput: { summary: APP_SUMMARY } } }]
  });
  const state = createFlowState({
    flows: [worker],
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": answer, "earlier-turns": summary, "app-earlier-turns": appSummary },
      policy: "error"
    })
  });
  try {
    const runtime = await state.getRuntime();
    for (let n = 1; n <= TURNS; n++) {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: worker,
        actionName: "respond",
        input: { message: `u${n}` },
        userId: "u_person",
        sessionId: "long-talk",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeUndefined();
      // Distinct start times, so the window's order is the order spoken.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  } finally {
    await state.dispose();
  }
  return {
    answers: answer.calls as Call[],
    summaries: summary.calls as Call[],
    appSummaries: appSummary.calls as Call[]
  };
}

describe("a worker's history summary", () => {
  it("folds older turns into a summary the worker reads, with no switch set and no app wiring", async () => {
    const { answers, summaries } = await talk({});

    expect(summaries.length).toBeGreaterThan(0);
    const { system, users } = lastAnswer(answers);
    expect(system).toContain("<earlier-conversation>");
    expect(system).toContain(SUMMARY);
    // The summary stands for the turns before its mark: they are not read twice.
    expect(users).not.toContain("u1");
    expect(users.at(-1)).toBe(`u${TURNS}`);
  });

  it("runs the fold on the worker's own model", async () => {
    const { summaries } = await talk({ declared: { model: "test/worker-own-model" } });

    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((call) => call.model === "test/worker-own-model")).toBe(true);
  });

  it("makes no summary call and adds no summary for a worker with `defaults: { historySummary: false }`", async () => {
    const { answers, summaries } = await talk({ declared: { defaults: { historySummary: false } } });

    expect(summaries).toHaveLength(0);
    const { system, users } = lastAnswer(answers);
    expect(system).not.toContain("<earlier-conversation>");
    // The window, as before: the oldest turns are gone, the last ones are read.
    expect(users).not.toContain("u1");
    expect(users.at(-1)).toBe(`u${TURNS}`);
  });

  it("is off, with every other default, for a worker with `defaults: false`", async () => {
    const { answers, summaries } = await talk({ declared: { defaults: false } });

    expect(summaries).toHaveLength(0);
    expect(lastAnswer(answers).system).not.toContain("<earlier-conversation>");
  });

  it("steps aside for a summary the app brings: one summary, the app's", async () => {
    const earlier = utility.historySummary({
      summarize: utility.summarizer({ name: "app-earlier-turns", model: "test/app-summary-model" })
    });
    const flow = defineAgentWorkerFlow({ uses: [earlier.capability], beforeAnswer: earlier.fold });

    const { answers, summaries, appSummaries } = await talk({ flow });

    expect(summaries).toHaveLength(0);
    expect(appSummaries.length).toBeGreaterThan(0);
    const { system } = lastAnswer(answers);
    expect(system.split("<earlier-conversation>")).toHaveLength(2);
    expect(system).toContain(APP_SUMMARY);
  });
});
