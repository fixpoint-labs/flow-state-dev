import { describe, expect, it } from "vitest";
import { harnessLines, sendHarnessLine, type HarnessLineSender } from "../src/harness-line";

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

describe("harnessLines", () => {
  it("keeps a later line behind an earlier one that went to run after the turn, until the turn changes", async () => {
    const calls: string[] = [];
    // The running turn offers nothing for A, then would take B.
    const answers = [
      { taken: false, live: false },
      { taken: true, live: true },
    ];
    const sender: HarnessLineSender = {
      steer: async (prompt) => (calls.push(`steer:${prompt}`), answers.shift()!),
      turn: async (prompt) => void calls.push(`turn:${prompt}`),
    };
    const lines = harnessLines();

    expect(await lines.send("A", true, sender)).toBe("after-this-turn");
    // B must not overtake A by steering the turn A is queued behind.
    expect(await lines.send("B", true, sender)).toBe("turn");
    lines.turnChanged();
    expect(await lines.send("C", true, sender)).toBe("taken");
    expect(calls).toEqual(["steer:A", "turn:A", "turn:B", "steer:C"]);
  });

  it("sends lines one after another, in the order they were typed", async () => {
    const calls: string[] = [];
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    const sender: HarnessLineSender = {
      steer: async () => ({ taken: true, live: true }),
      turn: async (prompt) => {
        if (prompt === "A") await slow;
        calls.push(prompt);
      },
    };
    const lines = harnessLines();
    const a = lines.send("A", false, sender);
    const b = lines.send("B", false, sender);
    release();
    await Promise.all([a, b]);
    expect(calls).toEqual(["A", "B"]);
  });
});
