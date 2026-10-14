/**
 * A worker message whose dispatch throws (FIX-1989, Delivery): a thrown
 * dispatch may have started, so it is never marked refused. It is sent again
 * once, which the entry's dedupe makes safe; if that throws too, the row
 * stays unconfirmed and the tool says so.
 *
 * The seam is made to throw for `onWorkerMessage` only, in this file alone.
 */
import { describe, expect, it, vi } from "vitest";

const throwing = { count: 0, times: 0 };

vi.mock("@flow-state-dev/core/types", async (original) => {
  const actual = await original<typeof import("@flow-state-dev/core/types")>();
  return {
    ...actual,
    dispatchThroughSeam: (ctx: never, spec: { action: string }) => {
      if (spec.action === "onWorkerMessage" && throwing.count < throwing.times) {
        throwing.count += 1;
        return Promise.reject(new Error("the connection dropped"));
      }
      return actual.dispatchThroughSeam(ctx, spec as never);
    }
  };
});

const { mockGenerator } = await import("@flow-state-dev/testing");
const { bootBoardHost } = await import("./conversation-board-harness");
const { WORKER_MESSAGES_PATTERN } = await import("../src/messages/message-log");

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

async function run(times: number) {
  throwing.count = 0;
  throwing.times = times;
  let called = false;
  // The lead's turn ends with no text, so no answer is relayed: only otto's message is in the log.
  const judgment = mockGenerator({ script: [{ when: (input) => textOf(input).includes("codename"), then: { text: "" } }, { when: () => true, then: { text: "" } }] });
  const h = bootBoardHost({
    judgment,
    agentAnswer: mockGenerator({
      script: [
        {
          when: (input) => {
            if (called || !textOf(input).includes("ask the lead")) return false;
            called = true;
            return true;
          },
          then: { toolCalls: [{ toolCallId: "ask", toolName: "messageWorker", args: { to: "lead", text: "What is the codename?" } }] }
        },
        { when: () => true, then: { text: "OK." } }
      ]
    })
  });
  const created = await h.create("alice", "agent", { state: { workerId: "otto" } });
  const otto = created.body.session!.id;
  await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
  await h.settled();
  const runtime = await h.state.getRuntime();
  const rows = Object.values(await runtime.stores.resourceState.getByPrefix("user", "alice:~org:acme", WORKER_MESSAGES_PATTERN.replace("*", ""))).map(
    (value) => value.state as Record<string, unknown>
  );
  const outputs = (await h.requestsOf(otto))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "tool_output")
    .map((item) => JSON.stringify(item.output));
  const lead = await h.client("alice").findWorkerSession({ worker: "lead" });
  const lines = lead === undefined ? [] : await h.messages(lead.id);
  await h.dispose();
  return { rows, outputs, lines, turns: judgment.calls.length };
}

describe("a dispatch that throws", () => {
  it("is sent again once, and the second copy delivers it", async () => {
    const { rows, outputs, lines, turns } = await run(1);
    expect(rows).toMatchObject([{ status: "delivered" }]);
    expect(outputs[0]).toMatch(/^\{"sent":"msg_\w+"\}$/);
    expect(lines.filter((line) => line.text === "From otto: What is the codename?")).toHaveLength(1);
    expect(turns).toBe(1);
  });

  it("thrown twice, stays unconfirmed (never refused), and the tool says it may still arrive", async () => {
    const { rows, outputs } = await run(2);
    expect(rows).toMatchObject([{ status: "unconfirmed", reason: "the connection dropped" }]);
    expect(outputs[0]).toMatch(/"sent":"msg_\w+","unconfirmed":"the delivery couldn't be confirmed/);
  });
});
