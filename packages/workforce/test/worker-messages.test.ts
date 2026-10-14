/**
 * Any worker with a conversation can message any other on its user's roster
 * (FIX-1989): `messageWorker` lands a line in the recipient's own
 * conversation, opening it at the worker's derived address when needed, and
 * wakes its turn; an answer names the message it answers and goes back to the
 * session that asked. No task row, no delegate, no task-chain count.
 *
 * Everything is read from what reached each session and the store, never
 * from the tool's return value alone.
 */
import { describe, expect, it } from "vitest";
import { runAction } from "@flow-state-dev/engine";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import { WORKER_MESSAGES_PATTERN } from "../src/messages/message-log";
import { messageWorkerInputSchema } from "../src/messages/message-tool";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";

const ORG = "acme";

/** A scripted model input as text, with its escapes dropped. */
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

/** The first call whose input mentions `marker` calls `toolName` with `args` once; later calls in that turn say `after`. */
function callOnce(marker: string, toolName: string, args: unknown, after = "Sent."): MockGeneratorScriptEntry[] {
  let called = false;
  return [
    { when: (input: unknown) => called && textOf(input).includes(marker), then: { text: after } },
    {
      when: (input: unknown) => {
        if (called || !textOf(input).includes(marker)) return false;
        called = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: `call-${marker}`, toolName, args }] }
    }
  ];
}

/**
 * The first turn woken by a message from `from` whose text holds `marker`
 * answers it once with `text`, naming the message it read; then says `after`.
 */
function answerOnce(from: string, marker: string, text: string, after = "Answered."): MockGeneratorScriptEntry[] {
  let answered = false;
  const step = { toolCalls: [{ toolCallId: `answer-${marker}`, toolName: "messageWorker", args: {} as Record<string, unknown> }] };
  return [
    { when: (input: unknown) => answered && textOf(input).includes(marker), then: { text: after } },
    {
      when: (input: unknown) => {
        const text_ = textOf(input);
        const message = new RegExp(`Message (msg_\\w+) from ${from.replace(".", "\\.")}`).exec(text_);
        if (answered || message === null || !text_.includes(marker)) return false;
        answered = true;
        step.toolCalls[0]!.args = { to: from, text, replyTo: message[1] };
        return true;
      },
      then: step
    }
  ];
}

const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "OK." } };

async function agentSession(h: BoardHost, userId: string, workerId: string): Promise<string> {
  const created = await h.create(userId, "agent", { state: { workerId } });
  if (created.status !== 201) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(created.body)}`);
  return created.body.session!.id;
}

/** Every message row in `userId`'s log, from the store. */
async function logRows(h: BoardHost, userId: string) {
  const runtime = await h.state.getRuntime();
  const prefix = WORKER_MESSAGES_PATTERN.replace("*", "");
  const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, prefix);
  return Object.values(entries).map((value) => value.state as Record<string, any>);
}

/** Every tool output item a session holds, oldest first. */
async function toolOutputs(h: BoardHost, sessionId: string): Promise<unknown[]> {
  return (await h.requestsOf(sessionId))
    .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
    .filter((item) => item.type === "tool_output")
    .map((item) => item.output ?? item.error);
}

describe("a worker messages another worker", () => {
  it("lands a line from the sender in the recipient's own conversation, opened at its derived address, and wakes its turn", async () => {
    const judgment = mockGenerator({ script: [{ when: (input) => textOf(input).includes("What is the codename?"), then: { text: "Thinking." } }, fallback] });
    const h = bootBoardHost({
      judgment,
      agentAnswer: mockGenerator({ script: [...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }), fallback] })
    });
    try {
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      await h.settled();

      const lead = await h.client("alice").findWorkerSession({ worker: "lead" });
      expect(lead, "the lead's conversation was opened").toBeDefined();
      const lines = await h.messages(lead!.id);
      expect(lines).toContainEqual({ agentName: "otto", text: "From otto: What is the codename?" });
      expect(lines.some((line) => line.text === "Thinking."), "the lead's turn ran").toBe(true);

      const rows = await logRows(h, "alice");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ from: "otto", to: "lead", text: "What is the codename?", status: "delivered", hop: 1, fromSession: otto, toSession: lead!.id });
      // A message is not a task.
      expect(await h.rows("alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("what a worker knows of who it can message", () => {
  it("is the tool's description: every roster worker with a conversation but itself, by id and description", async () => {
    const descriptions: string[] = [];
    const h = bootBoardHost({
      standard: teamWorkers(),
      agentAnswer: mockGenerator({ script: [fallback] }),
      observeTools: (block, _names, options) => {
        if (block !== "agent-answer") return;
        const tool = ((options as { tools?: Array<{ name: string; description?: string }> }).tools ?? []).find((t) => t.name === "messageWorker");
        if (tool !== undefined) descriptions.push(tool.description ?? "");
      }
    });
    try {
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Hello" }, "agent");
      await h.settled();
      expect(descriptions).toHaveLength(1);
      const listed = descriptions[0]!.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).split(":")[0]);
      expect(listed).toContain("helper-a");
      expect(listed).toContain("lead");
      expect(descriptions[0]).toContain("- helper-a: Knows colours.");
      expect(listed).not.toContain("otto");
      expect(listed).not.toContain("eng.tasker");
    } finally {
      await h.dispose();
    }
  });
});

describe("the log, read by an app", () => {
  it("is read through the user's roster session, and holds only that user's messages", async () => {
    const h = bootBoardHost({
      agentAnswer: mockGenerator({ script: [...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }), fallback] })
    });
    try {
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      await h.settled();
      const list = async (userId: string) => {
        const roster = await h.create(userId, "workforce-roster", {});
        const sessionId = roster.body.session!.id;
        const path = ["sessions", sessionId, "resources", "workforceMessages"];
        const res = await (await h.state.getRouter() as any).GET(
          new Request(`http://localhost/api/flows/${path.join("/")}`, { headers: { "x-user": userId } }),
          { params: { path } }
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as { items: Array<{ clientData: Record<string, unknown> }> }).items.map((item) => item.clientData);
      };
      expect(await list("alice")).toMatchObject([{ from: "otto", to: "lead", text: "What is the codename?" }]);
      expect(await list("bob")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("an answer", () => {
  it("names the message it answers and lands in the session that asked, under the answerer's name, waking it", async () => {
    const agentAnswer = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("It is Bluebird."), then: { text: "The codename is Bluebird." } },
        ...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }),
        fallback
      ]
    });
    const h = bootBoardHost({
      judgment: mockGenerator({ script: [...answerOnce("otto", "What is the codename?", "It is Bluebird."), fallback] }),
      agentAnswer
    });
    try {
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      await h.settled();

      const lines = await h.messages(otto);
      expect(lines).toContainEqual({ agentName: "lead", text: "From lead: It is Bluebird." });
      expect(lines.at(-1)?.text, "otto's turn ran after the answer").toBe("The codename is Bluebird.");

      const rows = await logRows(h, "alice");
      const question = rows.find((row) => row.from === "otto")!;
      const answer = rows.find((row) => row.from === "lead")!;
      expect(answer).toMatchObject({ to: "otto", replyTo: question.id, exchange: question.id, toSession: otto, status: "delivered", hop: 2 });
    } finally {
      await h.dispose();
    }
  });
});

/** The board's workers, a coordinator that files for `otto`, and two more agent workers. */
function teamWorkers(): WorkerManifest[] {
  const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });
  return [
    ...boardWorkers(),
    worker("chief", { flow: "coordinator", delegates: ["otto"] }, "Hand the work to otto."),
    worker("helper-a", { description: "Knows colours.", delegates: ["helper-b"] }, "You help."),
    worker("helper-b", { description: "Knows numbers." }, "You help.")
  ];
}

describe("a message sent from a task's turn", () => {
  it("makes no row, and the answer lands in the sender's own conversation and wakes it, since the task's session ended", async () => {
    const agentAnswer = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("From helper-a") || textOf(input).includes("from helper-a"), then: { text: "Helper A says teal." } },
        ...answerOnce("otto", "favourite colour", "Teal."),
        ...callOnce("Ask helper-a for its favourite colour", "messageWorker", { to: "helper-a", text: "What is your favourite colour?" }, "Asked."),
        fallback
      ]
    });
    const h = bootBoardHost({ standard: teamWorkers(), agentAnswer });
    try {
      const chief = await h.conversation("alice", "chief");
      const filed = await h.act("alice", chief, "dispatchTask_tasks", { goal: "Ask helper-a for its favourite colour", assignee: "otto" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await h.settled();

      // Only the task itself is a row: the message made none.
      const rows = await h.rows("alice");
      expect(rows.map((row) => row.assignee)).toEqual(["otto"]);
      expect(rows[0]!.status).toBe("completed");

      const own = await h.client("alice").findWorkerSession({ worker: "otto" });
      expect(own, "otto's own conversation was opened by the answer").toBeDefined();
      const lines = await h.messages(own!.id);
      expect(lines).toContainEqual({ agentName: "helper-a", text: "From helper-a: Teal." });
      expect(lines.at(-1)?.text).toBe("Helper A says teal.");

      const log = await logRows(h, "alice");
      const question = log.find((row) => row.from === "otto")!;
      expect(question.answerTo).toMatchObject({ sessionId: own!.id, flow: "agent" });
      expect(question.fromSession).not.toBe(own!.id);
    } finally {
      await h.dispose();
    }
  });
});

/**
 * A ring: otto → helper-a → helper-b → otto. Each turn a message wakes passes
 * it on to the next worker once; the user's line in otto's conversation
 * starts it.
 */
function ringScript(): MockGeneratorScriptEntry[] {
  const next: Record<string, string> = { otto: "helper-a", "helper-a": "helper-b", "helper-b": "otto" };
  const handled = new Set<string>();
  const step = { toolCalls: [{ toolCallId: "pass", toolName: "messageWorker", args: {} as Record<string, unknown> }] };
  return [
    {
      when: (input: unknown) => {
        const text = textOf(input);
        const all = [...text.matchAll(/Message (msg_\w+) from ([\w.-]+)/g)];
        const started = text.lastIndexOf("start the ring");
        const last = all.at(-1);
        // Whichever came last: the user's line, or a message.
        const key = last !== undefined && last.index! > started ? last[1]! : `user-${started}`;
        if (handled.has(key) || (last === undefined && started < 0)) return false;
        handled.add(key);
        const me = last !== undefined && last.index! > started ? next[last[2]!]! : "otto";
        step.toolCalls[0]!.toolCallId = `pass-${key}`;
        step.toolCalls[0]!.args = { to: next[me]!, text: "Pass this on to the next one, always." };
        return true;
      },
      then: step
    },
    { when: () => true, then: { text: "Passed." } }
  ];
}

describe("the hop limit", () => {
  it("stops a ring through three workers at 6 messages with no user in between, and a user's line lets it go on", async () => {
    const h = bootBoardHost({ standard: teamWorkers(), agentAnswer: mockGenerator({ script: ringScript() }) });
    try {
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Please start the ring" }, "agent");
      await h.settled();

      let rows = (await logRows(h, "alice")).sort((a, b) => a.hop - b.hop);
      expect(rows.map((row) => `${row.from}>${row.to}@${row.hop}`)).toEqual([
        "otto>helper-a@1",
        "helper-a>helper-b@2",
        "helper-b>otto@3",
        "otto>helper-a@4",
        "helper-a>helper-b@5",
        "helper-b>otto@6"
      ]);
      // The seventh send was refused, in the conversation of the worker that tried it.
      const refusals = (await toolOutputs(h, otto.id)).filter((output) => /hop_limit/.test(JSON.stringify(output)));
      expect(refusals).toHaveLength(1);

      // One more line from the user: one more round.
      await h.post("alice", otto.id, "run", { message: "Please start the ring again" }, "agent");
      await h.settled();
      rows = await logRows(h, "alice");
      expect(rows).toHaveLength(12);
      expect(rows.filter((row) => row.hop === 1)).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });
});

/** One turn, on "message every worker", messages five workers at once. */
function fanOutScript(): MockGeneratorScriptEntry[] {
  const toAll = ["helper-a", "helper-b", "lead", "pm", "chief"].map((to, i) => ({
    toolCallId: `all-${i}`,
    toolName: "messageWorker",
    args: { to, text: "Heads up: the release moved." }
  }));
  let called = false;
  return [
    {
      when: (input) => {
        if (called || !textOf(input).includes("message every worker")) return false;
        called = true;
        return true;
      },
      then: { toolCalls: toAll }
    },
    fallback
  ];
}

describe("a Lab's own limits", () => {
  it("takes hireWorkforce's messages.hopLimit and messages.perTurn", async () => {
    const h = bootBoardHost({ standard: teamWorkers(), agentAnswer: mockGenerator({ script: ringScript() }), hire: { messages: { hopLimit: 2 } } });
    try {
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Please start the ring" }, "agent");
      await h.settled();
      expect((await logRows(h, "alice")).map((row) => row.hop).sort()).toEqual([1, 2]);
    } finally {
      await h.dispose();
    }
    const fan = bootBoardHost({ standard: teamWorkers(), agentAnswer: mockGenerator({ script: fanOutScript() }), hire: { messages: { perTurn: 2 } } });
    try {
      const otto = await fan.client("alice").ensureWorkerSession({ worker: "otto" });
      await fan.post("alice", otto.id, "run", { message: "Please message every worker on the roster" }, "agent");
      await fan.settled();
      expect((await logRows(fan, "alice")).filter((row) => row.from === "otto")).toHaveLength(2);
    } finally {
      await fan.dispose();
    }
    expect(() => bootBoardHost({ hire: { messages: { hopLimit: 0 } } })).toThrow(/messages.hopLimit must be a whole number/);
  });
});

describe("the per-turn limit", () => {
  it("lets one turn send 3 messages and refuses the rest", async () => {
    const h = bootBoardHost({ standard: teamWorkers(), agentAnswer: mockGenerator({ script: fanOutScript() }) });
    try {
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Please message every worker on the roster" }, "agent");
      await h.settled();
      const rows = await logRows(h, "alice");
      expect(rows.filter((row) => row.from === "otto")).toHaveLength(3);
      const refused = (await toolOutputs(h, otto.id)).filter((output) => /per_turn_limit/.test(JSON.stringify(output)));
      expect(refused).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });
});

describe("the hop count through a delegation", () => {
  it("carries into a task the woken worker files, so a message from that task counts on from it", async () => {
    const h = bootBoardHost({
      standard: teamWorkers(),
      agentAnswer: mockGenerator({
        script: [
          ...callOnce("Tell otto the number", "messageWorker", { to: "otto", text: "The number is 7." }, "Told."),
          ...callOnce("have helper-b tell otto", "dispatchTask", { goal: "Tell otto the number", assignee: "helper-b" }, "Filed."),
          ...callOnce("Please ask helper-a", "messageWorker", { to: "helper-a", text: "Please have helper-b tell otto the number." }, "Asked."),
          fallback
        ]
      })
    });
    try {
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Please ask helper-a" }, "agent");
      await h.settled();
      const rows = await logRows(h, "alice");
      expect(rows.map((row) => `${row.from}>${row.to}@${row.hop}`).sort()).toEqual(["helper-b>otto@2", "otto>helper-a@1"]);
      // The task is a task: one row, on helper-a's board, for helper-b.
      expect((await h.rows("alice")).map((row) => row.assignee)).toEqual(["helper-b"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("who can be messaged", () => {
  it("refuses another user's worker as missing, a task-only worker with 'file a task', a turnless coordinator, and itself; writes nothing", async () => {
    const calls = [
      { to: "bob.friend", text: "Hi Bob's worker." },
      { to: "nobody", text: "Hi." },
      { to: "eng.tasker", text: "Hi coder." },
      { to: "rota", text: "Hi rota." },
      { to: "otto", text: "Hi me." }
    ].map((args, i) => ({ toolCallId: `who-${i}`, toolName: "messageWorker", args }));
    let called = false;
    const h = bootBoardHost({
      standard: teamWorkers(),
      agentAnswer: mockGenerator({
        script: [
          {
            when: (input) => {
              if (called || !textOf(input).includes("try everyone")) return false;
              called = true;
              return true;
            },
            then: { toolCalls: calls }
          },
          fallback
        ]
      })
    });
    try {
      expect((await h.hire("bob", { id: "bob.friend", flow: "agent", instructions: "Bob's." })).error).toBeUndefined();
      const otto = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await h.post("alice", otto.id, "run", { message: "Please try everyone" }, "agent");
      await h.settled();
      const outputs = (await toolOutputs(h, otto.id)).map((output) => JSON.stringify(output));
      expect(outputs).toHaveLength(5);
      expect(outputs[0]).toMatch(/no_worker: no worker \\"bob.friend\\" on your roster/);
      expect(outputs[1]).toMatch(/no_worker: no worker \\"nobody\\" on your roster/);
      expect(outputs[2]).toMatch(/takes_tasks_only.*File a task/);
      expect(outputs[3]).toMatch(/no_turn/);
      expect(outputs[4]).toMatch(/not_yourself/);
      expect(await logRows(h, "alice")).toEqual([]);
      expect(await logRows(h, "bob")).toEqual([]);
      const bobs = await (await h.state.getRuntime()).stores.session.list({ userId: "bob" } as never);
      expect((bobs as Array<{ flowKind: string }>).filter((session) => session.flowKind === "agent")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a dispatch create at another user's derived conversation address in the create check", async () => {
    const h = bootBoardHost({ standard: teamWorkers() });
    try {
      const bobsAddress = await deriveWorkerSessionId({ userId: "bob", orgId: ORG, flow: "agent", criteria: { worker: "otto" } });
      const verdict = await h.installation.createCheck({
        principal: { userId: "alice", orgId: ORG },
        sessionId: bobsAddress,
        flow: { kind: "agent", id: "agent" },
        state: { workerId: "otto" },
        via: "dispatch",
        readCollectionItem: async () => undefined
      });
      expect(verdict).toMatchObject({ ok: false, status: 403 });
    } finally {
      await h.dispose();
    }
  });

  it("takes no sender, no wait and no other key: the tool's input is strict", () => {
    expect(messageWorkerInputSchema.safeParse({ to: "lead", text: "Hi." }).success).toBe(true);
    expect(messageWorkerInputSchema.safeParse({ to: "lead", text: "Hi.", from: "lead" }).success).toBe(false);
    expect(messageWorkerInputSchema.safeParse({ to: "lead", text: "Hi.", wait: true }).success).toBe(false);
  });
});

describe("a busy recipient", () => {
  it("hears a message after the turn it is running, never inside it, and nothing is dropped", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = true;
    const judgment = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("What is the codename?"), then: { text: "Heard otto." } },
        { when: (input) => textOf(input).includes("long question"), then: { text: "Long answer." } },
        fallback
      ]
    });
    const h = bootBoardHost({
      judgment,
      agentAnswer: mockGenerator({ script: [...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }), fallback] }),
      afterModelCall: async (block) => {
        if (block === "coordinator-judgment" && holding) {
          holding = false;
          await held;
        }
      }
    });
    try {
      const lead = await h.client("alice").ensureWorkerSession({ worker: "lead" });
      await h.post("alice", lead.id, "run", { message: "A long question" }, "coordinator");
      for (let i = 0; i < 200 && judgment.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      // The message is sent while the lead's turn is still running.
      for (let i = 0; i < 300 && (await logRows(h, "alice")).length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect((await h.messages(lead.id)).some((line) => line.text.startsWith("From otto"))).toBe(false);
      release();
      await h.settled();
      const texts = (await h.messages(lead.id)).map((line) => line.text);
      expect(texts.indexOf("Long answer.")).toBeGreaterThanOrEqual(0);
      expect(texts.indexOf("From otto: What is the codename?")).toBeGreaterThan(texts.indexOf("Long answer."));
      expect(texts.at(-1)).toBe("Heard otto.");
    } finally {
      release();
      await h.dispose();
    }
  });
});

describe("delivery", () => {
  /** Deliver `messageId` to `sessionId`'s onWorkerMessage again, as a second copy of the dispatch would. */
  async function deliverAgain(h: BoardHost, flow: string, sessionId: string, messageId: string) {
    const runtime = await h.state.getRuntime();
    const run = await runAction({
      flow: h.instances[flow]!,
      actionName: "onWorkerMessage",
      input: { messageId },
      userId: "alice",
      orgId: ORG,
      sessionId,
      source: "internal",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    expect(run.error, messageOf(run.error)).toBeUndefined();
    await h.settled();
  }

  it("acts on a message id once: a second copy lands no line and wakes no turn, and a copy into another session does nothing", async () => {
    const judgment = mockGenerator({ script: [{ when: (input) => textOf(input).includes("What is the codename?"), then: { text: "Thinking." } }, fallback] });
    const h = bootBoardHost({
      judgment,
      agentAnswer: mockGenerator({ script: [...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }), fallback] })
    });
    try {
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      await h.settled();
      const lead = (await h.client("alice").findWorkerSession({ worker: "lead" }))!;
      const [row] = await logRows(h, "alice");
      const before = { lines: (await h.messages(lead.id)).length, turns: judgment.calls.length };

      await deliverAgain(h, "coordinator", lead.id, row!.id);
      expect((await h.messages(lead.id)).length).toBe(before.lines);
      expect(judgment.calls.length).toBe(before.turns);

      const elsewhere = await h.conversation("alice", "pm");
      await deliverAgain(h, "coordinator", elsewhere, row!.id);
      expect(await h.messages(elsewhere)).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("marks the row refused, and the tool says why, when the host refuses the dispatch", async () => {
    const h = bootBoardHost({
      agentAnswer: mockGenerator({ script: [...callOnce("ask the lead", "messageWorker", { to: "lead", text: "What is the codename?" }), fallback] })
    });
    try {
      const lost = await h.loseDispatches("onWorkerMessage");
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "run", { message: "Please ask the lead" }, "agent");
      await h.settled();
      lost.restore();
      const [row] = await logRows(h, "alice");
      expect(row).toMatchObject({ status: "refused", reason: expect.stringMatching(/^dispatch-rejected/) });
      const outputs = (await toolOutputs(h, otto)).map((output) => JSON.stringify(output));
      expect(outputs[0]).toMatch(/not_delivered.*dispatch-rejected/);
    } finally {
      await h.dispose();
    }
  });
});

