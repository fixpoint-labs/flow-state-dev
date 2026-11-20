// FIX-2848 D1.
/**
 * A waited send whose wait throws: its `workforce:sent` line, written
 * `waiting` under the call's key, is written again as failed with the error,
 * and the error still reaches the call. The call draws as its line, so a line
 * left `waiting` would show a send that waits forever and hide the failure.
 * Real engine, scripted model; only the wait is made to throw.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/messages/wait-for-reply", async (original) => ({
  ...(await original<typeof import("../src/messages/wait-for-reply")>()),
  sendAndWaitForReply: () => Promise.reject(new Error("the store went away"))
}));

const { mockGenerator } = await import("@flow-state-dev/testing");
const { SENT_MESSAGE_DATA_TYPE } = await import("../src/messages/keys");
const { boardWorkers, bootBoardHost } = await import("./conversation-board-harness");

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

describe("a waited send whose wait throws", () => {
  it("ends its line failed with the error, not waiting", async () => {
    let done = false;
    const agentAnswer = mockGenerator({
      script: [
        {
          when: (input: unknown) => {
            if (done || !textOf(input).includes("Ask otto")) return false;
            done = true;
            return true;
          },
          then: { toolCalls: [{ toolCallId: "tc_W", toolName: "sendMessage", args: { to: "otto", text: "Codename?", wait: true } }] }
        },
        { when: () => true, then: { text: "" } }
      ]
    });
    const h = bootBoardHost({ standard: [...boardWorkers(), { id: "helper-a", declared: { description: "Asks." }, body: "You ask.", skills: [] }], agentAnswer });
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "helper-a" } });
      const helper = created.body.session!.id;
      await h.post("alice", helper, "respond", { message: "Ask otto the codename" }, "agent");
      await h.settled();
      const items = (await h.requestsOf(helper)).flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
      const lines = items.filter((item) => item.type === "data" && item.dataType === SENT_MESSAGE_DATA_TYPE);
      expect(new Set(lines.map((line) => line.key)).size).toBe(1);
      expect(lines.at(-1)?.value.wait).toEqual({ status: "failed", error: "the store went away" });
      const call = items.find((item) => item.type === "tool_output" && item.toolCall?.callId === "tc_W");
      expect(call?.status).toBe("failed");
    } finally {
      await h.dispose();
    }
  });
});
