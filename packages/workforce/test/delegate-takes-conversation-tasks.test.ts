/**
 * A delegate takes a conversation's task only when its flow's `work` entry
 * takes tasks from a conversation's board (FIX-1842).
 *
 * A `work` entry gated to another board (DevTeam's coder takes rows only from
 * its feature ledger) refuses a conversation's task at its claim gate, where
 * nothing can write the refusal back to the conversation's row: the row sat
 * `in_progress` and the conversation never heard. So the delegate check reads
 * which board the entry takes tasks from, not only that it exists: such a
 * delegate is reported as taking nothing, a filing for it is refused, and a
 * row already filed for it fails at hand-over and the conversation hears it.
 *
 * The control is the same flow with its `work` entry built by
 * `workerTaskEntry`: it takes tasks, so the check can tell the two apart.
 */
import { describe, expect, it } from "vitest";
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import { taskLedgers } from "@flow-state-dev/orchestration/task-board";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootBoardHost, boardWorkers, messageOf, type BoardHost, hearsMessages } from "./conversation-board-harness";
import { workerMessagesResources } from "../src/messages/message-log";

const doorInput = z.object({ message: z.string() });

/**
 * A worker flow whose `work` entry takes tasks from `door`: another board's
 * ledger only (`"other-board"`), or a conversation's (`"conversation"`).
 */
function boardedFlow(installation: WorkerInstallation, flow: string, door: "other-board" | "conversation") {
  const turn = handler({ name: `${flow}-turn`, inputSchema: doorInput, execute: async () => "done" });
  const work =
    door === "conversation"
      ? workerTaskEntry({ name: `${flow}-task`, turn })
      : {
          block: turn,
          // Resolves only its own board's ledger, as a feature board's door does.
          from: taskLedgers({
            name: `${flow}-door`,
            resolve: async () => undefined,
            uses: [defineCapability({ name: `${flow}-ledger`, resources: {} })]
          })
        };
  return defineFlow({
    kind: flow,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    internal: { actions: hearsMessages(installation, flow) },
    actions: { respond: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { work } }
  } as never);
}

function boot(): BoardHost {
  const worker = (id: string, declared: Record<string, unknown>) => ({ id, declared, body: "", skills: [] });
  return bootBoardHost({
    standard: [
      ...boardWorkers(),
      worker("eng.coder", { flow: "boarded", description: "Codes from its own board." }),
      worker("eng.doer", { flow: "conversational", description: "Does a conversation's tasks." }),
      worker("intake", { flow: "coordinator", delegates: ["eng.coder", "eng.doer", "eng.tasker"] })
    ],
    flows: (installation) => ({
      boarded: boardedFlow(installation, "boarded", "other-board"),
      conversational: { flow: boardedFlow(installation, "conversational", "conversation"), roles: ["contributor"] }
    })
  });
}

const file = async (host: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

describe("a delegate whose work entry takes tasks from another board only (FIX-1842)", () => {
  it("is listed as taking nothing, beside one whose work entry takes a conversation's tasks", async () => {
    const host = boot();
    try {
      const conv = await host.conversation("alice", "intake");
      const listed = await host.act("alice", conv, "listDelegates", {});
      expect(listed.error, messageOf(listed.error)).toBeUndefined();
      const takes = Object.fromEntries(
        (listed.output.delegates as Array<{ worker: string; takes: string }>).map((d) => [d.worker, d.takes])
      );
      expect(takes).toEqual({ "eng.coder": "nothing", "eng.doer": "tasks", "eng.tasker": "tasks" });
    } finally {
      await host.dispose();
    }
  });

  it("is refused at filing, naming why; the control files and its task completes", async () => {
    const host = boot();
    try {
      const conv = await host.conversation("alice", "intake");
      const refused = await file(host, conv, { goal: "look at the repo", assignee: "eng.coder" });
      expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('runs on flow "boarded", which takes no task') });
      expect(await host.rows("alice")).toEqual([]);

      const filed = await file(host, conv, { goal: "look at the repo", assignee: "eng.doer" });
      expect(filed.ok).toBe(true);
      await host.settled();
      expect(await host.row("alice", await host.filingOf("alice", conv), filed.taskId!)).toMatchObject({
        status: "completed",
        assignee: "eng.doer"
      });
    } finally {
      await host.dispose();
    }
  });

  it("fails a row already filed for it at hand-over, and the conversation hears it, rather than sitting in progress", async () => {
    const host = boot();
    try {
      const conv = await host.conversation("alice", "intake");
      // The second row waits on the first, so it is still pending when the
      // test rewrites it to name the coder, as a filing before this check left it.
      const first = await file(host, conv, { goal: "first [slow:100]", assignee: "eng.tasker" });
      const second = await file(host, conv, { goal: "look at the repo", assignee: "eng.tasker", deps: [first.taskId] });
      const filing = await host.filingOf("alice", conv);
      const stored = await host.row("alice", filing, second.taskId!);
      expect(stored?.status).toBe("pending");
      const { partition: _partition, ...row } = stored!;
      await host.writeRow("alice", filing, { ...(row as Task), assignee: "eng.coder" });
      await host.settled();
      // The next touch of the board starts what's owed.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      await host.settled();

      expect(await host.row("alice", filing, second.taskId!)).toMatchObject({
        status: "errored",
        error: expect.stringContaining('wasn\'t handed to "eng.coder"')
      });
      const lines = (await host.messages(conv)).map((message) => message.text);
      expect(lines.filter((line) => line.includes("look at the repo") && line.includes("failed for good"))).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});
