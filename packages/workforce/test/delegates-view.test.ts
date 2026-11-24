/**
 * A conversation's delegates as a session view (`delegatesViewRef`), the way a
 * screen reads them live: the same records and the same per-delegate check
 * as the `listDelegates` action, read without the action's first-read write.
 *
 * - it answers what the action answers, each delegate with what it does and takes;
 * - a read writes nothing: the session's list stays unwritten, and a `delegates: all`
 *   list is never pinned by a read;
 * - its answer names the conversation's session topic, so an add the coordinator's
 *   own tool makes reaches a screen watching it;
 * - another user can't read it.
 *
 * Real engine, real HTTP router, the caller a verified user.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { delegatesViewRef } from "../src/browser";
import { bootHost, standardWorkers } from "./coordinator-harness";

/** The app's one client for `userId`, over the host's router. */
function fsdOf(host: ReturnType<typeof bootHost>, userId: string) {
  const inProcess = createInProcessFetch(host.state);
  return createClient({
    userId,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      return inProcess(input, { ...init, headers });
    }
  });
}

describe("the delegates view", () => {
  it("answers what listDelegates answers: each delegate with what it does and takes, the fallback and the most", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    const { value } = await fsdOf(host, "alice").view(delegatesViewRef("coordinator"), {}, { sessionId: id });
    const listed = (await host.act("alice", id, "listDelegates", {})).output;
    expect(value).toEqual(listed);
    expect(value.delegates.map((delegate) => [delegate.worker, delegate.takes])).toEqual([
      ["eng.em", "tasks"],
      ["eng.coder", "tasks"],
      ["support.general", "tasks"]
    ]);
  });

  it("writes nothing: a read leaves the conversation's list unwritten, where the action's first read copies it in", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await fsdOf(host, "alice").view(delegatesViewRef("coordinator"), {}, { sessionId: id });
    expect((await host.sessionState(id)).delegates).toBeNull();
    // The control: the action pins it on the same first read.
    await host.act("alice", id, "listDelegates", {});
    expect((await host.sessionState(id)).delegates).not.toBeNull();
  });

  it("never pins a delegates: all list, and shows a hire on the next read", async () => {
    const host = bootHost({ standard: standardWorkers({ chief: { delegates: "all" } }) });
    const id = await host.conversation("alice", "chief");
    const fsd = fsdOf(host, "alice");
    const before = (await fsd.view(delegatesViewRef("coordinator"), {}, { sessionId: id })).value.delegates.map((d) => d.worker);
    expect(before).toContain("eng.em");
    expect((await host.sessionState(id)).delegates).toBeNull();
    expect((await host.hire("alice", { id: "licenses", flow: "helper" })).error).toBeUndefined();
    const after = (await fsd.view(delegatesViewRef("coordinator"), {}, { sessionId: id })).value.delegates.map((d) => d.worker);
    expect(after).toContain("licenses");
    expect((await host.sessionState(id)).delegates).toBeNull();
  });

  it("names the conversation's session topic, so a change the coordinator makes there is heard", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    const fsd = fsdOf(host, "alice");
    const read = await fsd.view(delegatesViewRef("coordinator"), {}, { sessionId: id });
    expect(read.topics).toContainEqual({ scope: "session", id });
    await host.act("alice", id, "addDelegate", { worker: "eng.lead" });
    const again = await fsd.view(delegatesViewRef("coordinator"), {}, { sessionId: id });
    expect(again.value.delegates.map((d) => d.worker)).toContain("eng.lead");
  });

  it("refuses another user's conversation, as the delegate actions do", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await expect(fsdOf(host, "bob").view(delegatesViewRef("coordinator"), {}, { sessionId: id })).rejects.toThrow(/403|another user|not found|404/i);
    // The action refuses Bob's read the same way, at the session's binding.
    await expect(host.act("bob", id, "listDelegates", {})).rejects.toThrow(/belongs to another user/);
    // And Alice's own read still answers: the refusal is Bob's, not the view's.
    await expect(fsdOf(host, "alice").view(delegatesViewRef("coordinator"), {}, { sessionId: id })).resolves.toBeDefined();
  });
});
