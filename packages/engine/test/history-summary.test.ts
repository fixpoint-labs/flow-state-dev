/**
 * Core's `historySummary` running on the engine (FIX-1613): a conversation past
 * its history window still reaches the turns that left it, through a running
 * summary the fold step writes before the answer and the capability hands the
 * answering generator.
 *
 * The summarize block here is a handler that folds deterministically, so each
 * assertion names exactly which turns are in the summary and which the model
 * reads word for word. The real-model proof is the goal check.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer, utility } from "@flow-state-dev/core";
import type { GeneratorModel, LLMMessage } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";
import type { StoreRegistry } from "../src/stores/types";

type ModelCall = { messages: LLMMessage[] };

function recordingResolver(calls: ModelCall[]) {
  const resolver = ((modelId: string) =>
    ({
      modelId,
      async generate(options: { messages: LLMMessage[] }) {
        calls.push({ messages: options.messages });
        return { text: `answer ${calls.length}` };
      }
    }) as unknown as GeneratorModel) as ((modelId: string) => GeneratorModel) & { resolveId: (id: string) => string };
  resolver.resolveId = (id) => id;
  return resolver;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: { text?: string }) => c.text ?? "").join("");
  return JSON.stringify(content);
}

/** Folds each turn's user words into the summary: "u1 u2 …". */
function foldingSummarize(options: { failTimes?: number } = {}) {
  let failuresLeft = options.failTimes ?? 0;
  return handler({
    name: "earlier-turns",
    inputSchema: z.object({ summary: z.string().nullable(), turns: z.array(z.any()) }),
    outputSchema: z.object({ summary: z.string() }),
    execute: ({ summary, turns }) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("summary model unavailable");
      }
      const said = (turns as LLMMessage[]).filter((m) => m.role === "user").map((m) => textOf(m.content));
      return { summary: [summary, ...said].filter((part) => part !== null && part !== "").join(" ") };
    }
  });
}

function chatFlow(options: { window: number; summarize?: ReturnType<typeof foldingSummarize>; withFold?: boolean }) {
  const earlier = options.summarize ? utility.historySummary({ summarize: options.summarize }) : undefined;
  const answer = generator({
    name: "answer",
    model: "mock",
    prompt: "You answer.",
    history: true,
    ...(earlier ? { uses: [earlier.capability] } : {})
  });
  const base = sequencer({ name: "chat", inputSchema: z.string() });
  const block = earlier && options.withFold !== false ? base.tap(earlier.fold).step(answer) : base.step(answer);
  return defineFlow({
    kind: "summary-chat",
    session: { historyWindow: { turns: options.window } },
    actions: { run: { inputSchema: z.string(), block, userMessage: (input: string) => input } }
  })();
}

async function talk(stores: StoreRegistry, flow: ReturnType<typeof chatFlow>, calls: ModelCall[], turns: number, from = 1) {
  const results = [];
  for (let n = from; n < from + turns; n++) {
    results.push(
      await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: `u${n}`,
        requestId: `req_${String(n).padStart(3, "0")}`,
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: { modelResolver: recordingResolver(calls) }
      })
    );
    // Distinct start times, so the window's order is the order spoken.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return results;
}

function lastInput(calls: ModelCall[]) {
  const messages = calls.at(-1)!.messages;
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const users = messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
  return { system, users };
}

describe("historySummary on the engine", () => {
  it("keeps turns that left the window in a summary the model reads, and reads only the turns after it", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    await talk(stores, chatFlow({ window: 4, summarize: foldingSummarize() }), calls, 7);

    // Turn 7: the window holds turns 3–6. A turn is folded the turn before it
    // would leave, so turns 1–3 are in the summary and only 4–6 are read word
    // for word.
    const { system, users } = lastInput(calls);
    expect(system).toContain("<earlier-conversation>\nu1 u2 u3\n</earlier-conversation>");
    expect(users).toEqual(["u4", "u5", "u6", "u7"]);
  });

  it("changes nothing for a flow without it", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    await talk(stores, chatFlow({ window: 4 }), calls, 7);

    const { system, users } = lastInput(calls);
    expect(system).not.toContain("earlier-conversation");
    expect(users).toEqual(["u3", "u4", "u5", "u6", "u7"]);
  });

  it("goes on through a failed summary and folds the turn on the next one, before it leaves", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    const results = await talk(stores, chatFlow({ window: 8, summarize: foldingSummarize({ failTimes: 1 }) }), calls, 10);

    // An 8-turn window folds two turns at a time, starting while the oldest
    // has two turns left. Turn 8's fold failed and the turn still answered;
    // turn 9 folded turns 1–2 before turn 1 left, turn 10 folded 3–4.
    expect(results.map((r) => r.error)).toEqual(Array(10).fill(undefined));
    const { system, users } = lastInput(calls);
    expect(system).toContain("<earlier-conversation>\nu1 u2 u3 u4\n</earlier-conversation>");
    expect(users).toEqual(["u5", "u6", "u7", "u8", "u9", "u10"]);
  });

  it("keeps answering when the summary keeps failing, and says turns were lost", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    const results = await talk(stores, chatFlow({ window: 4, summarize: foldingSummarize({ failTimes: 100 }) }), calls, 7);

    // Every turn completed; turn 1 left the window unsummarized, so the
    // summary says it can never be complete again.
    expect(results.map((r) => r.error)).toEqual(Array(7).fill(undefined));
    const row = await stores.resourceState.get("session", "s", "historySummary");
    expect(row?.state).toMatchObject({ summary: null, folds: 0, gap: true, complete: false });
  });

  it("discards its fold when another turn of the conversation folded first", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    // While this turn summarizes, another turn's fold commits: it adds turns
    // the summary holds without moving the mark.
    const racing = handler({
      name: "earlier-turns",
      inputSchema: z.object({ summary: z.string().nullable(), turns: z.array(z.any()) }),
      outputSchema: z.object({ summary: z.string() }),
      execute: async (_input, ctx) => {
        await (ctx.resources as any).historySummary.updateState((state: any) => ({
          ...state,
          summary: "the other turn's summary",
          folds: state.folds + 1
        }));
        return { summary: "this turn's stale summary" };
      }
    });
    await talk(stores, chatFlow({ window: 4, summarize: racing as never }), calls, 5);

    const row = await stores.resourceState.get("session", "s", "historySummary");
    expect(row?.state).toMatchObject({ summary: "the other turn's summary", folds: 1, throughRequestId: null });
  });

  it("keeps a turn that had not settled by id and folds it once it does, never twice", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    const flow = chatFlow({ window: 4, summarize: foldingSummarize() });
    await talk(stores, flow, calls, 3);

    // A turn waiting on an approval, started after turn 3.
    const third = (await stores.request.get("req_003"))!;
    const waiting = { ...third, id: "req_wait", status: "suspended" as const, startedAtMs: third.startedAtMs + 1, items: [] };
    await stores.request.set("req_wait", waiting, "any");
    await new Promise((resolve) => setTimeout(resolve, 2));

    await talk(stores, flow, calls, 5, 4);
    // An open turn counts toward the window's fill, so folding starts a turn
    // sooner. Turn 7 reached the waiting turn and moved past it, keeping it by
    // id; turn 8 folded turn 4 after it.
    expect(lastInput(calls).system).toContain("<earlier-conversation>\nu1 u2 u3 u4\n</earlier-conversation>");

    // It settles; the next turn folds it before folding turn 4.
    const userItem = (third.items ?? []).find((i) => i.type === "message" && (i as { role?: string }).role === "user")!;
    await stores.request.set(
      "req_wait",
      {
        ...waiting,
        status: "completed",
        items: [{ ...userItem, id: "wait_msg", requestId: "req_wait", content: [{ type: "output_text", text: "ux" }] } as never]
      },
      "any"
    );
    await talk(stores, flow, calls, 1, 9);

    expect(lastInput(calls).system).toContain("<earlier-conversation>\nu1 u2 u3 u4 ux u5\n</earlier-conversation>");
  });

  it("refuses to run quietly without its fold step once a turn has left the window", async () => {
    const stores = createInMemoryStores();
    const calls: ModelCall[] = [];
    const results = await talk(stores, chatFlow({ window: 4, summarize: foldingSummarize(), withFold: false }), calls, 6);

    expect(results.slice(0, 5).map((r) => r.error)).toEqual(Array(5).fill(undefined));
    expect(results[5]!.error?.message).toMatch(/no fold has run/);
  });
});
