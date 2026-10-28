/**
 * A browser reads its user's conversation boards through the collection
 * read route: every conversation's rows at once, each under its
 * conversation's partition, and none of another user's. An app's task list
 * and task screen read this way, since an action's answer never reaches a
 * page's resource reads.
 */
import { describe, expect, it } from "vitest";
import { sessionIdOfFiling } from "../src/browser";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** GET the `tasks` collection through `sessionId`, as `userId`'s browser does. */
async function readTasks(host: BoardHost, userId: string, sessionId: string) {
  const path = ["sessions", sessionId, "resources", "tasks"];
  const router = (await host.state.getRouter()) as any;
  const response: Response = await router.GET(
    new Request(`http://localhost/api/flows/${path.join("/")}`, { headers: { "x-user": userId } }),
    { params: { path } }
  );
  const body = (await response.json()) as { items?: Array<{ topic: string; clientData: Record<string, unknown> }> };
  return { status: response.status, items: body.items ?? [] };
}

async function file(host: BoardHost, userId: string, conv: string, goal: string): Promise<string> {
  const result = await host.act(userId, conv, "createTask_tasks", { goal, assignee: "eng.tasker" });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output.taskId as string;
}

describe("a browser reading its user's conversation boards", () => {
  it("reads every conversation's rows at once, each keyed under the conversation that filed it", async () => {
    const host = bootBoardHost();
    try {
      const first = await host.conversation("alice", "desk");
      const second = await host.conversation("alice", "desk");
      const a = await file(host, "alice", first, "Audit the licenses");
      const b = await file(host, "alice", second, "Write the notes");
      await host.settled();

      const read = await readTasks(host, "alice", first);
      expect(read.status).toBe(200);
      const holders = Object.fromEntries(
        read.items.map((item) => [item.clientData.id, sessionIdOfFiling(decodeURIComponent(item.topic.split("/")[0]!))])
      );
      expect(holders).toEqual({ [a]: first, [b]: second });
    } finally {
      await host.dispose();
    }
  });

  it("answers none of another user's rows", async () => {
    const host = bootBoardHost();
    try {
      const alices = await host.conversation("alice", "desk");
      await file(host, "alice", alices, "Audit the licenses");
      await host.settled();
      const bobs = await host.conversation("bob", "desk");

      const read = await readTasks(host, "bob", bobs);
      expect(read.status).toBe(200);
      expect(read.items).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("sends the row's board fields, never what its run keeps for itself", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, "alice", conv, "Audit the licenses");
      await host.settled();

      const [item] = (await readTasks(host, "alice", conv)).items;
      expect(item?.clientData).toMatchObject({ goal: "Audit the licenses", status: "completed", assignee: "eng.tasker" });
      expect(item?.clientData.run).toMatchObject({ sessionId: expect.any(String) });
      for (const kept of ["input", "output", "metadata", "writeLog", "createdBy"]) {
        expect(item?.clientData, kept).not.toHaveProperty(kept);
      }
    } finally {
      await host.dispose();
    }
  });
});
