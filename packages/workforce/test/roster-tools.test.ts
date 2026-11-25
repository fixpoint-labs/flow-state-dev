/**
 * `hire` and `fire` from a conversation (`hireWorkersCapability`): the roster's
 * own writes, each held for the user's approval. A worker can't add or remove
 * a teammate on the user's behalf without their yes, and what they approve is
 * the whole hire, instructions included; anything the write would refuse is
 * refused before they are asked. The app's model list and the key-shaped check
 * sit on the roster's write itself, so the Hire form gets them too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratorModel, SuspensionRecord } from "@flow-state-dev/core/types";
import type { HireChecks } from "../src/workers/hire-blocks";
import { hireWorkersCapability } from "../src/workers/roster-tools";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

type Step = Awaited<ReturnType<GeneratorModel["generateStep"]>>;
type Call = { cue: string; toolName: string; args: Record<string, unknown> };

/** otto calls `toolName` with `args` on a user's message that says `cue`. */
const callOn = (cue: string, toolName: string, args: Record<string, unknown>): Call => ({ cue, toolName, args });

/**
 * otto as a step model: on a user's message that says a call's cue it makes
 * that call, and after a tool's answer it stops. Driven step by step, a turn
 * parked in the call's approval resumes at that call.
 */
function stepModel(calls: Call[], tools: Record<string, string[]>): GeneratorModel {
  return {
    modelId: "otto-step",
    async generate() {
      throw new Error("the agent turn is driven step by step");
    },
    async generateStep(options): Promise<Step> {
      // Whose turn, by otto's own instructions: the tools it was handed.
      tools[JSON.stringify(options.messages).includes("You do what you're asked.") ? "otto" : "other"] = (options.tools ?? []).map((tool) => tool.name);
      const last = options.messages.at(-1) as { role?: string } | undefined;
      const call = last?.role === "user" ? calls.find((c) => JSON.stringify(last).includes(c.cue)) : undefined;
      if (call === undefined) return { text: "", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `${call.toolName}-${call.cue}`, toolName: call.toolName, args: call.args }], finishReason: "tool-calls" };
    }
  } as GeneratorModel;
}

const analyst = {
  id: "analyst",
  description: "Explains the metrics.",
  instructions: "You explain what a metric means, citing the file.",
  settings: { model: "openai/gpt-6-luna" }
};

/** A host where otto, which picks the capability, makes the calls `script` scripts; `checks` is the app's hire config. */
function open(calls: Call[], checks: HireChecks = {}) {
  const tools: Record<string, string[]> = {};
  const h = bootBoardHost({
    durable: true,
    standard: boardWorkers({ otto: { capabilities: { hireWorkers: ["tools"] } } }),
    agentUses: (installation) => [hireWorkersCapability(installation, checks)],
    hire: { hire: checks },
    agentModel: stepModel(calls, tools)
  });
  /** alice's conversation with `worker`. */
  const conversation = async (worker = "otto") => (await h.create("alice", "agent", { state: { workerId: worker } })).body.session!.id as string;
  /** alice says `message` to `session`; the approvals now waiting, and what the tool answered. */
  const say = async (session: string, message: string) => {
    await h.post("alice", session, "respond", { message }, "agent");
    await h.settled();
    const runtime = await h.state.getRuntime();
    const pending = (await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
    const outputs = (await h.requestsOf(session))
      .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
      .filter((item) => item.type === "tool_output" && ["hire", "fire"].includes(item.toolCall?.name));
    return { pending, said: JSON.stringify(outputs) };
  };
  /** alice answers `asked` as Inbox does. */
  const answer = async (asked: SuspensionRecord, action: "approve" | "reject") => {
    await h.fsd("alice").flow(asked.flowId ?? asked.flowKind).request(asked.requestId).resume({ suspensionId: asked.suspensionId, action });
    await h.settled();
  };
  const roster = async () => (await h.client("alice").roster()).filter((worker) => !worker.standard).map((worker) => worker.id);
  return { h, tools, conversation, say, answer, roster };
}

afterEach(() => vi.unstubAllEnvs());

describe("hire from a conversation", () => {
  it("asks the user with the whole hire, and writes only on Approve", async () => {
    const lab = open([callOn("Hire an analyst", "hire", analyst), callOn("Hire it again", "hire", analyst)]);
    try {
      const otto = await lab.conversation();
      const asked = await lab.say(otto, "Hire an analyst.");
      expect(asked.pending).toHaveLength(1);
      const message = asked.pending[0]!.message ?? "";
      for (const shown of ["analyst", "agent", analyst.description, "openai/gpt-6-luna", analyst.instructions]) expect(message).toContain(shown);
      // Nothing lands while the user decides.
      expect(await lab.roster()).toEqual([]);
      await lab.answer(asked.pending[0]!, "reject");
      expect(await lab.roster()).toEqual([]);

      const again = await lab.say(otto, "Hire it again.");
      await lab.answer(again.pending[0]!, "approve");
      expect(await lab.roster()).toEqual(["analyst"]);
      const stored = await (await lab.h.state.getRuntime()).stores.resourceState.getByPrefix("user", "alice:~org:acme", "workforce/workers/");
      expect(Object.values(stored)[0]?.state).toMatchObject({ flow: "agent", instructions: analyst.instructions, settings: analyst.settings });
    } finally {
      await lab.h.dispose();
    }
  });

  it.each([
    ["a standard worker's id", { ...analyst, id: "otto" }, /standard worker/],
    ["a key in its instructions", { ...analyst, instructions: "Use sk-abcdefghijklmnop1234 to call it." }, /shaped like an API key/],
    ["a flow it can't run on", { ...analyst, flow: "nope" }, /nope/]
  ])("refuses %s before asking, and writes nothing", async (_case, args, reason) => {
    const lab = open([callOn("Hire an analyst", "hire", args)]);
    try {
      const { pending, said } = await lab.say(await lab.conversation(), "Hire an analyst.");
      expect(pending).toHaveLength(0);
      expect(said).toMatch(reason);
      // The model wrote the key into its call; the refusal never repeats it.
      expect(said.slice(said.indexOf('"error"'))).not.toContain("sk-abcdefghijklmnop1234");
      expect(await lab.roster()).toEqual([]);
    } finally {
      await lab.h.dispose();
    }
  });

  it("refuses an id already on the user's roster before asking", async () => {
    const lab = open([callOn("Hire an analyst", "hire", analyst)]);
    try {
      await lab.h.hire("alice", { id: "analyst", description: "The first one." });
      const { pending, said } = await lab.say(await lab.conversation(), "Hire an analyst.");
      expect(pending).toHaveLength(0);
      expect(said).toContain("already on the user's roster");
    } finally {
      await lab.h.dispose();
    }
  });

  it("is a tool only of the worker that picks it", async () => {
    const lab = open([]);
    try {
      await lab.say(await lab.conversation(), "hello");
      expect(lab.tools.otto).toEqual(expect.arrayContaining(["hire", "fire"]));
      await lab.h.hire("alice", { id: "plain", description: "No capabilities." });
      await lab.say(await lab.conversation("plain"), "hello");
      expect(lab.tools.other).not.toContain("hire");
      expect(lab.tools.other).not.toContain("fire");
    } finally {
      await lab.h.dispose();
    }
  });
});

describe("fire from a conversation", () => {
  it("asks the user, keeps the worker on Reject, and removes it on Approve", async () => {
    const lab = open([callOn("Fire the analyst", "fire", { id: "analyst" }), callOn("Fire it now", "fire", { id: "analyst" })]);
    try {
      await lab.h.hire("alice", { id: "analyst", description: "Explains the metrics." });
      const otto = await lab.conversation();
      const asked = await lab.say(otto, "Fire the analyst.");
      expect(asked.pending[0]!.message).toContain('"analyst"');
      await lab.answer(asked.pending[0]!, "reject");
      expect(await lab.roster()).toEqual(["analyst"]);
      const again = await lab.say(otto, "Fire it now.");
      await lab.answer(again.pending[0]!, "approve");
      expect(await lab.roster()).toEqual([]);
    } finally {
      await lab.h.dispose();
    }
  });

  it("refuses a standard worker before asking", async () => {
    const lab = open([callOn("Fire otto", "fire", { id: "otto" })]);
    try {
      const { pending, said } = await lab.say(await lab.conversation(), "Fire otto.");
      expect(pending).toHaveLength(0);
      expect(said).toContain("standard worker");
    } finally {
      await lab.h.dispose();
    }
  });
});

describe("the app's model list, on the roster's own hire", () => {
  const checks = { models: ["openai/gpt-6-luna"] };

  it("refuses a model the app doesn't list, naming the list", async () => {
    const lab = open([], checks);
    try {
      vi.stubEnv("OPENAI_API_KEY", "set");
      const error = messageOf((await lab.h.hire("alice", { id: "analyst", settings: { model: "openai/gpt-6-sol" } })).error);
      expect(error).toContain('"openai/gpt-6-sol"');
      expect(error).toContain("openai/gpt-6-luna");
      expect(await lab.roster()).toEqual([]);
    } finally {
      await lab.h.dispose();
    }
  });

  it("refuses a listed model with no key in the environment, saying so", async () => {
    const lab = open([], checks);
    try {
      for (const name of ["OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "OPENROUTER_API_KEY"]) vi.stubEnv(name, "");
      const error = messageOf((await lab.h.hire("alice", { id: "analyst", settings: { model: "openai/gpt-6-luna" } })).error);
      expect(error).toContain("can't run on this server: no key or gateway for openai");
      expect(await lab.roster()).toEqual([]);
    } finally {
      await lab.h.dispose();
    }
  });

  it("hires on a listed model with its key; a worker naming no model is not checked", async () => {
    const lab = open([], checks);
    try {
      vi.stubEnv("OPENAI_API_KEY", "set");
      expect((await lab.h.hire("alice", { id: "analyst", settings: { model: "openai/gpt-6-luna" } })).error).toBeUndefined();
      expect((await lab.h.hire("alice", { id: "plain" })).error).toBeUndefined();
      expect(await lab.roster()).toEqual(["analyst", "plain"]);
    } finally {
      await lab.h.dispose();
    }
  });

  it("refuses a key in a Hire form's instructions, and an edit onto an unlisted model", async () => {
    const lab = open([], checks);
    try {
      vi.stubEnv("OPENAI_API_KEY", "set");
      expect(messageOf((await lab.h.hire("alice", { id: "analyst", instructions: "key: ghp_abcdefghijklmnopqrstuvwxyz0123" })).error)).toContain("API key");
      expect((await lab.h.hire("alice", { id: "analyst" })).error).toBeUndefined();
      const edited = await lab.h.act("alice", "roster-alice", "edit", { id: "analyst", settingsPatch: { model: "openai/gpt-6-sol" } }, "roster");
      expect(messageOf(edited.error)).toContain('"openai/gpt-6-sol"');
    } finally {
      await lab.h.dispose();
    }
  });
});

