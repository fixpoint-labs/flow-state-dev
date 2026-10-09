/**
 * A follow-up keeps its conversation: best fit chooses a delegate with the
 * conversation's recent lines in view, not the post alone, and the delegate
 * that takes a post is shown those lines with it, for that turn only.
 *
 * The delegates are `agent` workers, or workers on an app's own flow whose
 * generator has the delegated-post capability, so what is graded is what
 * their model was handed and what landed in the person's conversation. The
 * models are scripted, and answer only from what they are handed:
 *
 * - best fit's evaluation: a post marked `[follow-up]` goes to whichever
 *   delegate spoke last in the recent lines it was handed; anything else to
 *   the delegate its first `[route:<worker>]` mark names. On its words alone a
 *   follow-up below names another delegate, so the lines decide it.
 * - a delegate's turn: a `[where]` post is answered by naming the `item-…` it
 *   finds in the context it was shown, or `Buy what?` when it finds none;
 *   anything else is acknowledged under the worker's name.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, generator } from "@flow-state-dev/core";
import type { SessionItem } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep
} from "@flow-state-dev/testing";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { DELEGATED_POST_ENTRY } from "../src/coordinator/coordinator-keys";
import { RECENT_CHARS, RECENT_LINES, recentLines } from "../src/coordinator/coordinator-lines";
import { delegatedPostCapability, delegatedPostEntry } from "../src/coordinator/delegated-post";
import { workerConfigSchema } from "../src/worker-config";
import { hireWorkforce } from "../src/workers/register";
import { createWorkerInstallation } from "../src/workers/installation";

type ModelMessage = { role: string; content: unknown };

/** The text of a model message's content. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => (part as { text?: string }).text ?? "").join("") : "";
}

/** What one delegate turn was handed: the worker, the post as its turn reads it, and the system text around it. */
type AnswerCall = { worker: string; turn: string; system: string };

/** The delegates' scripted turn. Never calls a tool. */
function scriptedAnswer(): MockGeneratorInstance & { turns: AnswerCall[] } {
  const turns: AnswerCall[] = [];
  return {
    name: "agent-answer",
    calls: [],
    turns,
    reset: () => {},
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as ModelMessage[];
      const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
      const turn = textOf([...messages].reverse().find((m) => m.role === "user")?.content);
      const worker = /You are ([a-z.]+)\./.exec(system)?.[1] ?? "unknown";
      turns.push({ worker, turn, system });
      if (turn.includes("[where]")) {
        const item = /item-[a-z0-9]+/.exec(system)?.[0];
        return { text: item === undefined ? "Buy what?" : `Buy the ${item} at the shop.` };
      }
      return { text: `${worker} here: does it see the network?` };
    }
  };
}

/** Best fit's scripted evaluation: `[follow-up]` to the last delegate in the lines, else the first offered mark. */
function scriptedRoute() {
  return mockEvaluationModel({
    answers: ({ state, questions }) => {
      const { recent = [], post } = state as {
        recent?: Array<{ from: string; text: string }>;
        post: { from: string; text: string };
      };
      const offered = (questions as { member?: { criteria?: Record<string, string> } }).member?.criteria ?? {};
      if (post.text.includes("[follow-up]")) {
        const last = [...recent].reverse().find((line) => Object.hasOwn(offered, line.from));
        if (last !== undefined) return { member: { type: "choice", choice: last.from } };
      }
      const mark = [...post.text.matchAll(/\[route:([a-z.-]+)\]/g)].map((m) => m[1]!).find((m) => Object.hasOwn(offered, m));
      if (mark === undefined) throw new Error("the scripted route has no pick for this post");
      return { member: { type: "choice", choice: mark } };
    }
  });
}

/**
 * An app's own delegate flow: its door is a generator that names its worker
 * and has the delegated-post capability, as the coordinators page shows.
 */
function researchFlow(installation: ReturnType<typeof createWorkerInstallation>) {
  const input = z.object({ message: z.string() });
  const door = generator({
    name: "research-answer",
    inputSchema: input,
    model: "scripted/research",
    resources: { ...installation.resources },
    uses: [delegatedPostCapability],
    prompt: async (_input, ctx) => `You are ${(await installation.resolveWorker(ctx as never, "research")).id}.`,
    user: (turn: { message: string }) => turn.message
  });
  return defineFlow({
    kind: "research",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: input, block: door, userMessage: (turn: { message: string }) => turn.message } },
    internal: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } }
  });
}

/**
 * A desk on `routing` over two delegates, `devices` and `accounts`, and
 * Alice's conversation with it. They run on the built-in `agent` flow, or on
 * the app's own `research` flow.
 */
async function openDesk(routing: "best-fit" | "round-robin", flow: "agent" | "research" = "agent") {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "desk", declared: { flow: "coordinator", routing, delegates: ["devices", "accounts"] }, body: "" },
      { id: "devices", declared: { flow, description: "Laptops, phones and wifi." }, body: "You are devices." },
      { id: "accounts", declared: { flow, description: "Billing and passwords." }, body: "You are accounts." }
    ],
    workerFlows: () => flows as never
  });
  const delegateFlow = flow === "agent" ? defineAgentWorkerFlow({ installation }) : researchFlow(installation);
  const coordinator = defineCoordinatorFlow({ installation, delegateFlows: [delegateFlow], routeModel: "typesafe-ai/jev" });
  flows = { [flow]: delegateFlow, coordinator };
  const copies = hireWorkforce(installation);
  const route = scriptedRoute();
  const answer = scriptedAnswer();
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": answer, "research-answer": answer },
      evaluators: { "coordinator-route": route }
    }),
    resolvePrincipal: (context: any) => ({ userId: context.request.headers.get("x-user"), orgId: "acme" })
  } as never);
  const router = (await state.getRouter()) as any;
  const res: Response = await router.POST(
    new Request("http://localhost/api/flows/coordinator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "alice" },
      body: JSON.stringify({ userId: "alice", state: { workerId: "desk" } })
    }),
    { params: { path: ["coordinator", "sessions"] } }
  );
  expect(res.status).toBe(201);
  const sessionId = ((await res.json()) as { session: { id: string } }).session.id;
  const runtime = await state.getRuntime();

  /** Every item a session's requests hold, oldest request first. */
  const itemsOf = async (id: string) =>
    (await runtime.stores.request.list({ sessionId: id, withItems: true }))
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((request) => ((request as unknown as { items?: any[] }).items ?? []));

  /** The delegates' answers in Alice's conversation, oldest first. */
  const answers = async () =>
    (await itemsOf(sessionId))
      .filter((item) => item.type === "message" && item.role === "assistant" && item.agentName !== undefined)
      .map((item) => ({ agentName: item.agentName as string, text: textOf(item.content) }));

  /** Post as Alice, and wait until `count` answers have landed. */
  const post = async (message: string, count: number) => {
    const posted = await runAction({
      flow: copies.find((copy) => copy.id === "coordinator")!,
      actionName: "run",
      input: { message },
      userId: "alice",
      orgId: "acme",
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    expect((posted as { error?: unknown }).error).toBeUndefined();
    const deadline = Date.now() + 5_000;
    let landed = await answers();
    while (landed.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      landed = await answers();
    }
    expect(landed, `waiting for answer ${count}`).toHaveLength(count);
    return landed[count - 1]!;
  };

  /** The routing records in Alice's conversation. */
  const records = async () =>
    (await itemsOf(sessionId)).filter((item) => item.type === "component" && item.component === "coordinator-route").map((item) => item.data);

  /** The session each delegate was delivered into, from the conversation's ledger. */
  const delegateSession = async (worker: string) =>
    ((((await runtime.stores.session.get(sessionId))?.state ?? {}) as { deliveries?: any[] }).deliveries ?? []).find(
      (delivery) => delivery.delegate.worker === worker
    )?.sessionId as string | undefined;

  return { route, answer, post, records, itemsOf, delegateSession };
}

describe("a follow-up keeps its conversation's context", () => {
  it("goes to the delegate that answered the post it follows, under best fit, and that delegate is handed the earlier lines", async () => {
    const desk = await openDesk("best-fit");
    const first = "My laptop won't join the office wifi. [route:devices]";
    const answered = await desk.post(first, 1);
    expect(answered.agentName).toBe("devices");

    // On its words alone the follow-up names accounts; the conversation says it continues devices' answer.
    const followUp = "[follow-up] It sees it. It fails right after the password. [route:accounts]";
    const second = await desk.post(followUp, 2);
    expect(second.agentName).toBe("devices");

    // Best fit's one evaluation was handed the lines before the post, each under who wrote it.
    expect(desk.route.calls).toHaveLength(2);
    expect((desk.route.calls[1]!.state as { recent: unknown }).recent).toEqual([
      { from: "alice", text: first },
      { from: "devices", text: answered.text }
    ]);
    expect((await desk.records()).map((record: any) => [record.by, record.delegates])).toEqual([
      ["evaluated", [{ worker: "devices", outcome: "delivered" }]],
      ["evaluated", [{ worker: "devices", outcome: "delivered" }]]
    ]);

    // And devices' turn on the follow-up was shown them, as this conversation's lines.
    const turn = desk.answer.turns.find((call) => call.turn.includes("It fails right after the password"));
    expect(turn?.worker).toBe("devices");
    expect(turn?.system).toContain(
      ["Recent lines in the conversation with desk before this post, oldest first:", `- alice: ${first}`, `- devices: ${answered.text}`].join(
        "\n"
      )
    );
  });

  it("hands a delegate never sent the earlier post its lines, for that turn only, off best fit too", async () => {
    // Round robin: the item post goes to devices, the next post to accounts, which never heard the first.
    const desk = await openDesk("round-robin");
    const item = `item-${Math.random().toString(36).slice(2, 8)}`;
    const first = await desk.post(`My ${item} charger stopped working.`, 1);
    expect(first.agentName).toBe("devices");

    const where = await desk.post("[where] Where can I buy it?", 2);
    expect(where).toEqual({ agentName: "accounts", text: `Buy the ${item} at the shop.` });

    // Shown as context, never kept: nothing in accounts' own conversation carries the item.
    const session = await desk.delegateSession("accounts");
    expect(session).toBeDefined();
    const kept = (await desk.itemsOf(session!)).filter((entry) => entry.type === "message").map((entry) => textOf(entry.content));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.filter((text) => text.includes(item))).toEqual([`Buy the ${item} at the shop.`]);
  });

  it("shows the lines to a flow of the app's own whose generator has the delegated-post capability", async () => {
    const desk = await openDesk("round-robin", "research");
    const item = `item-${Math.random().toString(36).slice(2, 8)}`;
    expect((await desk.post(`My ${item} charger stopped working.`, 1)).agentName).toBe("devices");
    expect(await desk.post("[where] Where can I buy it?", 2)).toEqual({ agentName: "accounts", text: `Buy the ${item} at the shop.` });
    expect(desk.answer.turns.at(-1)?.worker).toBe("accounts");
  });

  it("hands the first post of a conversation no lines, and its delegate no section", async () => {
    const desk = await openDesk("best-fit");
    await desk.post("My laptop won't join the office wifi. [route:devices]", 1);
    expect((desk.route.calls[0]!.state as { recent: unknown }).recent).toEqual([]);
    expect(desk.answer.turns[0]!.system).not.toContain("Recent lines in the conversation");
  });
});

describe("recentLines", () => {
  const who = { person: "alice", coordinator: "desk" };
  let index = 0;
  const message = (role: string, text: string, extra: Partial<SessionItem> = {}): SessionItem =>
    ({ id: `i${index}`, type: "message", status: "completed", requestId: "r", itemIndex: index++, payload: text, role, ...extra }) as SessionItem;

  it("names each line's writer: the person, the coordinator, or the delegate that answered", () => {
    const lines = recentLines(
      [
        message("user", "hello"),
        message("assistant", "Handed on.", { agentName: "coordinator-judgment" }),
        message("assistant", "Nobody took this post: no delegate in this conversation can be reached."),
        message("assistant", "Try restarting it.", { agentName: "support.devices" }),
        message("system", "never a line"),
        message("assistant", "   ", { agentName: "support.devices" })
      ],
      who
    );
    expect(lines).toEqual([
      { from: "alice", text: "hello" },
      { from: "desk", text: "Handed on." },
      { from: "desk", text: "Nobody took this post: no delegate in this conversation can be reached." },
      { from: "support.devices", text: "Try restarting it." }
    ]);
  });

  it(`keeps the last ${RECENT_LINES} lines`, () => {
    const items = Array.from({ length: RECENT_LINES + 5 }, (_, n) => message("user", `post ${n}`));
    const lines = recentLines(items, who);
    expect(lines).toHaveLength(RECENT_LINES);
    expect(lines[0]!.text).toBe("post 5");
    expect(lines.at(-1)!.text).toBe(`post ${RECENT_LINES + 4}`);
  });

  it(`keeps at most ${RECENT_CHARS} characters, newest first, cutting the line that crosses the cap`, () => {
    const long = "x".repeat(RECENT_CHARS - 10);
    const lines = recentLines([message("user", "older, left out"), message("user", "y".repeat(40)), message("user", long)], who);
    expect(lines).toEqual([
      { from: "alice", text: `${"y".repeat(10)}…` },
      { from: "alice", text: long }
    ]);
    expect(lines.reduce((total, line) => total + line.text.length, 0)).toBeLessThanOrEqual(RECENT_CHARS + 1);
  });
});
