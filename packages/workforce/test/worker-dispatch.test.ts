/**
 * A task opens its worker's session naming the worker (FIX-1788 BR-18): the
 * dispatching code names it when the child session is created, the worker
 * flow's create check confirms it for the dispatching session's user, and the
 * child's turns run as it.
 *
 * Real engine and router. The worker comes from the task the board hands
 * over (`createWorkerLookup(...).state`), never from the task's input.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { bootHost, FIXTURE } from "./worker-model-harness";

const envelope = (seat: string, taskId: string) => ({
  boardId: "board",
  seat,
  taskId,
  attempt: 1,
  createdAt: 1,
  payload: { worker: "someone-else" }
});

async function send(userId: string, seat: string, taskId: string) {
  const stores = createInMemoryStores();
  const h = bootHost(stores);
  await h.rosterAction("alice", "hire", { id: "scribe", flow: FIXTURE });
  await h.rosterAction("bob", "hire", { id: "bobs-scribe", flow: FIXTURE });
  const parent = await h.create(userId, "filer", { sessionId: `filer-${userId}` });
  expect(parent.status).toBe(201);
  const res = await h.fetcherFor(userId)(`/api/flows/filer/filer-${userId}/actions/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, sessionId: `filer-${userId}`, input: envelope(seat, taskId) })
  });
  expect(res.status).toBe(202);
  const [sent] = await h.settled(`filer-${userId}`);
  const children = await stores.session.list({ parentage: { parentOf: `filer-${userId}` } });
  return { h, stores, sent, children };
}

describe("a task handed to a worker flow", () => {
  it("creates the task's session with the worker the task names, and its turn runs as it", async () => {
    const { h, sent, children } = await send("alice", "scribe", "t1");
    expect(sent?.status).toBe("completed");
    expect(children.map((child) => child.state.workerId)).toEqual(["scribe"]);
    const [child] = await h.settled(children[0]!.id);
    expect(child?.status).toBe("completed");
  });

  it("is refused for a worker that isn't the filing user's, and writes no session", async () => {
    const { sent, children } = await send("alice", "bobs-scribe", "t2");
    expect(sent?.status).toBe("failed");
    expect(JSON.stringify(sent?.items ?? [])).toContain("No worker");
    expect(children).toEqual([]);
  });
});
