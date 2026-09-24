/**
 * Session journal / metadata writes vs. concurrent session-state commits.
 *
 * `ctx.session.appendJournal` and `ctx.session.setMetadata` write the session
 * record, which also carries `state`. Two execution contexts on one session
 * stand in for two concurrent requests: the FIRST is held (constructed, then
 * idle) while the SECOND commits a state change and finishes; only then does
 * the first write its journal entry or metadata. Letting both run together
 * would let the later writer's fresher snapshot hide a lost update.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createInMemoryStores } from "../src";

function createFlow() {
  const block = handler<{ value: string }, { ok: boolean }>({
    name: "journal-handler",
    execute: () => ({ ok: true })
  });
  return defineFlow({
    kind: "journal-concurrency-flow",
    actions: {
      run: { inputSchema: z.object({ value: z.string() }), block }
    }
  })();
}

async function openContexts() {
  const flow = createFlow();
  const stores = createInMemoryStores();
  const base = {
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    sessionId: "sess_shared",
    userId: "user_1",
    stores
  };
  // The first request's context is built (its session snapshot taken) before
  // the second one exists.
  const first = await createExecutionContext({
    ...base,
    requestId: "req_first",
    sessionState: { count: 0 }
  });
  const second = await createExecutionContext({ ...base, requestId: "req_second" });
  return { stores, first, second };
}

describe("session journal/metadata writes under a concurrent state commit", () => {
  it("appendJournal keeps session state another request committed after this one's snapshot", async () => {
    const { stores, first, second } = await openContexts();

    await second.session.patchState({ count: 1 });
    await first.session.appendJournal({ text: "late entry", source: "test" });

    const saved = await stores.session.get("sess_shared");
    expect(saved?.state).toEqual({ count: 1 });
    expect(saved?.journal.map((e) => e.text)).toEqual(["late entry"]);
  });

  it("setMetadata keeps session state another request committed after this one's snapshot", async () => {
    const { stores, first, second } = await openContexts();

    await second.session.patchState({ count: 1 });
    await first.session.setMetadata({ title: "renamed" });

    const saved = await stores.session.get("sess_shared");
    expect(saved?.state).toEqual({ count: 1 });
    expect(saved?.title).toBe("renamed");
  });

  it("keeps every journal entry when two requests append concurrently", async () => {
    const { stores, first, second } = await openContexts();

    await second.session.appendJournal({ text: "from second", source: "test" });
    await first.session.appendJournal({ text: "from first", source: "test" });

    const saved = await stores.session.get("sess_shared");
    expect(saved?.journal.map((e) => e.text)).toEqual(["from second", "from first"]);
  });

  it("a state commit after a journal append neither conflicts nor drops the entry", async () => {
    const { stores, first } = await openContexts();
    // Record every refused write on the session store: this request is the
    // only writer, so its own state persist must not trip a CAS conflict
    // against the version its journal append just advanced.
    const conflicts: string[] = [];
    const session = stores.session as unknown as Record<string, (...args: unknown[]) => Promise<{ ok: boolean }>>;
    for (const verb of ["set", "patchField", "incField", "pushToArray", "deleteField"]) {
      const original = session[verb]!.bind(stores.session);
      session[verb] = async (...args: unknown[]) => {
        const result = await original(...args);
        if (!result.ok) conflicts.push(verb);
        return result;
      };
    }

    await first.session.appendJournal({ text: "entry", source: "test" });
    // Two fields, so the patch is a version-checked write rather than a
    // commutative single-field one that would skip the version check.
    await first.session.patchState({ count: 5, note: "after" });

    const saved = await stores.session.get("sess_shared");
    expect(saved?.state).toEqual({ count: 5, note: "after" });
    expect(saved?.journal.map((e) => e.text)).toEqual(["entry"]);
    expect(conflicts).toEqual([]);
  });
  it("a later state commit still sees the concurrent change the journal append stepped over", async () => {
    const { stores, first, second } = await openContexts();

    await second.session.patchState({ count: 1 });
    await first.session.appendJournal({ text: "entry", source: "test" });
    // Version-checked two-field patch from the request whose state view is
    // stale: it must re-read and merge onto `count: 1`, not write `count: 0`.
    await first.session.patchState({ note: "after", flag: true });

    const saved = await stores.session.get("sess_shared");
    expect(saved?.state).toEqual({ count: 1, note: "after", flag: true });
    expect(saved?.journal.map((e) => e.text)).toEqual(["entry"]);
  });
});
