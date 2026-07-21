/**
 * Tests for the fork-mode subagent generator (FIX-919).
 *
 * Two guarantees:
 *   1. Isolation — the child runs `itemVisibility: { client: true, history: false }`
 *      so its own work never flows into the parent's future history, and it
 *      inherits history by default (the `history` slot), bounded when asked.
 *   2. Inheritance — seeded prior turns reach the child's assembled messages,
 *      inserted between the skill body (system) and the run instruction (user),
 *      with no dangling tool call from a completed prior-turn tool pair.
 *
 * Config tests assert the assembled block without running it (the
 * `worker-materializer.test.ts` idiom). The inheritance test drives the real
 * engine message-assembly path against a seeded in-memory store.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import {
  createExecutionContext,
  createInMemoryStores,
} from "@flow-state-dev/engine";
import type { RequestRecord, StoreRegistry } from "@flow-state-dev/engine";
import { runForTest } from "@flow-state-dev/testing";
import { createSkillForkGenerator } from "../../src/skills/fork-generator";

describe("createSkillForkGenerator — config", () => {
  it("runs isolated (history:false to the parent) and inherits history by default", () => {
    const gen = createSkillForkGenerator({ catalog: {} });
    const config = (gen as { config: { itemVisibility?: unknown; history?: unknown } })
      .config;
    // Isolation: the child streams to the client but never into parent history.
    expect(config.itemVisibility).toEqual({ client: true, history: false });
    // Inheritance: the `history` slot is on (reads ctx.session.items.history()).
    expect(config.history).toBe(true);
  });

  it("bounds inherited history when historyLimit is set", () => {
    const gen = createSkillForkGenerator({ catalog: {}, historyLimit: { turns: 2 } });
    const config = (gen as { config: { history?: unknown } }).config;
    expect(config.history).toEqual({ limit: { turns: 2 } });
  });
});

// ---------------------------------------------------------------------------
// Inheritance — real engine message assembly against seeded prior turns
// ---------------------------------------------------------------------------

function assistantMessage(requestId: string, text: string): MessageItem {
  return {
    id: `${requestId}_a`,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
    requestId,
    itemIndex: 1,
    provenance: { blockName: "gen", blockInstanceId: "gen_1", phase: "main" },
    ts: 101,
  };
}

function userMessage(requestId: string, text: string): MessageItem {
  return {
    id: `${requestId}_u`,
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "input", blockInstanceId: "input_1", phase: "main" },
    ts: 100,
  };
}

function completedTurn(
  sessionId: string,
  n: number,
  items: MessageItem[],
): RequestRecord {
  const id = `req_${n}`;
  return {
    id,
    flowKind: "fork-flow",
    actionName: "run",
    userId: "u1",
    sessionId,
    status: "completed",
    startedAtMs: 1000 + n,
    completedAtMs: 1000 + n + 1,
    version: 1,
    createdAt: 1000 + n,
    updatedAt: 1000 + n + 1,
    state: {},
    items: items as unknown as OutputItem[],
  } as RequestRecord;
}

const noopHandler = handler({ name: "noop", execute: () => "ok" });

function makeFlow() {
  return defineFlow({
    kind: "fork-flow",
    actions: { run: { inputSchema: z.string(), block: noopHandler } },
  })();
}

async function ctxWithPriorTurn(
  stores: StoreRegistry,
  sessionId: string,
  items: MessageItem[],
  modelResolver: unknown,
) {
  await stores.request.set("req_1", completedTurn(sessionId, 1, items), "any");
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId: "req_cur",
    sessionId,
    userId: "u1",
    stores,
    modelResolver: modelResolver as never,
  });
}

describe("createSkillForkGenerator — inherits history to the fork point", () => {
  it("seeds the child's messages from prior turns (system body → history → run instruction)", async () => {
    const stores = createInMemoryStores();
    let seen: Array<{ role: string; content: unknown }> = [];
    const generate = vi.fn(async (options: { messages?: Array<{ role: string; content: unknown }> }) => {
      seen = options.messages ?? [];
      return { text: "forked result" };
    });
    const modelResolver = () => ({ modelId: "test", generate });
    const ctx = await ctxWithPriorTurn(
      stores,
      "sess_fork",
      [
        userMessage("req_1", "Our launch is March 3."),
        assistantMessage("req_1", "Noted — launch on March 3."),
      ],
      modelResolver,
    );

    const gen = createSkillForkGenerator({ catalog: {} });
    const result = await runForTest(
      gen,
      { skillName: "researcher", body: "You are a researcher.", allowedToolNames: [] },
      ctx as never,
    );
    expect(result).toBe("forked result");

    // System prompt is the skill body.
    expect(seen.find((m) => m.role === "system")?.content).toContain(
      "You are a researcher.",
    );
    // The prior-turn fact reached the child (it inherited history to the fork point).
    expect(JSON.stringify(seen)).toContain("March 3");
    // The run instruction is the final user turn — history sits before it, so a
    // still-in-flight fork call (which would come after) is never inherited.
    const last = seen[seen.length - 1]!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("Run the skill above");
  });

  it("turn-1 fork with no prior history runs with just system + user", async () => {
    const stores = createInMemoryStores();
    let seen: Array<{ role: string }> = [];
    const generate = vi.fn(async (options: { messages?: Array<{ role: string }> }) => {
      seen = options.messages ?? [];
      return { text: "ok" };
    });
    const ctx = await createExecutionContext({
      flow: makeFlow(),
      actionName: "run",
      requestId: "req_cur",
      sessionId: "sess_empty",
      userId: "u1",
      stores,
      modelResolver: (() => ({ modelId: "test", generate })) as never,
    });

    const gen = createSkillForkGenerator({ catalog: {} });
    await runForTest(
      gen,
      { skillName: "s", body: "System body.", allowedToolNames: [] },
      ctx as never,
    );
    // No prior turn → only system + the run-instruction user turn.
    expect(seen.map((m) => m.role)).toEqual(["system", "user"]);
  });
});
