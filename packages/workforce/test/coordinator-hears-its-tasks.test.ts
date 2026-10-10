/**
 * Which coordinators hear a task they filed end by a turn, and which by a
 * line only (FIX-1863, on FIX-1794 BR-22 and BR-24).
 *
 * A coordinator whose own turn can file a task reads that task's ending in
 * that turn, so a failed task can be filed again and the person told: one
 * routing by judgment, and one routing by best fit that offers itself as a
 * choice (FIX-1833 D1). A coordinator with no turn of its own keeps the line:
 * round robin and everyone. Each leg files through the action, so the only
 * turn that can run is the one the ending wakes.
 */
import { describe, expect, it } from "vitest";
import type { WorkerManifest } from "../src";
import { mockGenerator } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";

const coordinator = (id: string, declared: Record<string, unknown>): WorkerManifest => ({
  id,
  declared: { flow: "coordinator", delegates: ["eng.tasker"], ...declared },
  body: "Hand out the work.",
  skills: []
});

/** The four ways a coordinator can route, each with a delegate that takes tasks. */
const standard = [
  ...boardWorkers(),
  coordinator("judge", { routing: "judgment", description: "Files work." }),
  coordinator("fit-self", { routing: "best-fit", description: "Hires, fires and files work." }),
  coordinator("fit-bare", { routing: "best-fit", fallback: "eng.tasker" }),
  coordinator("rotor", { routing: "round-robin" }),
  coordinator("all", { routing: "everyone" })
];

/**
 * File one task for `eng.tasker` in a fresh `worker` conversation and let it
 * end. What the conversation then holds about it, and every turn the ending
 * woke.
 */
async function heard(worker: string, ending: "completed" | "errored") {
  const judgment = mockGenerator({
    script: [{ when: (input) => JSON.stringify(input).includes("Count licenses"), then: { text: "Heard it." } }]
  });
  const host = bootBoardHost({ standard, judgment });
  try {
    const conv = await host.conversation("alice", worker);
    const goal = ending === "errored" ? "Count licenses [fail-until:9]" : "Count licenses";
    const filed = await host.act("alice", conv, "addTask_tasks", { goal, assignee: "eng.tasker" });
    expect(filed.error, messageOf(filed.error)).toBeUndefined();
    expect((filed.output as { ok: boolean }).ok).toBe(true);
    await host.settled();
    const messages = await host.messages(conv);
    return {
      notices: messages.filter((message) => message.text.includes('"Count licenses')).map((message) => message.text),
      turns: judgment.calls.length,
      replies: messages.filter((message) => message.text === "Heard it.").length
    };
  } finally {
    await host.dispose();
  }
}

describe("a coordinator whose own turn can file hears its task end in that turn", () => {
  it.each([
    ["routing by judgment", "judge"],
    ["routing by best fit, offering itself by its description", "fit-self"]
  ])("%s: the ending wakes its turn once, after the line", async (_label, worker) => {
    const { notices, turns, replies } = await heard(worker, "completed");
    expect(notices).toEqual([expect.stringContaining("completed by eng.tasker")]);
    expect(turns).toBe(1);
    expect(replies).toBe(1);
  });

  it("routing by best fit, offering itself: a task that fails for good wakes its turn, so it can be filed again", async () => {
    const { notices, turns, replies } = await heard("fit-self", "errored");
    expect(notices).toEqual([expect.stringContaining("failed for good with eng.tasker")]);
    expect(turns).toBe(1);
    expect(replies).toBe(1);
  });
});

describe("a coordinator with no turn of its own hears its task end as a line only", () => {
  it.each([
    ["routing round robin", "rotor"],
    ["routing to everyone", "all"]
  ])("%s: one line, and no turn", async (_label, worker) => {
    const { notices, turns } = await heard(worker, "completed");
    expect(notices).toEqual([expect.stringContaining("completed by eng.tasker")]);
    expect(turns).toBe(0);
  });
});
