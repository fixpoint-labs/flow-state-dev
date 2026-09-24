/**
 * The rail's hire door: what the assistant's flow carries so a person can hire
 * a seat from the rail.
 *
 * The rail's session runs on `chat-agent`, so the door is an action there. It
 * must be the `workforce` package's hire sequence itself, built from the one
 * options object the seats' own `hire` tool uses, and it must be the only
 * action the door adds.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1500/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V16 The action's block IS the `hire` that `createSeatHireBlocks` returned,
 *       built from `kitchenSinkSeatHireOptions`. The factory is spied through,
 *       not replaced, so the flow still gets the real sequence. Red: mount an
 *       app handler that writes the roster row itself — the block is not the
 *       factory's.
 *   V12 The flow's public actions are an allow-list: the ones it had, plus the
 *       hire. Red: add a `createChannel` action beside it — the list differs.
 */
import { describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ calls: [] as Array<{ options: unknown; blocks: { hire: unknown } }> }));

vi.mock("@flow-state-dev/workforce", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/workforce")>();
  return {
    ...actual,
    createSeatHireBlocks: (options: Parameters<typeof actual.createSeatHireBlocks>[0]) => {
      const blocks = actual.createSeatHireBlocks(options);
      made.calls.push({ options, blocks });
      return blocks;
    },
  };
});

const { default: chatAgentFlow } = await import("../flows/chat-agent/flow");
const { kitchenSinkSeatHireOptions } = await import("../workforce/hire");

const actions = (chatAgentFlow as unknown as { actions: Record<string, { block: unknown }> }).actions;

describe("V16 · the rail's hire is the package's sequence", () => {
  it("mounts the hire createSeatHireBlocks built from the shared options, not a handler of its own", () => {
    const fromShared = made.calls.filter((call) => call.options === kitchenSinkSeatHireOptions);
    expect(fromShared.length, "createSeatHireBlocks was never called with kitchenSinkSeatHireOptions").toBeGreaterThan(0);
    expect(actions.hireSeat, "chat-agent carries no hireSeat action").toBeDefined();
    expect(fromShared.map((call) => call.blocks.hire)).toContain(actions.hireSeat!.block);
  });
});

describe("V12 · the hire is the only action the rail's door adds", () => {
  it("lists exactly the assistant's own actions and the hire", () => {
    expect(Object.keys(actions).sort()).toEqual(
      [
        // The assistant's own, before the door.
        "askQuestion",
        "chooseOption",
        "collectForm",
        "requestApproval",
        "run",
        "saveArtifact",
        "setSelectedModel",
        "setThinkingEnabled",
        "task-queue",
        // The door. Nothing creates a channel or a board.
        "hireSeat",
      ].sort(),
    );
  });
});
