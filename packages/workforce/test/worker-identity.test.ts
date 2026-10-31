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
import { rosterDisplayName, rosterTeamName, workerRecipients } from "../src/messages/recipients";
import type { RosterWorker, WorkerInstallation } from "../src/workers/installation";
import { DELEGATE_MARK, DELEGATE_RULE, TOOL_USE_RULE, workerIdentityPrompt } from "../src/messages/worker-identity";
import { DELEGATES_STATE } from "../src/delegates/delegate-keys";
import { bootBoardHost, type BoardHost } from "./conversation-board-harness";

const worker = (id: string, declared: Record<string, unknown>, body = "", teamName?: string): WorkerManifest => ({
  id,
  declared,
  body,
  skills: [],
  ...(teamName === undefined ? {} : { teamName })
});

const roster = (): WorkerManifest[] => [
  worker("eng.ana", { name: "Ana", description: "Runs the team's work with you.", delegates: ["eng.tasker", "eng.cy"] }, "Ana's own instructions.", "Engineering"),
  worker("eng.bo", { description: "Knows colours." }, "You help.", "Engineering"),
  worker("eng.tasker", { flow: "tasker", description: "Does tasks." }, "", "Engineering"),
  worker("eng.cy", { description: "Researches." }, "You research.", "Engineering")
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
      // A delegate listed only as someone to message got whole pieces of work
      // as messages, which no board row tracks: it is marked as taking tasks.
      expect(teammates).toContain(`- cy (eng.cy): Researches. ${DELEGATE_MARK}`);
      expect(teammates).toContain("- bo (eng.bo): Knows colours.\n");
      expect(teammates).toContain(DELEGATE_RULE);
    } finally {
      await h.dispose();
    }
  });

  it("never tells a worker to file a task for a task-only worker that isn't its delegate", async () => {
    const agentAnswer = mockGenerator({ script: [{ when: () => true, then: { text: "Hi." } }] });
    const h = bootBoardHost({ standard: roster(), agentAnswer, judgment: mockGenerator({ script: [{ when: () => true, then: { text: "" } }] }) });
    try {
      // bo lists no delegates: the board would refuse its task for tasker.
      await turnOf(h, "eng.bo");
      const system = systemsOf(agentAnswer)[0]!;
      expect(system).not.toContain("File one a task with createTask");
      expect(system).toContain("filed by the workers they report to, not by you:\n- tasker (eng.tasker)");
      expect(system).not.toContain(DELEGATE_MARK);
      expect(system).not.toContain(DELEGATE_RULE);
    } finally {
      await h.dispose();
    }
  });

  // FIX-2364: a lead or main session works things out first too, not just the
  // workers it hands work to. A coordinator's judgment turn shares the agent
  // turn, so it is told the same rule, ahead of its own file.
  it("tells a coordinator's own turn to work things out first, ahead of its own instructions", async () => {
    const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "On it." } }] });
    const lead = worker("eng.lead", { flow: "coordinator", description: "Hands out the work.", delegates: ["eng.cy"] }, "Lead's own instructions.", "Engineering");
    const h = bootBoardHost({ standard: [...roster(), lead], judgment });
    try {
      const created = await h.create("alice", "coordinator", { state: { workerId: "eng.lead" } });
      if (created.status !== 201) throw new Error(`creating eng.lead's session failed: ${JSON.stringify(created.body)}`);
      await h.post("alice", created.body.session!.id, "respond", { message: "Review what the last task did." }, "coordinator");
      await h.settled();
      const system = systemsOf(judgment)[0]!;
      expect(system.startsWith("You are lead, on the Engineering team.")).toBe(true);
      expect(system).toContain(TOOL_USE_RULE);
      expect(system.indexOf("Lead's own instructions.")).toBeGreaterThan(system.indexOf(TOOL_USE_RULE));
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

describe("the delegates the layer marks", () => {
  // The board takes a task for the conversation's own list once an add or a
  // remove has set it, so the mark follows that list, not the worker's file.
  const installation = {
    workerFlows: () => ({ agent: { roles: ["contributor"] }, chat: { roles: [] } }),
    roster: async () =>
      [
        { id: "eng.ana", name: null, teamName: null, description: null, flow: "agent", delegates: ["eng.cy", "eng.di"] },
        { id: "eng.bo", name: null, teamName: null, description: null, flow: "agent", delegates: [] },
        { id: "eng.cy", name: null, teamName: null, description: null, flow: "agent", delegates: [] },
        { id: "eng.di", name: null, teamName: null, description: null, flow: "chat", delegates: [] }
      ] as unknown as RosterWorker[]
  } as unknown as WorkerInstallation;
  const layerFor = (state: Record<string, unknown>) =>
    workerIdentityPrompt({ session: { state: { workerId: "eng.ana", ...state } } } as never, installation);

  it("marks the file's delegates while the conversation has set none", async () => {
    const layer = (await layerFor({}))!;
    expect(layer).toContain(`- cy (eng.cy) ${DELEGATE_MARK}`);
    expect(layer).not.toContain(`- bo (eng.bo) ${DELEGATE_MARK}`);
  });

  // The board refuses a task for a worker whose flow takes none, so naming one
  // as taking tasks sends the model to a createTask that fails.
  it("doesn't mark a delegate whose flow takes no task", async () => {
    const layer = (await layerFor({}))!;
    expect(layer).toContain("- di (eng.di)\n");
    expect(layer).not.toContain(`- di (eng.di) ${DELEGATE_MARK}`);
  });

  it("marks the conversation's own list once it is set: an added one marked, a removed one not", async () => {
    const layer = (await layerFor({ [DELEGATES_STATE]: [{ worker: "eng.bo" }] }))!;
    expect(layer).toContain(`- bo (eng.bo) ${DELEGATE_MARK}`);
    expect(layer).toContain("- cy (eng.cy)\n");
    expect(layer).not.toContain(`- cy (eng.cy) ${DELEGATE_MARK}`);
  });
});

describe("a teammate list cut at its cap", () => {
  // Past the cap a delegate can be missing from the list, so the layer must
  // not tell the model the list is complete and no lookup is needed.
  it("sends the model to listDelegates for the rest instead of calling the list current", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `eng.w${i}`, name: null, teamName: null, description: null, flow: "agent", delegates: [] }));
    const installation = {
      workerFlows: () => ({ agent: { roles: ["contributor"] } }),
      roster: async () => [{ id: "eng.ana", name: null, teamName: null, description: null, flow: "agent", delegates: [] }, ...many] as unknown as RosterWorker[]
    } as unknown as WorkerInstallation;
    const layer = (await workerIdentityPrompt({ session: { state: { workerId: "eng.ana" } } } as never, installation))!;
    expect(layer).toContain("call listDelegates for the rest");
    expect(layer).not.toContain("no tool call is needed");
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

describe("one roster read per request", () => {
  // A request id can be reused once its record is deleted, by another user;
  // the read must not carry over to the new request (its incarnation differs).
  const rosterOf = (ids: string[]) => {
    let reads = 0;
    const installation = {
      workerFlows: () => ({}),
      roster: async () => {
        reads += 1;
        return ids.map((id): RosterWorker => ({ id, name: null, teamName: null, description: null, flow: "agent", delegates: [] }) as unknown as RosterWorker);
      }
    } as unknown as WorkerInstallation;
    return { installation, reads: () => reads };
  };
  const ctxOf = (incarnation: string) => ({ request: { identity: { id: "req_reused" }, incarnation } }) as never;

  it("reads once within a request, and again under a reused id's new incarnation", async () => {
    const first = rosterOf(["eng.ana", "eng.bo"]);
    await workerRecipients(ctxOf("inc-1"), first.installation, "eng.ana");
    await workerRecipients(ctxOf("inc-1"), first.installation, "eng.ana");
    expect(first.reads()).toBe(1);
    const second = await workerRecipients(ctxOf("inc-2"), first.installation, "eng.ana");
    expect(first.reads()).toBe(2);
    expect(second.self?.id).toBe("eng.ana");
  });
});
