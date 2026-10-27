import { describe, expect, it } from "vitest";
import { sendHarnessLine, type HarnessLineSender } from "../src/harness-line";

/** A sender that records what it was asked to do, answering `steer` with `answer`. */
function senderOf(answer: { taken: boolean; live: boolean }) {
  const calls: string[] = [];
  const sender: HarnessLineSender = {
    steer: async (prompt) => (calls.push(`steer:${prompt}`), answer),
    turn: async (prompt) => void calls.push(`turn:${prompt}`),
  };
  return { sender, calls };
}

describe("sendHarnessLine", () => {
  it("sends a line as a turn when none is running, without asking to steer", async () => {
    const { sender, calls } = senderOf({ taken: true, live: true });
    expect(await sendHarnessLine("hi", false, sender)).toBe("turn");
    expect(calls).toEqual(["turn:hi"]);
  });

  it("stops at the steer when the running turn took the line: it is sent once", async () => {
    const { sender, calls } = senderOf({ taken: true, live: true });
    expect(await sendHarnessLine("hi", true, sender)).toBe("taken");
    expect(calls).toEqual(["steer:hi"]);
  });

  it.each([
    ["refused it", { taken: false, live: true }],
    ["offered nothing", { taken: false, live: false }],
  ])("sends the line as the next turn when the running turn %s, so it is never dropped", async (_why, answer) => {
    const { sender, calls } = senderOf(answer);
    expect(await sendHarnessLine("hi", true, sender)).toBe("after-this-turn");
    expect(calls).toEqual(["steer:hi", "turn:hi"]);
  });
});
