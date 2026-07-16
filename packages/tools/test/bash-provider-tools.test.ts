/**
 * Generator-level seam test for the bash `tool()` objects (AI SDK 7).
 *
 * The other bash tests call `tools.bash.execute(...)` directly, which never
 * exercises the AI SDK's own tool plumbing. This test passes the returned
 * `tool()` objects through a generator's `providerTools` into the real
 * `streamText` loop (mocked language model), so a v7 change to tool
 * auto-execution or streaming can't pass silently.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { generator, providerTool, wrapAiSdkModel } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runForTest } from "@flow-state-dev/testing";
import { createBashTool } from "../src/bash/create-bash-tool";
import type { CommandResult, Sandbox } from "../src/bash/types";

function createRecordingSandbox(): Sandbox & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    async executeCommand(command: string): Promise<CommandResult> {
      commands.push(command);
      return { stdout: "hi from sandbox\n", stderr: "", exitCode: 0 };
    },
    async readFile(): Promise<string> {
      throw new Error("not used");
    },
    async writeFile(): Promise<void> {
      /* not used */
    },
  };
}

/** Minimal BlockContext for an identity-less generator (no item emission). */
function minimalContext(): BlockContext {
  return {
    request: { identity: { type: "request", id: "req_1" }, state: {} },
    user: { identity: { type: "user", id: "user_1", userId: "user_1" }, state: {} },
    response: {
      emit: async () => undefined,
      getItems: () => [],
      subscribeToItems: () => () => undefined,
    },
    emit: { status: () => undefined },
    _peekStatus: () => "",
    signal: new AbortController().signal,
  } as unknown as BlockContext;
}

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};

function bashCallStep() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call_bash_1",
          toolName: "bash",
          input: '{"command":"echo hi"}',
        } as any);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
        } as any);
        controller.close();
      },
    }),
  };
}

function textStep(text: string) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-start", id: "t1" } as any);
        controller.enqueue({ type: "text-delta", id: "t1", delta: text } as any);
        controller.enqueue({ type: "text-end", id: "t1" } as any);
        controller.enqueue({
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage,
        } as any);
        controller.close();
      },
    }),
  };
}

describe("bash tools through providerTools/streamText (AI SDK 7)", () => {
  it("auto-executes the bash tool() inside the streamText loop and feeds the result to the next step", async () => {
    const sandbox = createRecordingSandbox();
    const { tools } = await createBashTool({
      provider: { type: "custom", sandbox },
    });

    const steps = [bashCallStep(), textStep("finished")];
    let call = 0;
    const mockModel = new MockLanguageModelV3({
      doStream: async () => steps[call++]!,
    });

    const block = generator({
      name: "bash-agent",
      model: wrapAiSdkModel(mockModel),
      prompt: "Run commands as asked.",
      user: "run echo hi",
      providerTools: [providerTool("bash", tools.bash)],
      maxIterations: 2,
    });

    const result = await runForTest(block, {}, minimalContext());

    // The AI SDK executed the tool() object's execute against the sandbox.
    // (The trailing `find` is FileSync's post-command flush walk.)
    expect(sandbox.commands[0]).toBe("echo hi");
    expect(result).toBe("finished");
    expect(mockModel.doStreamCalls.length).toBe(2);

    // The command result round-tripped into the second step's prompt as a
    // tool-result the model can read.
    const secondPrompt = mockModel.doStreamCalls[1]!.prompt as Array<{
      role: string;
      content: unknown;
    }>;
    const toolMessage = secondPrompt.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(JSON.stringify(toolMessage)).toContain("hi from sandbox");
  });
});
