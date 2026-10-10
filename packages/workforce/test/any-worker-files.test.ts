/**
 * Any worker files for its delegates that take a task (FIX-1802 P1: V1, V2 and
 * V5's first half).
 *
 * The grant is the session's delegate list, read per call: a worker whose
 * session lists a delegate that takes a task gets Orchestration's eight task
 * tools on its turn and the `<tool>_tasks` actions on its session, on any
 * flow that carries them. With none, its turn has none of the eight and the
 * actions answer `no_delegation_board`. A task session still can't file
 * (P2 lifts that with the split).
 *
 * Each leg acts through the flows' public actions and their scripted turns,
 * and reads what it asserts back from the store or from the tools the model
 * was actually handed, never from an action's own say-so.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src/manifest";
import { createWorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost, type BoardHostOptions } from "./conversation-board-harness";

/** The capability's tool list as a turn with no ask host gets it: the list is chosen per turn (FIX-1816). */
const resolvedControlTools = (list: unknown): GeneratorTool[] =>
  (typeof list === "function" ? list({}) : (list ?? [])) as GeneratorTool[];

/** The task-board capability's own tool names, read off a fresh instance: never a count. */
function taskToolNames(): string[] {
  const capability = createTaskToolsCapability() as unknown as {
    __presetDefs?: { tools?: { controlTools?: unknown } };
  };
  const names = resolvedControlTools(capability.__presetDefs?.tools?.controlTools).map((tool) => tool.config?.name ?? tool.name);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

const TASK_TOOLS = taskToolNames();

const SKILL_MD = "---\nname: triage\ndescription: How to triage incoming work.\n---\nSort the work before handing it out.";

const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({
  id,
  declared,
  body,
  skills: []
});

/** The board's standard workers, and the ones these legs file from. */
function filingWorkers(): WorkerManifest[] {
  return [
    ...boardWorkers(),
    // An `agent` worker, not a coordinator, whose delegate takes tasks.
    worker("ana", { delegates: ["eng.tasker"], description: "Files work." }, "You file the work you're asked to."),
    // An `agent` worker whose delegate is another `agent` worker.
    worker("pal", { delegates: ["otto"] }, "You hand work to otto."),
    // An `agent` worker with no delegates.
    worker("solo", {}, "You work alone."),
    // An `agent` worker whose only delegate takes posts and no task: nothing uses it (BR-4).
    worker("quiet", { delegates: ["eng.helper"] }, "You work alone."),
    // A routing coordinator whose delegates take only posts (BR-2).
    worker("router", { flow: "coordinator", delegates: ["eng.helper"] }, "Hand each post on."),
    // A worker on a flow that carries no task tools, listing a delegate that takes tasks (BR-3).
    worker("idle", { flow: "tasker", delegates: ["eng.tasker"] }),
    // A coordinator that hands posts and tasks to `ana`.
    worker("chief", { flow: "coordinator", delegates: ["ana"] }, "Hand the work to ana.")
  ];
}

/** A scripted model input as text, with its escapes dropped, for a predicate to read. */
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

/** A step that answers any call whose input mentions `marker` and none of `unless`. */
const on = (marker: string, then: Record<string, unknown>, unless: string[] = []) => ({
  when: (input: unknown) => {
    const text = textOf(input);
    return text.includes(marker) && !unless.some((other) => text.includes(other));
  },
  then: then as never
});

/**
 * The first turn whose input mentions `marker` calls `tool` once, then says
 * `after`; a scripted model sees the same messages on every step of one
 * turn, so the call is served once.
 */
function callOnce(marker: string, tool: { toolName: string; args: unknown }, after: string): MockGeneratorScriptEntry[] {
  let called = false;
  return [
    { when: (input: unknown) => called && textOf(input).includes(marker), then: { text: after } },
    {
      when: (input: unknown) => {
        if (called || !textOf(input).includes(marker)) return false;
        called = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: `call-${marker}`, ...tool }] }
    }
  ];
}

/** A turn that files one task with `addTask`, then says so; a notice it hears is answered. */
function fileScript(marker: string, goal: string, assignee: string): MockGeneratorScriptEntry[] {
  return [
    on("completed by", { text: "Heard it." }),
    on("failed for good", { text: "Heard it failed." }),
    ...callOnce(marker, { toolName: "addTask", args: { goal, assignee } }, "Filed."),
    on("TASK:", { text: "Done the task." }),
    { when: () => true, then: { text: "OK." } }
  ];
}

type Seen = { block: string | undefined; names: string[]; input: string };

/** A host over the filing workers, recording every tool list a model was handed. */
function host(options: BoardHostOptions & { agentScript?: MockGeneratorScriptEntry[]; judgmentScript?: MockGeneratorScriptEntry[] } = {}) {
  const seen: Seen[] = [];
  const booted = bootBoardHost({
    standard: filingWorkers(),
    agentAnswer: mockGenerator({ script: options.agentScript ?? [{ when: () => true, then: { text: "OK." } }] }),
    judgment: mockGenerator({ script: options.judgmentScript ?? [{ when: () => true, then: { text: "OK." } }] }),
    observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) }),
    ...options
  });
  return Object.assign(booted, { seen });
}

/** An `agent` session of `worker` for `userId`. */
async function agentSession(h: BoardHost, userId: string, workerId: string): Promise<string> {
  const created = await h.create(userId, "agent", { state: { workerId } });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`creating ${workerId}'s session failed (${created.status}): ${JSON.stringify(created.body)}`);
  }
  return created.body.session!.id;
}

const file = async (h: BoardHost, userId: string, sessionId: string, input: Record<string, unknown>, flow: string) => {
  const result = await h.act(userId, sessionId, "addTask_tasks", input, flow);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

const list = async (h: BoardHost, userId: string, sessionId: string, flow: string) => {
  const result = await h.act(userId, sessionId, "listTasks_tasks", {}, flow);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok?: boolean; error?: string; tasks?: Array<{ id: string; goal: string; status: string }> };
};

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
};

/** How many of the eight task tools a tool list carries, each counted. */
const taskToolsIn = (names: readonly string[]) => names.filter((name) => TASK_TOOLS.includes(name));

/** The tool lists the turns whose input mentions `marker` were handed. */
const turnsAbout = (seen: Seen[], marker: string) => seen.filter((entry) => entry.input.includes(marker));

describe("a worker files for its delegates that take a task (BR-1)", () => {
  it("files on an `agent` worker's own session, from the app, and the task completes and is heard there", async () => {
    const h = host();
    try {
      const talk = await agentSession(h, "alice", "ana");
      const filed = await file(h, "alice", talk, { goal: "Audit licenses", assignee: "eng.tasker" }, "agent");
      expect(filed).toMatchObject({ ok: true, taskId: expect.any(String) });
      await h.settled();
      // On this session's own board, at Alice's scope, worked by the delegate.
      const rows = await h.rows("alice");
      expect(rows.map((row) => [row.goal, row.assignee, row.status, row.createdBy])).toEqual([
        ["Audit licenses", "eng.tasker", "completed", "alice"]
      ]);
      expect(h.runs.map((run) => [run.worker, run.userId])).toEqual([["eng.tasker", "alice"]]);
      // Its ending is heard in the session that filed it, once.
      const heard = (await h.requestsOf(talk)).filter((request) => request.actionName === "onTaskSettled");
      expect(heard).toHaveLength(1);
      expect(heard[0]!.status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });

  it("files through an `agent` worker's own tool, for an `agent` delegate, with the same check", async () => {
    const h = host({ agentScript: fileScript("hand it to otto", "Draft the memo TASK: memo", "otto") });
    try {
      const talk = await agentSession(h, "alice", "pal");
      const turn = await h.act("alice", talk, "run", { message: "hand it to otto" }, "agent");
      expect(turn.error, messageOf(turn.error)).toBeUndefined();
      await h.settled();
      await list(h, "alice", talk, "agent");
      await h.settled();
      const rows = await h.rows("alice");
      expect(rows.map((row) => [row.goal, row.assignee, row.status])).toEqual([["Draft the memo TASK: memo", "otto", "completed"]]);
      // The filing worker heard it, in a turn of its own.
      const messages = (await h.messages(talk)).map((message) => message.text);
      expect(messages).toContain("Heard it.");
    } finally {
      await h.dispose();
    }
  });

  for (const skill of [false, true]) {
    it(`puts each of the eight task tools on an \`agent\` turn exactly once, ${skill ? "with a skill loaded" : "with no skill"} (ER-32)`, async () => {
      const standard = filingWorkers().map((manifest) =>
        manifest.id === "ana" && skill
          ? {
              ...manifest,
              declared: { ...manifest.declared, skills: { active: ["triage"] } },
              skills: [{ name: "triage", skillMd: SKILL_MD }]
            }
          : manifest
      );
      const h = host({ standard });
      try {
        const talk = await agentSession(h, "alice", "ana");
        const turn = await h.act("alice", talk, "run", { message: "what's on the board?" }, "agent");
        expect(turn.error, messageOf(turn.error)).toBeUndefined();
        await h.settled();
        const turns = turnsAbout(h.seen, "what's on the board?");
        expect(turns).toHaveLength(1);
        const [{ names, input }] = turns as [Seen];
        expect(input.includes("Sort the work before handing it out.")).toBe(skill);
        for (const tool of TASK_TOOLS) expect(names.filter((name) => name === tool), `${tool} on the turn`).toHaveLength(1);
        expect(names.filter((name) => name === "runBoard").length).toBeLessThanOrEqual(1);
        expect(new Set(names).size).toBe(names.length);
      } finally {
        await h.dispose();
      }
    });
  }

  it("is refused, by core, when a second task-tools capability instance joins an `agent` turn (ER-32's control)", async () => {
    const h = host({ agent: { uses: [() => [createTaskToolsCapability()]] } });
    try {
      const talk = await agentSession(h, "alice", "ana");
      const turn = await h.act("alice", talk, "run", { message: "what's on the board?" }, "agent");
      expect(messageOf(turn.error)).toMatch(/has two tools named "addTask"/);
    } finally {
      await h.dispose();
    }
  });
});

describe("a worker with no delegate that takes a task (BR-2, BR-3, BR-4)", () => {
  const cases = [
    { name: "an `agent` worker with no delegates", worker: "solo", flow: "agent", block: "agent-answer" },
    { name: "an `agent` worker whose only delegate takes posts", worker: "quiet", flow: "agent", block: "agent-answer" },
    { name: "a routing coordinator whose delegates take only posts", worker: "router", flow: "coordinator", block: "coordinator-judgment" }
  ];
  for (const { name, worker: workerId, flow, block } of cases) {
    it(`gets none of the eight task tools, and its app's addTask answers no_delegation_board: ${name}`, async () => {
      const h = host();
      try {
        const sessionId = flow === "agent" ? await agentSession(h, "alice", workerId) : await h.conversation("alice", workerId);
        const turn = await h.act("alice", sessionId, "run", { message: "anything to file?" }, flow);
        expect(turn.error, messageOf(turn.error)).toBeUndefined();
        await h.settled();
        const turns = turnsAbout(h.seen, "anything to file?").filter((entry) => entry.block === block);
        expect(turns.length).toBeGreaterThan(0);
        for (const entry of turns) expect(taskToolsIn(entry.names)).toEqual([]);

        const refused = await file(h, "alice", sessionId, { goal: "do it", assignee: "eng.tasker" }, flow);
        expect(refused).toMatchObject({ ok: false, error: "no_delegation_board" });
        expect(await h.rows("alice")).toEqual([]);
        expect(h.runs).toEqual([]);
      } finally {
        await h.dispose();
      }
    });
  }

  it("loads a file that lists a task-taking delegate on a flow without the task tools, and gives it no task actions (BR-3)", async () => {
    const h = host();
    try {
      const created = await h.create("alice", "tasker", { state: { workerId: "idle" } });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      await expect(
        h.act("alice", created.body.session!.id, "addTask_tasks", { goal: "x", assignee: "eng.tasker" }, "tasker")
      ).rejects.toThrow(/does not define action "addTask_tasks"/);
      expect(await h.rows("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the grant follows the session's delegates, read per call (BR-5)", () => {
  it("shows the tools after an add, hides them after removing the last, and the filed row still runs and is heard", async () => {
    const h = host();
    try {
      const talk = await agentSession(h, "alice", "solo");
      expect((await file(h, "alice", talk, { goal: "early", assignee: "eng.tasker" }, "agent")).error).toBe("no_delegation_board");

      const added = await h.act("alice", talk, "addDelegate", { worker: "eng.tasker" }, "agent");
      expect(added.error, messageOf(added.error)).toBeUndefined();
      expect((await h.act("alice", talk, "run", { message: "turn after the add" }, "agent")).error).toBeUndefined();
      const [after] = turnsAbout(h.seen, "turn after the add") as [Seen];
      expect(taskToolsIn(after.names).sort()).toEqual([...TASK_TOOLS].sort());

      const filed = await file(h, "alice", talk, { goal: "Count seats [slow:100]", assignee: "eng.tasker" }, "agent");
      expect(filed.ok).toBe(true);
      const removed = await h.act("alice", talk, "removeDelegate", { worker: "eng.tasker" }, "agent");
      expect(removed.error, messageOf(removed.error)).toBeUndefined();

      expect((await h.act("alice", talk, "run", { message: "turn after the remove" }, "agent")).error).toBeUndefined();
      const gone = turnsAbout(h.seen, "turn after the remove").at(-1)!;
      expect(taskToolsIn(gone.names)).toEqual([]);
      expect((await file(h, "alice", talk, { goal: "late", assignee: "eng.tasker" }, "agent")).error).toBe("no_delegation_board");

      // The row filed while it could still file runs, settles and is heard.
      await h.settled();
      const rows = await h.rows("alice");
      expect(rows.map((row) => [row.goal, row.status])).toEqual([["Count seats [slow:100]", "completed"]]);
      const heard = (await h.requestsOf(talk)).filter((request) => request.actionName === "onTaskSettled");
      expect(heard).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("a notice to an `agent` worker that arrives mid-reply", () => {
  it("waits for the reply to end, then runs once, as a coordinator's does", async () => {
    let calls = 0;
    let talk = "";
    const seen = { noticeArrivedMidReply: false, heardMidReply: true };
    const heardIn = async (h: BoardHost) => (await h.messages(talk)).filter((message) => message.text === "Heard it.");
    const h: BoardHost = host({
      agentScript: fileScript("count the chairs", "Count chairs", "eng.tasker"),
      // Hold the filing reply open, after its model call has filed, until the
      // notice has been dispatched and for half a second after.
      afterModelCall: async () => {
        if (++calls !== 1) return;
        const settled = async () =>
          (await h.requestsOf(talk)).filter((request) => request.actionName === "onTaskSettled").length > 0;
        seen.noticeArrivedMidReply = await until(settled);
        seen.heardMidReply = await until(async () => (await heardIn(h)).length > 0, 500);
      }
    });
    try {
      talk = await agentSession(h, "alice", "ana");
      await h.post("alice", talk, "run", { message: "count the chairs" }, "agent");
      await h.settled();
      expect(seen.noticeArrivedMidReply).toBe(true);
      expect(seen.heardMidReply).toBe(false);
      expect(await heardIn(h)).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("a session that lost its grant still pays what its rows owe (BR-5)", () => {
  it("replays a lost notice on its next touch, though its board answers no_delegation_board", async () => {
    const h = host();
    try {
      const talk = await agentSession(h, "alice", "solo");
      expect((await h.act("alice", talk, "addDelegate", { worker: "eng.tasker" }, "agent")).error).toBeUndefined();
      const lost = await h.loseDispatches("onTaskSettled");
      expect((await file(h, "alice", talk, { goal: "Count chairs", assignee: "eng.tasker" }, "agent")).ok).toBe(true);
      await h.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      lost.restore();
      expect((await h.act("alice", talk, "removeDelegate", { worker: "eng.tasker" }, "agent")).error).toBeUndefined();

      expect(await list(h, "alice", talk, "agent")).toMatchObject({ ok: false, error: "no_delegation_board" });
      await h.settled();
      const heard = (await h.requestsOf(talk)).filter((request) => request.actionName === "onTaskSettled");
      expect(heard.map((request) => request.status)).toEqual(["completed"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the grant is server-written, never input (BR-6)", () => {
  it("refuses an `agent` session create that seeds delegates, with 400 naming the field", async () => {
    const h = host();
    try {
      const created = await h.create("alice", "agent", { state: { workerId: "solo", delegates: [{ worker: "eng.tasker" }] } });
      expect(created.status).toBe(400);
      expect(created.body.error).toMatch(/"delegates"/);
    } finally {
      await h.dispose();
    }
  });

  it("ignores a delegate list on an action's input: a worker the session doesn't list is refused", async () => {
    const h = host();
    try {
      const talk = await agentSession(h, "alice", "ana");
      const forged = await h.act(
        "alice",
        talk,
        "addTask_tasks",
        { goal: "sneak it in", assignee: "eng.writer", delegates: [{ worker: "eng.writer" }] },
        "agent"
      );
      const output = forged.output as { ok?: boolean; error?: string } | undefined;
      // Refused either by the input schema or by the roster: nothing stored.
      if (forged.error === undefined) expect(output?.error).toMatch(/^unknown_assignee: "eng\.writer"/);
      const run = await h.act("alice", talk, "run", { message: "hi", delegates: ["eng.writer"] }, "agent");
      expect(run.error).toBeDefined();
      expect(await h.rows("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("who it files for, and which board (V2)", () => {
  it("files for a delegate that takes tasks and no post, which a post skips (BR-9)", async () => {
    const h = host();
    try {
      const conv = await h.conversation("alice", "router");
      expect((await h.act("alice", conv, "addDelegate", { worker: "eng.tasker" })).error).toBeUndefined();
      const filed = await file(h, "alice", conv, { goal: "Tidy the docs", assignee: "eng.tasker" }, "coordinator");
      expect(filed.ok).toBe(true);
      await h.settled();
      expect((await h.rows("alice")).map((row) => [row.assignee, row.status])).toEqual([["eng.tasker", "completed"]]);
    } finally {
      await h.dispose();
    }
  });

  it("keeps two sessions of one worker apart: each lists and runs only its own (BR-13)", async () => {
    const h = host();
    try {
      const one = await agentSession(h, "alice", "ana");
      const two = await agentSession(h, "alice", "ana");
      expect((await file(h, "alice", one, { goal: "one's", assignee: "eng.tasker" }, "agent")).ok).toBe(true);
      expect((await file(h, "alice", two, { goal: "two's", assignee: "eng.tasker" }, "agent")).ok).toBe(true);
      await h.settled();
      expect((await list(h, "alice", one, "agent")).tasks?.map((task) => task.goal)).toEqual(["one's"]);
      expect((await list(h, "alice", two, "agent")).tasks?.map((task) => task.goal)).toEqual(["two's"]);
      expect(new Set((await h.rows("alice")).map((row) => row.partition)).size).toBe(2);
    } finally {
      await h.dispose();
    }
  });

  it("files from a workstream lead's session, and hears the ending there (BR-12)", async () => {
    const h = host();
    try {
      const lead = await agentSession(h, "alice", "ana");
      // A lead's workstream session, as a workstream's open leaves it: the
      // session names its workstream in readonly state. Written to the store,
      // since opening one needs a project; the board reads nothing of it.
      const stored = await h.session(lead);
      await (await h.state.getRuntime()).stores.session.set(
        lead,
        {
          ...stored,
          state: { ...stored.state, workstreamId: "private/launch/billing" },
          version: stored.version + 1,
          updatedAt: Date.now()
        } as never,
        "any"
      );
      expect((await file(h, "alice", lead, { goal: "Price the tiers", assignee: "eng.tasker" }, "agent")).ok).toBe(true);
      await h.settled();
      expect((await h.rows("alice")).map((row) => [row.goal, row.status])).toEqual([["Price the tiers", "completed"]]);
      const heard = (await h.requestsOf(lead)).filter((request) => request.actionName === "onTaskSettled");
      expect(heard.map((request) => request.status)).toEqual(["completed"]);
    } finally {
      await h.dispose();
    }
  });

  it("files from a delegate's session onto that session's own board; the post is answered and the work reports there (BR-12)", async () => {
    const h = host({
      judgmentScript: [
        ...callOnce("plan the launch", { toolName: "handOff", args: { worker: "ana" } }, "Handed on."),
        { when: () => true, then: { text: "OK." } }
      ],
      agentScript: fileScript("plan the launch", "Book the room", "eng.tasker")
    });
    try {
      const conv = await h.conversation("alice", "chief");
      expect((await h.act("alice", conv, "run", { message: "plan the launch" })).error).toBeUndefined();
      await h.settled();
      const rows = await h.rows("alice");
      expect(rows.map((row) => [row.goal, row.assignee, row.status])).toEqual([["Book the room", "eng.tasker", "completed"]]);
      // On ana's delegate session's board, not the conversation's.
      const chiefFiling = await h.filingOf("alice", conv);
      expect(rows[0]!.partition).not.toBe(encodeUserSegment(chiefFiling));
      // ana's answer landed in the conversation; it wasn't held for the task.
      const lines = (await h.messages(conv)).filter((message) => message.agentName === "ana").map((message) => message.text);
      expect(lines).toContain("Filed.");
      // The task's notice reached ana's delegate session, not the conversation.
      const settledRuns = (await (await h.state.getRuntime()).stores.request.list({})).filter(
        (request) => request.actionName === "onTaskSettled"
      );
      expect(settledRuns).toHaveLength(1);
      expect(settledRuns[0]!.sessionId).not.toBe(conv);
      const delegateSession = await h.session(settledRuns[0]!.sessionId);
      expect((delegateSession.state as Record<string, unknown>).workerId).toBe("ana");
    } finally {
      await h.dispose();
    }
  });
});

describe("a task session still can't file in P1 (S6, V5)", () => {
  it("gives a task session no task tools and no board, whatever its worker's delegates", async () => {
    const h = host();
    try {
      const conv = await h.conversation("alice", "chief");
      const filed = await file(h, "alice", conv, { goal: "TASK: split this up", assignee: "ana" }, "coordinator");
      expect(filed.ok).toBe(true);
      await h.settled();
      // ana took it, in a task session whose turn carried none of the eight.
      const taskTurns = turnsAbout(h.seen, "TASK: split this up").filter((entry) => entry.block === "agent-answer");
      expect(taskTurns.length).toBeGreaterThan(0);
      for (const entry of taskTurns) expect(taskToolsIn(entry.names)).toEqual([]);
      const worked = (await (await h.state.getRuntime()).stores.request.list({})).filter((request) => request.actionName === "work");
      expect(worked).toHaveLength(1);
      const taskSession = await h.session(worked[0]!.sessionId);
      expect((taskSession.state as Record<string, unknown>).taskId).toBe(filed.taskId);
      const refused = await file(h, "alice", taskSession.id, { goal: "a piece", assignee: "eng.tasker" }, "agent");
      expect(refused).toMatchObject({ ok: false, error: "no_delegation_board" });
      expect((await h.rows("alice")).map((row) => row.goal)).toEqual(["TASK: split this up"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a standard worker's delegates must be standard (BR-10a)", () => {
  it("refuses at load an `agent` worker naming a worker that isn't standard", () => {
    expect(() =>
      createWorkerInstallation({
        standardWorkers: [worker("ana", { delegates: ["bobs.helper"] }, "Files work.")]
      })
    ).toThrow(/standard worker "ana" names "bobs\.helper" in `delegates:`, which isn't a standard worker/);
  });
});
