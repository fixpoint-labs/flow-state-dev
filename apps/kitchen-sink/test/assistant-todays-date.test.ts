import { afterEach, describe, expect, it, vi } from "vitest";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { assistantGenerator } from "../flows/chat-agent/run/assistant/assistant";

const assistant = mockGenerator({
  name: "assistant-generator",
  script: [{ text: "ok" }],
});

async function promptAt(date: Date): Promise<string> {
  vi.setSystemTime(date);
  assistant.reset();
  const result = await testBlock(assistantGenerator, {
    input: { message: "what is today's date?", mode: "ask" },
    session: { state: { features: {} } },
    generators: { "assistant-generator": assistant },
    unmockedGeneratorPolicy: "error",
  });
  expect(result.error).toBeNull();
  return JSON.stringify(assistant.calls[0]?.input);
}

describe("chat-agent assistant todaysDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the model the date of the turn, not the date the server started", async () => {
    // Far from the real clock, and from each other, so neither can match
    // the import-time date by accident.
    const first = new Date(2031, 0, 15, 12);
    const second = new Date(2031, 5, 20, 12);
    vi.useFakeTimers({ toFake: ["Date"] });

    const firstPrompt = await promptAt(first);
    expect(firstPrompt).toContain(first.toLocaleDateString());

    const secondPrompt = await promptAt(second);
    expect(secondPrompt).toContain(second.toLocaleDateString());
    expect(secondPrompt).not.toContain(first.toLocaleDateString());
  });
});
