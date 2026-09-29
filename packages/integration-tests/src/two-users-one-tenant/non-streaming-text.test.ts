/**
 * A turn returns the same text whether or not it streams.
 *
 * A model that says something, calls a tool, then says more has written two
 * paragraphs. When the turn streams, the caller reads both. When the model
 * can't stream, the framework runs the same turn step by step without
 * streaming, and the caller must still read both, joined the same way, not
 * only what the model wrote after its last tool call.
 *
 * The model is scripted and keyless: each action plays the same turn, one
 * through a model that streams its steps and one through a model that only
 * generates them. The caller reads each turn's answer the way a client does,
 * from the message item in the request's replayed stream.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defineFlow,
  generator,
  handler,
  type GeneratorModel,
  type GeneratorModelCallOptions,
  type GeneratorModelResult
} from "@flow-state-dev/core";
import { z } from "zod";
import { startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const BEFORE = "That is outside what I know.";
const AFTER = "I've filed this with our team.";

/** The scripted turn: text and a tool call, then text. */
const TURN: Array<{ text: string; call?: string }> = [
  { text: BEFORE, call: "n1" },
  { text: AFTER }
];

/** Which step of the turn a call is: one step per tool result so far. */
function stepOf(options: GeneratorModelCallOptions): GeneratorModelResult {
  const done = (options.messages as Array<{ role?: string }>).filter((m) => m.role === "tool").length;
  const step = TURN[done];
  if (step === undefined) throw new Error(`no scripted step ${done}`);
  return {
    text: step.text,
    toolCalls: step.call === undefined ? undefined : [{ toolCallId: step.call, toolName: "note", args: {} }],
    finishReason: step.call === undefined ? "stop" : "tool-calls"
  };
}

/** Plays the turn by streaming each step. */
const streamingModel: GeneratorModel = {
  modelId: "scripted-streaming",
  async generate() {
    throw new Error("generate must not be called");
  },
  async *streamStep(options) {
    const result = stepOf(options);
    yield { type: "text_delta", textDelta: result.text! };
    for (const call of result.toolCalls ?? []) {
      yield {
        type: "tool_call_delta",
        toolCallDelta: { toolCallId: call.toolCallId, toolName: call.toolName, argsDelta: "{}" }
      };
    }
    yield { type: "finish", finishReason: result.finishReason, fullResult: result };
  }
};

/** Plays the same turn without streaming: it can only generate a step. */
const generatingModel: GeneratorModel = {
  modelId: "scripted-generating",
  async generate() {
    throw new Error("generate must not be called");
  },
  async generateStep(options) {
    return stepOf(options);
  }
};

const note = handler({
  name: "note",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => ({ ok: true })
});

const answer = (name: string, model: GeneratorModel) => ({
  inputSchema: z.object({ text: z.string() }),
  userMessage: (input: { text: string }) => input.text,
  block: generator({
    name,
    model,
    prompt: "Answer the customer.",
    tools: [note],
    itemVisibility: { client: true, history: true }
  })
});

const desk = defineFlow({
  kind: "desk",
  actions: {
    askStreamed: answer("desk-streamed", streamingModel),
    askGenerated: answer("desk-generated", generatingModel)
  }
});

let server: TwoUserServer;

beforeEach(async () => {
  server = await startTwoUserServer([desk()]);
});

afterEach(async () => {
  await server.close();
});

/** Run `action` as one user and return the text of the answer it streamed. */
async function answerText(action: string, sessionId: string): Promise<string> {
  const caller = server.as("alice");
  const posted = await caller(`/desk/${sessionId}/actions/${action}`, {
    method: "POST",
    body: JSON.stringify({ input: { text: "Can you help with my invoice?" } })
  });
  expect(posted.status).toBe(202);
  const { request } = (await posted.json()) as { request: { id: string } };

  const status = await waitFor(async () => {
    const response = await caller(`/desk/requests/${request.id}/status`);
    if (response.status !== 200) return undefined;
    const body = (await response.json()) as { status: string };
    return body.status === "in_progress" ? undefined : body.status;
  }, `request ${request.id} to settle`);
  expect(status).toBe("completed");

  const replay = await caller(`/desk/requests/${request.id}/stream`);
  expect(replay.status).toBe(200);
  const messages: string[] = [];
  for (const line of (await replay.text()).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5)) as {
      type?: string;
      item?: { type?: string; role?: string; content?: Array<{ text?: string }> };
    };
    if (event.type === "item.done" && event.item?.type === "message" && event.item.role === "assistant") {
      messages.push((event.item.content ?? []).map((part) => part.text ?? "").join(""));
    }
  }
  expect(messages).toHaveLength(1);
  return messages[0]!;
}

describe("a turn that writes text, calls a tool, then writes more", () => {
  it("answers with the same text whether or not it streams", async () => {
    const streamed = await answerText("askStreamed", "s_streamed");
    const generated = await answerText("askGenerated", "s_generated");

    expect(streamed).toBe(`${BEFORE}\n\n${AFTER}`);
    expect(generated).toBe(streamed);
  });
});
