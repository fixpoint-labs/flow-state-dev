/**
 * An app changes a task on a conversation's board with one shared call each
 * (FIX-2381): `createInboxClient(client).board(at)` cancels, steers,
 * releases, retries and re-files, through a real `Client` on the host's
 * router, as the signed-in user. Each leg reads the row back from the store
 * (or, for re-file, from the browser's own read of the board), never from the
 * helper's return alone.
 *
 * Controls: the same calls aimed at a board the flow doesn't hold must all go
 * red, and a refusal must reject, not resolve.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { createInboxClient, type BoardActions } from "@flow-state-dev/orchestration/inbox";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** A gate a `[hold:<name>]` task waits on, and the call that opens it. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 5000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

/** `userId`'s board actions on conversation `sessionId`'s board `board`, through a real client on the host's router. */
function boardOf(host: BoardHost, userId: string, sessionId: string, board = "tasks"): BoardActions {
  const inProcess = createInProcessFetch(host.state);
  const client = createClient({
    userId,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      return inProcess(input, { ...init, headers });
    }
  });
  return createInboxClient(client).board({ flowId: "coordinator", sessionId, board });
}

/** File a task on the conversation's board, as the user. Its id. */
async function file(host: BoardHost, conv: string, input: Record<string, unknown>): Promise<string> {
  const result = await host.act("alice", conv, "createTask_tasks", { assignee: "eng.tasker", ...input });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  expect(result.output, JSON.stringify(result.output)).toMatchObject({ ok: true });
  return result.output.taskId as string;
}

/** One stored row of alice's, wherever it was filed. */
const stored = async (host: BoardHost, taskId: string) => (await host.rows("alice")).find((row) => row.id === taskId);

/** The board's rows as alice's browser reads them: the collection read route's client fields. */
async function browserRows(host: BoardHost, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const path = ["sessions", sessionId, "resources", "tasks"];
  const router = (await host.state.getRouter()) as any;
  const response: Response = await router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}`, { headers: { "x-user": "alice" } }),
    { params: { path } }
  );
  const body = (await response.json()) as { items?: Array<{ clientData: Record<string, unknown> }> };
  return (body.items ?? []).map((item) => item.clientData);
}

describe("a conversation board's task actions, through the Inbox client", () => {
  it("releases, steers, cancels, re-files and retries, each read back from the board", async () => {
    const open = gate();
    const host = bootBoardHost({ holds: new Map([["open", open.opened]]) });
    try {
      const conv = await host.conversation("alice", "desk");
      const actions = boardOf(host, "alice", conv);

      // Release: a held row leaves `held` and runs.
      const held = await file(host, conv, { goal: "Write the notes", held: true });
      expect((await stored(host, held))?.status).toBe("held");
      await actions.release(held);
      expect((await stored(host, held))?.status).not.toBe("held");
      await host.settled();
      expect((await stored(host, held))?.status).toBe("completed");

      // Steer: an open task's row carries the words.
      const working = await file(host, conv, {
        goal: "Audit the licenses [hold:open]",
        title: "License audit",
        context: "Only the npm ones",
        labels: ["legal"]
      });
      const dependent = await file(host, conv, { goal: "Publish the audit", deps: [working] });
      expect(await until(async () => (await stored(host, working))?.status === "in_progress")).toBe(true);
      await actions.steer(working, "Skip the dev dependencies");
      expect((await stored(host, working))?.steers?.map((steer) => steer.message)).toContain("Skip the dev dependencies");

      // Cancel: the row reads cancelled, and the dependent the board took along is named.
      expect(await actions.cancel(working)).toEqual([dependent]);
      expect((await stored(host, working))?.status).toBe("cancelled");
      expect((await stored(host, dependent))?.status).toBe("cancelled");
      open.release();
      await host.settled();

      // Re-file the cancelled row from the browser's own read of it, one field overridden.
      const row = (await browserRows(host, conv)).find((r) => r.id === working);
      expect(row, "the browser reads the row's context").toMatchObject({ context: "Only the npm ones" });
      const refiled = await actions.refile(row as never, { goal: "Audit the licenses again" });
      expect(refiled).not.toBe(working);
      expect(await stored(host, refiled)).toMatchObject({
        goal: "Audit the licenses again",
        title: "License audit",
        context: "Only the npm ones",
        assignee: "eng.tasker",
        labels: ["legal"]
      });
      await host.settled();

      // Retry: an errored task comes back as the same task, and runs again.
      const failing = await file(host, conv, { goal: "Ship it [fail-until:2]", maxAttempts: 1 });
      await host.settled();
      expect((await stored(host, failing))?.status).toBe("errored");
      await actions.retry(failing);
      await host.settled();
      expect((await stored(host, failing))?.status).toBe("completed");
      expect(host.runs.filter((run) => run.taskId === failing)).toHaveLength(2);
    } finally {
      open.release();
      await host.dispose();
    }
  });

  it("rejects the board's refusal with its words, and writes nothing", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const actions = boardOf(host, "alice", conv);
      const done = await file(host, conv, { goal: "Write the notes" });
      await host.settled();
      const before = await stored(host, done);
      expect(before?.status).toBe("completed");

      await expect(actions.steer(done, "One more thing")).rejects.toThrow(/task_finished/);
      await expect(actions.cancel(done)).rejects.toThrow(/task_finished/);
      expect(await stored(host, done)).toEqual(before);
    } finally {
      await host.dispose();
    }
  });

  it("control: aimed at a board the flow doesn't hold, every action goes red", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const task = await file(host, conv, { goal: "Write the notes", held: true });
      const wrong = boardOf(host, "alice", conv, "plan");
      const legs: Array<[string, () => Promise<unknown>]> = [
        ["release", () => wrong.release(task)],
        ["steer", () => wrong.steer(task, "words")],
        ["cancel", () => wrong.cancel(task)],
        ["retry", () => wrong.retry(task)],
        ["refile", () => wrong.refile({ goal: "Write the notes" })]
      ];
      for (const [name, leg] of legs) await expect(leg(), name).rejects.toThrow();
      expect((await stored(host, task))?.status).toBe("held");
      expect((await host.rows("alice")).filter((row) => row.goal === "Write the notes")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});
