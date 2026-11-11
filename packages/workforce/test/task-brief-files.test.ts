/**
 * A task's files are its brief's, for every run (FIX-2522; epic FIX-2516
 * ER-7). A user sends a screenshot to a conversation; a task filed on that
 * turn keeps its own copy on its row; each run of the task, the first and a
 * re-run, reads it in a session of its own, and finds it on its brief line,
 * where a generator worker's model reads it with the brief.
 *
 * The control the goal check names, a brief that hands on its text only,
 * fails here on the re-run: its line carries no file and the run reads none.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { readHarnessAttachments } from "@flow-state-dev/core/harness";
import type { FileContent } from "@flow-state-dev/core/items";
import { runAction } from "@flow-state-dev/engine";
import { sessionBlobOwner } from "@flow-state-dev/engine/internal";
import { z } from "zod";
import { conversationLedgerAt, conversationLedgerResources } from "../src/conversation-board/ledger";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { workerMessagesResources } from "../src/messages/message-log";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootBoardHost, boardWorkers, hearsMessages, ORG, type BoardHost } from "./conversation-board-harness";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);
const doorInput = z.object({ message: z.string() });

/** One run of the task: its attempt, and the bytes of the brief's files it read. */
type Seen = { attempt: number; sessionId: string; read: string[] };

/** A worker whose turn reads its task's brief files; `[fail-first]` fails its first attempt, so the board runs it again. */
function lookerFlow(installation: WorkerInstallation, seen: Seen[]) {
  const turn = handler({
    name: "looker-turn",
    inputSchema: doorInput,
    resources: { ...installation.resources, ...conversationLedgerResources },
    execute: async (input, ctx) => {
      const state = ctx.session.state as Record<string, unknown>;
      const tasks = await conversationLedgerAt(ctx as never, state.filingSessionId as string);
      const task = tasks?.get(state.taskId as string);
      const files = await readHarnessAttachments(ctx, task?.attachments ?? []);
      const attempt = task?.attempts ?? 0;
      seen.push({ attempt, sessionId: ctx.session.identity.id, read: files.map((file) => file.base64()) });
      if (input.message.includes("[fail-first]") && attempt < 2) throw new Error("not this time");
      return "looked";
    },
  });
  const door = handler({ name: "looker-door", inputSchema: doorInput, execute: async () => "hi" });
  return defineFlow({
    kind: "looker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources, ...workerMessagesResources },
    internal: { actions: hearsMessages(installation, "looker") },
    actions: { respond: { block: door, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { work: workerTaskEntry({ name: "looker-task", turn }) } },
  } as never);
}

function boot(seen: Seen[]): BoardHost {
  return bootBoardHost({
    standard: [
      ...boardWorkers(),
      { id: "eng.looker", declared: { flow: "looker", description: "Looks at screenshots." }, body: "", skills: [] },
      { id: "intake", declared: { flow: "coordinator", delegates: ["eng.looker"] }, body: "", skills: [] },
    ],
    flows: (installation) => ({ looker: { flow: lookerFlow(installation, seen), roles: ["contributor"] } }),
  });
}

/** A screenshot the user sent to `conv`: stored, and claimed into that conversation as its send would. */
async function sentTo(host: BoardHost, conv: string): Promise<FileContent> {
  const { stores } = await host.state.getRuntime();
  const id = "b_screenshot000000000000000000001";
  const alice = { userId: "alice", orgId: ORG };
  await stores.blobs!.put({ id, bytes: PNG, mediaType: "image/png", filename: "bug.png", uploader: alice });
  await stores.blobs!.claim(id, { uploader: alice, owner: sessionBlobOwner(conv), send: "send-1" });
  await stores.blobs!.confirm(id, sessionBlobOwner(conv), "send-1");
  return { type: "file", mediaType: "image/png", filename: "bug.png", data: toBlobRef(id) };
}

/** File a task on the turn that carried `attachments`, as the conversation's create-task tool does. */
async function fileOnTurn(host: BoardHost, conv: string, goal: string, attachments: FileContent[]): Promise<string> {
  const runtime = await host.state.getRuntime();
  const result = (await runAction({
    flow: host.instances.coordinator!,
    actionName: "createTask_tasks",
    input: { goal, assignee: "eng.looker", maxAttempts: 3 },
    userId: "alice",
    orgId: ORG,
    sessionId: conv,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
    attachments,
  })) as { output?: { ok: boolean; taskId?: string; error?: string } };
  expect(result.output?.ok, result.output?.error).toBe(true);
  return result.output!.taskId!;
}

describe("a task's brief files", () => {
  it("reach its first run and its re-run, in a session the conversation doesn't own, on its brief line", async () => {
    const seen: Seen[] = [];
    const host = boot(seen);
    try {
      const conv = await host.conversation("alice", "intake");
      const filing = await host.filingOf("alice", conv);
      const shot = await sentTo(host, conv);
      const taskId = await fileOnTurn(host, conv, "say what the screenshot shows [fail-first]", [shot]);
      await host.settled();

      const task = await host.row("alice", filing, taskId);
      expect(task?.status).toBe("completed");
      // A copy of its own, not the conversation's file.
      expect(task?.attachments).toHaveLength(1);
      expect(task!.attachments![0]!.data).not.toBe(shot.data);

      // The first run, and the re-run after it failed: each read the screenshot.
      const bytes = Buffer.from(PNG).toString("base64");
      expect(seen.map((run) => run.attempt)).toEqual([1, 2]);
      for (const run of seen) expect(run.read).toEqual([bytes]);

      // Each run's brief line carries the brief's file, for a model to read with the brief.
      const runSession = task?.run?.sessionId;
      const briefFiles = (await host.requestsOf(runSession!))
        .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
        .filter((item) => item.type === "message" && item.role === "user")
        .map((item) => (item.content as Array<{ type: string; data?: string }>).filter((part) => part.type === "file").map((part) => part.data));
      expect(briefFiles.length).toBeGreaterThan(0);
      for (const files of briefFiles) expect(files).toEqual([task!.attachments![0]!.data]);
    } finally {
      await host.dispose();
    }
  });

  it("outlive the conversation's own file", async () => {
    const seen: Seen[] = [];
    const host = boot(seen);
    try {
      const conv = await host.conversation("alice", "intake");
      const shot = await sentTo(host, conv);
      const { stores } = await host.state.getRuntime();
      await fileOnTurn(host, conv, "look later", [shot]);
      await host.settled();
      // The conversation's files go with it; the task's copy is the board's.
      await stores.blobs!.deleteOwner(sessionBlobOwner(conv));
      expect(await stores.blobs!.head("b_screenshot000000000000000000001")).toBeUndefined();
      expect(seen).toHaveLength(1);
      expect(seen[0]!.read).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});
