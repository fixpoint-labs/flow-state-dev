/**
 * A message to a task's session while its task runs is plain conversation:
 * it runs after the task settles, outside the task. It holds no claim, so its
 * turn can't report progress on the task, and an error in it leaves the
 * task's ending as it was.
 *
 * Why it matters: the filer hears "done" when the work is done. A message
 * someone sends the busy session (a question, a note) doesn't change the
 * brief or the output, so it must not delay the task's settle, write onto its
 * row, or fail its attempt. Words meant to change open work are a steer.
 *
 * On the real engine, through the board host: `lead` files a task for
 * `eng.doer`, whose task turn sends a message to its own session while it
 * runs (a delivered row in the message log, and its delivery dispatched), so
 * the message waits on the session's reply line behind the task's turn.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, markDispatcher } from "@flow-state-dev/core";
import { dispatchThroughSeam, type BlockContext } from "@flow-state-dev/core/types";
import { currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { defineSessionBoard, filingConversationBoard, workerConfigSchema, workerTaskEntry, type WorkerManifest } from "../src";
import { messageLogOf } from "../src/messages/message-log";
import { WORKER_MESSAGE_ENTRY } from "../src/messages/keys";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
const WORKERS = [worker("lead", { flow: "coordinator", delegates: ["eng.doer"] }), worker("eng.doer", { flow: "doer" })];

/** What the message's turn saw, from inside its own run. */
type Seen = { at: number; claimed: boolean; statuses: string[]; reported?: string };

function doerFlow(installation: WorkerInstallation, seen: Seen[], behaviour: { throwInMessage: boolean }) {
  const board = defineSessionBoard({ installation, flowKind: "doer" });
  const doorInput = z.object({ message: z.string() });

  // The task's turn sends a message to its own session: delivered, and its
  // delivery dispatched, so it queues behind this turn.
  const sendToSelf = async (ctx: BlockContext) => {
    const id = `msg_${Math.random().toString(16).slice(2, 10)}`;
    const sessionId = ctx.session.identity.id;
    await messageLogOf(ctx).getOrCreate(id, {
      id,
      from: "lead",
      to: "eng.doer",
      text: "A question while you work.",
      exchange: id,
      fromSession: sessionId,
      fromFlow: "doer",
      toSession: sessionId,
      toFlow: "doer",
      answerTo: { sessionId, flow: "doer" },
      hop: 1,
      status: "delivered",
      at: Date.now()
    } as never);
    await dispatchThroughSeam(ctx, {
      type: "internal",
      action: WORKER_MESSAGE_ENTRY,
      flowKind: "doer",
      session: { id: sessionId },
      payload: { messageId: id },
      from: "busy-task-session-test"
    });
  };

  const turn = markDispatcher(
    handler({
      name: "busy-doer-turn",
      inputSchema: doorInput,
      outputSchema: z.unknown(),
      execute: async (input, rawCtx) => {
        const ctx = rawCtx as unknown as BlockContext;
        if (input.message.startsWith("Message ")) {
          const above = await filingConversationBoard(ctx);
          const rows = above?.tasks.list() ?? [];
          const claim = currentWorkerClaim(ctx);
          const entry: Seen = { at: Date.now(), claimed: claim !== undefined, statuses: rows.map((row) => row.status) };
          seen.push(entry);
          // A turn that could write as the task's worker would land this on the row.
          if (claim !== undefined) {
            const outcome = await above!.tasks.reportProgress!(claim.taskId, { output: "the message's checkpoint" }, { claim });
            entry.reported = outcome.outcome;
          }
          if (behaviour.throwInMessage) throw new Error("the message's turn broke");
          // No text: a woken turn's text would be relayed back as an answer, a second message.
          return "";
        }
        await sendToSelf(ctx);
        // Still working when the message arrives.
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "the work's answer";
      }
    }),
    { type: "internal", action: WORKER_MESSAGE_ENTRY }
  );

  return defineFlow({
    kind: "doer",
    configSchema: workerConfigSchema(),
    session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
    resources: { ...installation.resources, ...board.resources },
    actions: { run: { inputSchema: doorInput.strict(), block: turn, userMessage: (i: { message: string }) => i.message }, ...board.actions },
    internal: { actions: board.entries(turn, () => "judgment") },
    task: { actions: { work: workerTaskEntry({ name: "busy-doer-task", turn }) } }
  } as never);
}

async function fileOne(h: BoardHost): Promise<string> {
  const lead = await h.conversation("alice", "lead");
  const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Do the work", assignee: "eng.doer" });
  expect(filed.error, messageOf(filed.error)).toBeUndefined();
  return filed.output.taskId as string;
}

function boot(seen: Seen[], behaviour: { throwInMessage: boolean }) {
  return bootBoardHost({ standard: WORKERS, flows: (installation) => ({ doer: doerFlow(installation, seen, behaviour) }) });
}

describe("a message to a task's session while the task runs", () => {
  it("doesn't delay the settle: the task completes with its work's answer, and the message runs after, outside the task", async () => {
    const seen: Seen[] = [];
    const h = boot(seen, { throwInMessage: false });
    try {
      const taskId = await fileOne(h);
      await h.settled();

      const row = (await h.rows("alice")).find((r) => r.id === taskId)!;
      expect(row).toMatchObject({ status: "completed", output: "the work's answer", attempts: 1 });
      expect(row.checkpointed).toBeFalsy();
      // The message's turn ran once, after the task settled, holding no claim.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ claimed: false, statuses: ["completed"] });
      expect(seen[0]!.reported).toBeUndefined();
      expect(row.completedAt!).toBeLessThanOrEqual(seen[0]!.at);
    } finally {
      await h.dispose();
    }
  });

  it("leaves the task's ending unchanged when the message's turn errors", async () => {
    const seen: Seen[] = [];
    const h = boot(seen, { throwInMessage: true });
    try {
      const taskId = await fileOne(h);
      await h.settled();

      expect(seen).toHaveLength(1);
      const row = (await h.rows("alice")).find((r) => r.id === taskId)!;
      expect(row).toMatchObject({ status: "completed", output: "the work's answer", attempts: 1 });
      expect(row.error).toBeUndefined();
      expect(row.feedback).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });
});
