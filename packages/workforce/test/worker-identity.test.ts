/**
 * The default layer of a worker's prompt (FIX-2334): every worker on the
 * built-in worker flow is told, first, who it is and who it can reach.
 *
 * Asserted off the system message the model was actually handed, through the
 * real flow on an installation. Without the layer a worker has no name of its
 * own to give (every Teammates lab worker answered "ChatGPT"), so the specs
 * pin what the model reads: its name and team at the very front, the workers a
 * message reaches, and a task-only worker listed as one to file a task with.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorInstance } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { rosterDisplayName, rosterTeamName } from "../src/messages/recipients";
import { TOOL_USE_RULE } from "../src/messages/worker-identity";
import { bootBoardHost, type BoardHost } from "./conversation-board-harness";

const worker = (id: string, declared: Record<string, unknown>, body = "", teamName?: string): WorkerManifest => ({
  id,
  declared,
  body,
  skills: [],
  ...(teamName === undefined ? {} : { teamName })
});

const roster = (): WorkerManifest[] => [
  worker("eng.ana", { name: "Ana", description: "Runs the team's work with you." }, "Ana's own instructions.", "Engineering"),
  worker("eng.bo", { description: "Knows colours." }, "You help.", "Engineering"),
  worker("eng.tasker", { flow: "tasker", description: "Does tasks." }, "", "Engineering")
];

/** The system message of each model call the agent turn made, in order. */
function systemsOf(model: MockGeneratorInstance): string[] {
  return model.calls.map((call) => {
    const messages = call.input as Array<{ role: string; content: unknown }>;
    const system = messages.find((message) => message.role === "system");
    return typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
  });
}

async function turnOf(h: BoardHost, workerId: string): Promise<void> {
  const created = await h.create("alice", "agent", { state: { workerId } });
  if (created.status !== 201) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(created.body)}`);
  await h.post("alice", created.body.session!.id, "respond", { message: "Who are you?" }, "agent");
  await h.settled();
}

describe("what a worker is told first", () => {
  it("opens with its own name, team and role, ahead of its team's and its own instructions", async () => {
    const agentAnswer = mockGenerator({ script: [{ when: () => true, then: { text: "Hi." } }] });
    const h = bootBoardHost({ standard: roster(), agentAnswer, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "" } }] }) });
    try {
      await turnOf(h, "eng.ana");
      const [system] = systemsOf(agentAnswer);
      expect(system).toBeDefined();
      expect(system!.startsWith("You are Ana, on the Engineering team.")).toBe(true);
      expect(system).toContain("Your worker id, eng.ana, is the address others reach you by, not your name.");
      expect(system).toContain("Your role, as the people you work with read it: Runs the team's work with you.");
      // The worker's own file still follows, and the layer is ahead of it.
      expect(system!.indexOf("Ana's own instructions.")).toBeGreaterThan(system!.indexOf(TOOL_USE_RULE));
    } finally {
      await h.dispose();
    }
  });

  it("lists who a message reaches, never itself, and a task-only worker as one to file a task with", async () => {
    const agentAnswer = mockGenerator({ script: [{ when: () => true, then: { text: "Hi." } }] });
    const h = bootBoardHost({ standard: roster(), agentAnswer, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "" } }] }) });
    try {
      await turnOf(h, "eng.ana");
      const system = systemsOf(agentAnswer)[0]!;
      const [teammates, tasksOnly] = system.split("Workers that take tasks only");
      expect(teammates).toContain("- bo (eng.bo): Knows colours.");
      expect(teammates).not.toContain("(eng.ana)");
      expect(teammates).not.toContain("eng.tasker");
      expect(tasksOnly).toContain("File one a task with createTask");
      expect(tasksOnly).toContain("- tasker (eng.tasker): Does tasks.");
      expect(system).toContain(TOOL_USE_RULE);
    } finally {
      await h.dispose();
    }
  });

  it("names a worker with no name: by its id's worker segment", async () => {
    const agentAnswer = mockGenerator({ script: [{ when: () => true, then: { text: "Hi." } }] });
    const h = bootBoardHost({ standard: roster(), agentAnswer, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "" } }] }) });
    try {
      await turnOf(h, "eng.bo");
      const system = systemsOf(agentAnswer)[0]!;
      expect(system.startsWith("You are bo, on the Engineering team.")).toBe(true);
      expect(system).toContain("- Ana (eng.ana): Runs the team's work with you.");
    } finally {
      await h.dispose();
    }
  });
});

describe("a roster worker's display name and team", () => {
  it("falls back to the id's segments, and an org worker has no team", () => {
    expect(rosterDisplayName({ id: "eng.bo", name: null })).toBe("bo");
    expect(rosterDisplayName({ id: "eng.bo", name: "Bo" })).toBe("Bo");
    expect(rosterTeamName({ id: "eng.bo", teamName: null })).toBe("eng");
    expect(rosterTeamName({ id: "eng.bo", teamName: "Engineering" })).toBe("Engineering");
    expect(rosterTeamName({ id: "shift-coordinator", teamName: null })).toBeUndefined();
  });
});
