/**
 * `workerTaskEntry({ block })`: a `work` entry whose flow takes the task
 * itself rather than one message, as a coding worker does.
 *
 * The block is handed the task as the board packed it, plus the claim the
 * gate verified (`claim`: the ledger and partition the row was read from).
 * That claim is the server's: a task that carries a `claim` of its own in its
 * input never moves it. The conversation hears each ending once, through the
 * entry's own notice, the same as a `turn` entry's.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { conversationLedgerResources } from "../src/conversation-board/ledger";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootBoardHost, boardWorkers, messageOf, type BoardHost, hearsMessages } from "./conversation-board-harness";
import { workerMessagesResources } from "../src/messages/message-log";

/** What the block was handed, per run. */
type Seen = { taskId: string; goal: string; input: unknown; claim: unknown };

const doorInput = z.object({ message: z.string() });

/** A worker flow whose `work` entry takes the task itself: `[fail]` in the goal throws. */
function blockFlow(installation: WorkerInstallation, seen: Seen[]) {
  const run = handler({
    name: "blocker-run",
    inputSchema: taskWorkerInputSchema.extend({ claim: z.unknown() }),
    resources: { ...installation.resources, ...conversationLedgerResources },
    execute: async (task, ctx) => {
      await installation.resolveWorker(ctx, "blocker");
      seen.push({ taskId: task.taskId, goal: task.goal, input: task.input, claim: task.claim });
      if (task.goal.includes("[fail]")) throw new Error("the block could not do it");
      return { answer: `did: ${task.goal}` };
    }
  });
  const door = handler({ name: "blocker-door", inputSchema: doorInput, execute: async () => "hi" });
  return defineFlow({
    kind: "blocker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources, ...workerMessagesResources },
    internal: { actions: hearsMessages(installation, "blocker") },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { work: workerTaskEntry({ name: "blocker-task", block: run }) } }
  } as never);
}

function boot(seen: Seen[]): BoardHost {
  return bootBoardHost({
    standard: [
      ...boardWorkers(),
      { id: "eng.blocker", declared: { flow: "blocker", description: "Takes the task itself." }, body: "", skills: [] },
      { id: "intake", declared: { flow: "coordinator", delegates: ["eng.blocker"] }, body: "", skills: [] }
    ],
    flows: (installation) => ({ blocker: { flow: blockFlow(installation, seen), roles: ["contributor"] } })
  });
}

const file = async (host: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  const output = result.output as { ok: boolean; taskId?: string; error?: string };
  expect(output.ok, output.error).toBe(true);
  return output.taskId!;
};

describe("workerTaskEntry with a block", () => {
  it("hands the block the task and the claim the gate verified, never one from the task, and the conversation hears it once", async () => {
    const seen: Seen[] = [];
    const host = boot(seen);
    try {
      const conv = await host.conversation("alice", "intake");
      const filing = await host.filingOf("alice", conv);
      const taskId = await file(host, conv, {
        goal: "look at the repo",
        assignee: "eng.blocker",
        input: { claim: { collectionId: "someone-elses", partition: "theirs" } }
      });
      await host.settled();

      // The row's identity nonce rides the claim too, so the block can fence on it.
      const incarnationId = (await host.row("alice", filing, taskId))?.incarnationId;
      expect(incarnationId).toEqual(expect.any(String));
      expect(seen).toEqual([
        {
          taskId,
          goal: "look at the repo",
          input: { claim: { collectionId: "someone-elses", partition: "theirs" } },
          claim: { collectionId: "tasks", partition: filing, incarnationId }
        }
      ]);
      expect(await host.row("alice", filing, taskId)).toMatchObject({
        status: "completed",
        output: { answer: "did: look at the repo" }
      });
      const lines = (await host.messages(conv)).map((message) => message.text);
      expect(lines.filter((line) => line.includes("look at the repo") && line.includes("completed"))).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("sends one notice when the block's task fails for good", async () => {
    const seen: Seen[] = [];
    const host = boot(seen);
    try {
      const conv = await host.conversation("alice", "intake");
      const filing = await host.filingOf("alice", conv);
      const taskId = await file(host, conv, { goal: "break it [fail]", assignee: "eng.blocker" });
      await host.settled();

      expect(await host.row("alice", filing, taskId)).toMatchObject({ status: "errored" });
      const lines = (await host.messages(conv)).map((message) => message.text);
      expect(lines.filter((line) => line.includes("break it") && line.includes("the block could not do it"))).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});

describe("workerTaskEntry's options", () => {
  const turn = handler({ name: "t", inputSchema: doorInput, execute: async () => "x" });
  const block = handler({ name: "b", inputSchema: z.unknown(), execute: async () => "x" });

  it("refuses a turn and a block together, when it is built", () => {
    expect(() => workerTaskEntry({ name: "both", turn, block } as never)).toThrow(/`turn` or `block`, not both/);
  });

  it("refuses neither, when it is built", () => {
    expect(() => workerTaskEntry({ name: "neither" } as never)).toThrow(/`turn` or `block`/);
  });
});
