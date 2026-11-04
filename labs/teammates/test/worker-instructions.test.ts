/**
 * A coding worker's own instructions, its `WORKER.md` body, open the brief its
 * harness is handed, ahead of the task they frame.
 *
 * `workerConfigOf` is stubbed to the turn's loaded worker; the brief is built
 * by the coding phase the coder flow runs.
 */
import { describe, expect, it, vi } from "vitest";
import type { PromptRunContext } from "@flow-state-dev/harness-manager";
import { codingPhase } from "../src/flows/coder";

const BODY = "You run coding tasks. Leave a haiku in the commit message.";
let loaded: Record<string, unknown> = {};

vi.mock("@flow-state-dev/workforce", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce")>()),
  workerConfigOf: () => loaded,
}));

const run = {
  ctx: { session: {} },
  task: { title: "Add a line to the README", goal: "Add a line that says hi to README.md, and commit it." },
  workspacePath: "/w",
} as unknown as PromptRunContext;

describe("a coding run's brief", () => {
  it("opens with the worker's instructions, before the task's goal", async () => {
    loaded = { instructions: BODY };
    const prompt = await codingPhase().buildPrompt(run);
    expect(prompt).toContain(BODY);
    expect(prompt.indexOf(BODY)).toBeLessThan(prompt.indexOf("Add a line that says hi to README.md"));
  });

  it("is the task alone for a worker with no instructions", async () => {
    loaded = {};
    const prompt = await codingPhase().buildPrompt(run);
    expect(prompt.startsWith("Task: Add a line to the README")).toBe(true);
  });
});
