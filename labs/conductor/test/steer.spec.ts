import { describe, expect, it } from "vitest";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  STEER_PROMPT,
  coordinatorPhase,
  formatCoordinatorBoard,
  projectCoordinatorRow,
} from "../src/steer";
import {
  createConductorHarness,
  scriptedAgent,
  sdkResult,
} from "./harness";

describe("STEER_PROMPT", () => {
  it("tells the coordinator to pass a brief when the operator already said the ticket", () => {
    expect(STEER_PROMPT).toContain("pass that as brief");
    expect(STEER_PROMPT).toContain("Never pass default");
  });
});

describe("coordinatorPhase", () => {
  it("uses the board phase when the coordinator omitted one or passed default", () => {
    expect(coordinatorPhase(undefined, "implement")).toBe("implement");
    expect(coordinatorPhase("default", "implement")).toBe("implement");
    expect(coordinatorPhase("  DEFAULT  ", "implement")).toBe("implement");
    expect(coordinatorPhase("", "implement")).toBe("implement");
  });

  it("keeps a phase the operator actually named", () => {
    expect(coordinatorPhase("review", "implement")).toBe("review");
  });
});

describe("formatCoordinatorBoard", () => {
  it("says the board is empty rather than inventing a row", () => {
    expect(formatCoordinatorBoard([])).toMatch(/No rows/);
  });

  it("names failed rows and open questions, not checkout paths", () => {
    const row = projectCoordinatorRow({
      issue: "FIX-1",
      phase: "implement",
      status: "pending",
      attempts: 2,
      feedback: "try again",
      run: {
        outcome: "failed",
        reason: "does not ignore the directory",
        healed: ["added **/.fsdev/ to .gitignore"],
        workspacePath: "/tmp/secret-checkout",
      } as never,
      questions: [{ question: "FIX-1/implement/1/q", text: "Which path?" }],
    });
    const text = formatCoordinatorBoard([row]);
    expect(text).toContain("FIX-1");
    expect(text).toContain("failed");
    expect(text).toContain("does not ignore the directory");
    expect(text).toContain("Which path?");
    expect(text).toContain("added **/.fsdev/ to .gitignore");
    expect(text).not.toContain("/tmp/secret-checkout");
  });
});

describe("steer", () => {
  it("answers from the board without filing a row", async () => {
    const seen = { prompts: [] as string[], cwds: [] as Array<string | undefined> };
    const conductor = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      modelResolver: createMockModelResolver({
        generators: {
          "conductor-coordinator": mockGenerator({
            name: "conductor-coordinator",
            script: [{ text: "No rows yet. Name an issue and I will start it." }],
          }),
        },
      }),
    });
    try {
      const said = await conductor.call<string>("steer", { message: "what is on the board?" });
      expect(said).toMatch(/No rows/);
      const status = await conductor.call<{ rows: Array<{ issue: string | null }> }>("status", {});
      expect(status.rows).toEqual([]);
    } finally {
      conductor.dispose();
    }
  });

  it("files an issue when the coordinator calls seed_issue", async () => {
    const seen = { prompts: [] as string[], cwds: [] as Array<string | undefined> };
    const conductor = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], seen),
      modelResolver: createMockModelResolver({
        generators: {
          "conductor-coordinator": mockGenerator({
            name: "conductor-coordinator",
            script: [
              {
                toolCalls: [
                  {
                    toolCallId: "c1",
                    toolName: "seed_issue",
                    args: { issue: "FIX-1", phase: "implement" },
                  },
                ],
              },
              { text: "Started FIX-1." },
            ],
          }),
        },
      }),
    });
    try {
      const said = await conductor.call<string>("steer", { message: "start FIX-1" });
      expect(said).toMatch(/FIX-1/);
      const status = await conductor.call<{
        rows: Array<{ issue: string | null; taskId: string }>;
      }>("status", {});
      expect(status.rows.map((row) => row.issue)).toContain("FIX-1");
    } finally {
      conductor.dispose();
    }
  });

  it("files the operator's brief when the coordinator calls seed_issue", async () => {
    let seen: string | undefined;
    const conductor = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      buildPrompt: (run) => {
        seen = run.brief;
        return "p";
      },
      modelResolver: createMockModelResolver({
        generators: {
          "conductor-coordinator": mockGenerator({
            name: "conductor-coordinator",
            script: [
              {
                toolCalls: [
                  {
                    toolCallId: "c1",
                    toolName: "seed_issue",
                    args: {
                      issue: "FIX-1",
                      brief: "Rename getSession in client.md",
                    },
                  },
                ],
              },
              { text: "Started FIX-1." },
            ],
          }),
        },
      }),
    });
    try {
      await conductor.call<string>("steer", {
        message: "start FIX-1: Rename getSession in client.md",
      });
      const deadline = Date.now() + 8_000;
      while (seen === undefined && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(seen).toBe("Rename getSession in client.md");
    } finally {
      conductor.dispose();
    }
  });

  it("files the board phase when the coordinator passes default", async () => {
    let seen: string | undefined;
    const conductor = createConductorHarness({
      resolveClaudeAgent: scriptedAgent([sdkResult("success")], { prompts: [], cwds: [] }),
      buildPrompt: (run) => {
        seen = run.brief;
        return "p";
      },
      modelResolver: createMockModelResolver({
        generators: {
          "conductor-coordinator": mockGenerator({
            name: "conductor-coordinator",
            script: [
              {
                toolCalls: [
                  {
                    toolCallId: "c1",
                    toolName: "seed_issue",
                    args: {
                      issue: "FIX-2",
                      phase: "default",
                      brief: "Add prove() returning prove",
                    },
                  },
                ],
              },
              { text: "Started FIX-2." },
            ],
          }),
        },
      }),
    });
    try {
      await conductor.call<string>("steer", {
        message: "start FIX-2: Add prove() returning prove",
      });
      const deadline = Date.now() + 8_000;
      while (seen === undefined && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(seen).toBe("Add prove() returning prove");
      const status = await conductor.call<{
        rows: Array<{ issue: string | null; phase: string | null }>;
      }>("status", {});
      expect(status.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issue: "FIX-2", phase: "implement" }),
        ]),
      );
    } finally {
      conductor.dispose();
    }
  });
});
