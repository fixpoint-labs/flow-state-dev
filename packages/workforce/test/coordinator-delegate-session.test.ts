/**
 * An app finds the session a coordinator's delivery opened for a delegate,
 * with `findWorkerSession({ worker, filingSessionId })`.
 *
 * A delivery opens the delegate's session as a dispatch run of the
 * coordinator conversation, created naming the delegate and carrying the
 * conversation's `filingSessionId` (its id and incarnation) as a readonly
 * field. The conversation's `listDelegates` returns that value.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md` BR-20a, and FIX-1788 BR-14a's key-set match):
 *   - `{ worker, filingSessionId }` returns exactly the session delivery opened;
 *   - a conversation deleted and created again under the same id has another
 *     `filingSessionId`, and its delivery opens another session, found by it;
 *   - `{ worker }` alone never returns a delegate session, including one an app
 *     created itself with a `filingSessionId`;
 *   - the field is declared readonly on every worker flow's session, so the
 *     engine's readonly guard keeps it, and the listing can filter by it.
 */
import { describe, expect, it } from "vitest";
import { bootHost, messageOf } from "./coordinator-harness";

async function post(host: ReturnType<typeof bootHost>, sessionId: string, message: string) {
  const result = await host.act("alice", sessionId, "run", { message });
  expect(result.error, messageOf(result.error)).toBeUndefined();
  await host.settled();
}

async function filingOf(host: ReturnType<typeof bootHost>, sessionId: string): Promise<string> {
  const listed = await host.act("alice", sessionId, "listDelegates", {});
  expect(listed.error, messageOf(listed.error)).toBeUndefined();
  return listed.output.filingSessionId;
}

describe("a delegate's session, found by its conversation (BR-20a)", () => {
  it("is what findWorkerSession({ worker, filingSessionId }) returns, and a recreated conversation gets another", async () => {
    const host = bootHost();
    const app = host.client("alice");
    const id = await host.conversation("alice", "desk", "talk-1");
    await post(host, id, "fix it [route:eng.coder]");
    const delivered = host.heard[0]!.sessionId;
    const filing = await filingOf(host, id);
    expect((await host.sessionState(delivered)).filingSessionId).toBe(filing);

    const found = await app.findWorkerSession({ worker: "eng.coder", filingSessionId: filing });
    expect(found?.id).toBe(delivered);
    expect((await app.ensureWorkerSession({ worker: "eng.coder", filingSessionId: filing })).id).toBe(delivered);

    const runtime = await host.state.getRuntime();
    await runtime.stores.session.delete(id);
    expect(await host.conversation("alice", "desk", "talk-1")).toBe(id);
    const refiled = await filingOf(host, id);
    expect(refiled).not.toBe(filing);
    await post(host, id, "again [route:eng.coder]");
    const redelivered = host.heard[1]!.sessionId;
    expect(redelivered).not.toBe(delivered);
    expect((await app.findWorkerSession({ worker: "eng.coder", filingSessionId: refiled }))?.id).toBe(redelivered);
    expect((await app.findWorkerSession({ worker: "eng.coder", filingSessionId: filing }))?.id).toBe(delivered);
  });

  it("is never what a lookup naming only the worker returns (BR-14a)", async () => {
    const host = bootHost();
    const app = host.client("alice");
    const id = await host.conversation("alice", "desk");
    await post(host, id, "fix it [route:eng.coder]");
    expect(await app.findWorkerSession({ worker: "eng.coder" })).toBeUndefined();

    // A session an app opened itself for a conversation carries the key too.
    const appOpened = await app.ensureWorkerSession({ worker: "eng.coder", filingSessionId: "another-conversation" });
    expect(await app.findWorkerSession({ worker: "eng.coder" })).toBeUndefined();

    const plain = await app.ensureWorkerSession({ worker: "eng.coder" });
    expect(plain.id).not.toBe(appOpened.id);
    expect(plain.id).not.toBe(host.heard[0]!.sessionId);
    expect((await app.findWorkerSession({ worker: "eng.coder" }))?.id).toBe(plain.id);
  });

  it("is a readonly field of every worker flow's session, set from the delivering conversation", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await post(host, id, "fix it [route:eng.coder]");
    const delivered = host.heard[0]!.sessionId;
    const runtime = await host.state.getRuntime();
    const record = (await runtime.stores.session.get(delivered))!;
    const { getReadonlyStateKeys } = await import("@flow-state-dev/core/helpers");
    const helper = host.installation.session().stateSchema;
    expect(getReadonlyStateKeys(helper)).toEqual(expect.arrayContaining(["workerId", "filingSessionId"]));
    expect(record.state).toMatchObject({ workerId: "eng.coder", filingSessionId: await filingOf(host, id) });
  });
});
