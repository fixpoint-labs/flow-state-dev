/**
 * An app's own sessions with a worker, through `createWorkforceClient`: a new
 * session beside the others (`startSession`), a line sent to its door
 * (`send`), a stop of the turns running now (`stopTurns`) and a turn run
 * again (`retryTurn`). An app calls these instead of addressing the worker's
 * flow itself, so it never needs to know which flow a session runs on.
 *
 * Real engine, real HTTP router, the caller a verified user.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { bootHost, FIXTURE } from "./worker-model-harness";

function host() {
  const stores = createInMemoryStores();
  return { stores, ...bootHost(stores) };
}

/** Read `read` until `done` holds for its answer, or throw after 5 s. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`never held; last: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("a worker session an app opens and talks to", () => {
  it("starts a new session at a fresh id each time, on the worker's flow, running the worker", async () => {
    const h = host();
    const alice = h.client("alice");
    const first = await alice.startSession("researcher");
    const second = await alice.startSession("researcher");
    // Two conversations, neither the derived one ensureWorkerSession hands out.
    expect(first.id).not.toBe(second.id);
    expect((await alice.ensureWorkerSession({ worker: "researcher" })).id).not.toBe(first.id);
    expect(first.flowKind).toBe(FIXTURE);
    const ran = await h.turn("alice", first.id);
    expect(ran.output).toMatchObject({ worker: "researcher", standard: true });
  });

  it("refuses a worker that isn't on the roster, and opens nothing", async () => {
    const h = host();
    await expect(h.client("alice").startSession("nobody")).rejects.toThrow('No worker "nobody" on your roster.');
    expect(await h.stores.session.list({ userId: "alice" })).toEqual([]);
  });

  it("sends a line to the session's door, on the flow the session runs on", async () => {
    const h = host();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    await alice.send(id, "hello there");
    const [turn] = await h.settled(id);
    expect(turn).toMatchObject({ actionName: "respond", status: "completed" });
  });

  it("streams a send when asked, handing back the send's own response", async () => {
    const h = host();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    const response = await alice.send(id, "hello", { stream: true });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.text();
    expect((await h.settled(id)).map((request) => request.status)).toEqual(["completed"]);
  });

  it("stops the turn running now and names it; with none running it stops nothing", async () => {
    const h = host();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    expect(await alice.stopTurns(id)).toEqual([]);
    void alice.send(id, "wait").catch(() => undefined);
    const [running] = await until(
      () => h.stores.request.list({ sessionId: id }),
      (requests) => requests.some((request) => request.status === "in_progress"),
    );
    expect(await alice.stopTurns(id)).toEqual([running!.id]);
    const [ended] = await h.settled(id);
    expect(ended!.status).not.toBe("in_progress");
  });

  it("runs a failed turn again by its id", async () => {
    const h = host();
    const alice = h.client("alice");
    const { id } = await alice.startSession("researcher");
    await alice.send(id, "fail");
    const [first] = await h.settled(id);
    expect(first!.status).toBe("failed");
    await alice.retryTurn(id, first!.id);
    // The retry is a new request of the same turn, with the same line: it fails again.
    const requests = await h.settled(id);
    expect(requests).toHaveLength(2);
    const again = requests.find((request) => request.id !== first!.id)!;
    expect(again).toMatchObject({ actionName: "respond", status: "failed", input: { message: "fail" } });
  });
});
