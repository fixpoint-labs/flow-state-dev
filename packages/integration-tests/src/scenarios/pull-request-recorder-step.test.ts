/**
 * A flow with no harness records the pull requests its generator opens by
 * adding core's `pullRequestRecorder()` as a step (FIX-2268). The generator
 * itself is unchanged.
 *
 * What a flow author relies on: tapped before the generator, a pull request
 * the generator's shell tool opens is on the session's record as soon as that
 * call settles, while the generator still runs; tapped after it, the step reads
 * the calls the request already made; a `gh pr view` is never on it. Through
 * the real engine (`runAction`), whose request-end seam stops the recorder.
 */
import { describe, expect, it } from "vitest";
import { OBSERVED_PULL_REQUESTS, defineFlow, generator, handler, pullRequestRecorder, sequencer } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const KEY = "github.com/acme/app/88";

/** A stand-in for the bash tool: `{ stdout, stderr, exitCode }`, and a look at the record when it runs. */
function bashTool(seen: Array<boolean>) {
  return handler({
    name: "bash",
    description: "Run a shell command.",
    inputSchema: z.object({ command: z.string() }),
    execute: async (input, ctx) => {
      const record = (ctx.resources as Record<string, { getOptional(key: string): Promise<unknown> } | undefined>)[OBSERVED_PULL_REQUESTS];
      seen.push((await record?.getOptional(KEY)) !== undefined);
      if (input.command.startsWith("gh pr create")) return { stdout: "https://github.com/acme/app/pull/88\n", stderr: "", exitCode: 0 };
      return { stdout: "url:\thttps://github.com/other/repo/pull/12\n", stderr: "", exitCode: 0 };
    },
  });
}

function flowWith(place: "before" | "after", seen: boolean[]) {
  const assistant = generator({
    name: "assistant",
    model: "intent/chat",
    prompt: "Open a pull request.",
    inputSchema: z.object({ message: z.string() }),
    user: (input) => input.message,
    outputSchema: z.string(),
    tools: [bashTool(seen)],
    maxIterations: 4,
  });
  const base = sequencer({ name: "turn", inputSchema: z.object({ message: z.string() }) });
  const turn = place === "before" ? base.tap(pullRequestRecorder()).step(assistant) : base.step(assistant).tap(pullRequestRecorder());
  return defineFlow({
    kind: `pr-recorder-${place}`,
    requireUser: true,
    actions: { chat: { inputSchema: z.object({ message: z.string() }), block: turn } },
  })();
}

async function run(place: "before" | "after") {
  const seen: boolean[] = [];
  const stores = createInMemoryStores();
  const result = await testFlow({
    flow: flowWith(place, seen),
    action: "chat",
    userId: "u",
    sessionId: `s-${place}`,
    input: { message: "go" },
    stores,
    generators: {
      assistant: mockGenerator({
        name: "assistant",
        script: [
          { toolCalls: [{ toolCallId: "t1", toolName: "bash", args: { command: "gh pr create --title Notes --head notes" } }] },
          { toolCalls: [{ toolCallId: "t2", toolName: "bash", args: { command: "gh pr view 12 --repo other/repo" } }] },
          { text: "Opened it." },
        ],
      }),
    },
    unmockedGeneratorPolicy: "error",
  });
  const rows = await stores.resourceState.getByPrefix("session", `s-${place}`, `${OBSERVED_PULL_REQUESTS}/`);
  return { result, seen, rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k.slice(OBSERVED_PULL_REQUESTS.length + 1), v.state])) };
}

describe("pullRequestRecorder() as a step", () => {
  it("before the generator: the opened pull request is on the record while the generator still runs", async () => {
    const { result, seen, rows } = await run("before");
    expect(result.status).toBe("completed");
    // The second tool call ran after the first settled, inside the same generator.
    expect(seen).toEqual([false, true]);
    expect(Object.keys(rows)).toEqual([KEY]);
    expect(rows[KEY]).toMatchObject({ source: "tool", requestId: result.requestId, title: "Notes", branch: "notes" });
  });

  it("after the generator: the step reads the calls the request already made", async () => {
    const { seen, rows } = await run("after");
    expect(seen).toEqual([false, false]);
    expect(Object.keys(rows)).toEqual([KEY]);
  });
});
