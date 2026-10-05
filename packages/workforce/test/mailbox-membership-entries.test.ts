/**
 * The mailbox's internal subscribe and unsubscribe entries: the one way a
 * mailbox's members change after it opens.
 *
 * Each is a versioned write of the mailbox's session, re-run on the state a
 * conflict hands back, and the inventory rows follow the session. The cases
 * that matter: a second call changes nothing, two calls at once both land, an
 * emptied mailbox stays open, a removed worker's membership row goes, its open
 * tasks stay, and no client can reach any of the entries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { membershipKey } from "../src/index";
import {
  MAILBOX_SET_UP_ACTION,
  MAILBOX_SUBSCRIBE_ACTION,
  MAILBOX_UNSUBSCRIBE_ACTION
} from "../src/mailbox/mailbox-flow";
import type { MailboxManifest } from "../src/index";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

const FEATURE: MailboxManifest = {
  id: "eng.feature",
  declared: { members: ["eng.ivy"], boards: ["work"] },
  body: "Charter."
};

async function boot() {
  const h = await host([FEATURE], { inventory: true });
  hosts.push(h);
  // The file mailbox's first rows, as `openInventory` writes them at boot.
  await h.run({ action: "registerMailboxInInventory", input: {}, userId: USER_ID, orgId: ORG_ID, flowKind: "mailbox", sessionId: "eng.feature" });
  const internal = (action: string, input: unknown, sessionId = "eng.feature") =>
    h.run({ action, input, userId: USER_ID, orgId: ORG_ID, flowKind: "mailbox", sessionId, source: "internal" });
  return { ...h, internal };
}

describe("subscribe", () => {
  it("adds members, and the inventory row and a membership row follow", async () => {
    const h = await boot();
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.newhire"] });

    expect((await h.stateOf("eng.feature"))!.members).toEqual(["eng.ivy", "eng.newhire"]);
    expect((await h.row("inventory/mailboxes/eng.feature"))!.members).toEqual(["eng.ivy", "eng.newhire"]);
    expect(await h.row(`inventory/members/${membershipKey("eng.newhire", "eng.feature")}`)).toEqual({
      seatId: "eng.newhire",
      mailboxId: "eng.feature"
    });
  });

  it("changes nothing the second time, and is not an error", async () => {
    const h = await boot();
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.newhire"], worksTaskList: true });
    const once = await h.stateOf("eng.feature");
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.newhire"], worksTaskList: true });
    expect(await h.stateOf("eng.feature")).toEqual(once);
  });

  it("records the worker on the mailbox's lists only with worksTaskList", async () => {
    const h = await boot();
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.reviewer"] });
    expect((await h.stateOf("eng.feature"))!.workersByList ?? null).toBeNull();
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.coder"], worksTaskList: true });
    expect((await h.stateOf("eng.feature"))!.workersByList).toEqual({ work: { added: ["eng.coder"], removed: [] } });
  });

  it("lands both of two subscribes made at once, through a version conflict", async () => {
    const h = await boot();
    const set = vi.spyOn(h.stores.session, "set");
    await Promise.all([
      h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.a"] }),
      h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.b"] })
    ]);
    const conflicts = (await Promise.all(set.mock.results.map((r) => r.value))).filter(
      (result: { ok?: boolean }) => result?.ok === false
    );
    // The control: without a conflict this case proves nothing about the retry.
    expect(conflicts.length).toBeGreaterThan(0);
    expect([...(await h.stateOf("eng.feature"))!.members as string[]].sort()).toEqual(["eng.a", "eng.b", "eng.ivy"]);
  });
});

describe("contending with posts", () => {
  it("lands every subscribe made while posts land on the same session, within the retry bound", async () => {
    // The versioned write retries a bounded number of times (the runtime's CAS
    // budget). Posts write the same session record, so this is the contention
    // a busy mailbox puts a subscribe under: every change and every post lands.
    const h = await boot();
    const set = vi.spyOn(h.stores.session, "set");
    const posts = Array.from({ length: 4 }, (_, i) => h.act("eng.feature", "post", { body: `line ${i}` }));
    const subscribes = ["eng.a", "eng.b", "eng.c"].map((worker) =>
      h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: [worker] })
    );
    const posted = await Promise.all(posts);
    await Promise.all(subscribes);

    expect(posted.every((p) => p.error === undefined)).toBe(true);
    expect([...((await h.stateOf("eng.feature"))!.members as string[])].sort()).toEqual([
      "eng.a",
      "eng.b",
      "eng.c",
      "eng.ivy"
    ]);
    const results = await Promise.all(set.mock.results.map((r) => r.value));
    const conflicts = results.filter((result: { ok?: boolean }) => result?.ok === false).length;
    // Recorded rather than bounded tightly: the rate is what a reader of this
    // test needs to see move if the write path changes.
    expect(conflicts).toBeLessThan(results.length);
  });
});

describe("unsubscribe", () => {
  it("removes the member, deletes its membership row, and keeps its open tasks", async () => {
    const h = await boot();
    const filed = await h.act("eng.feature", "fileTask", { board: "work", goal: "g", assignee: "eng.ivy" });
    const { taskId } = filed.output as { taskId: string };

    await h.internal(MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["eng.ivy"] });

    expect((await h.stateOf("eng.feature"))!.members).toEqual([]);
    expect((await h.row("inventory/mailboxes/eng.feature"))!.members).toEqual([]);
    expect(await h.keys("inventory/members/")).toEqual([]);
    expect(await h.row(`eng.feature.work/${taskId}`)).toMatchObject({ status: "pending", assignee: "eng.ivy" });
  });

  it("records the removal on every list, and is a no-op the second time", async () => {
    const h = await boot();
    await h.internal(MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["eng.ivy"] });
    const once = await h.stateOf("eng.feature");
    expect(once!.workersByList).toEqual({ work: { added: [], removed: ["eng.ivy"] } });
    await h.internal(MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["eng.ivy"] });
    expect(await h.stateOf("eng.feature")).toEqual(once);
  });

  it("leaves an emptied mailbox open", async () => {
    const h = await boot();
    await h.internal(MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["eng.ivy"] });
    const read = await h.act("eng.feature", "read", {});
    expect(read.error).toBeUndefined();
    expect((read.output as { members: string[] }).members).toEqual([]);
    const posted = await h.act("eng.feature", "post", { body: "still here" });
    expect(posted.error).toBeUndefined();
  });
});

describe("who can reach the entries", () => {
  it("refuses every entry to a client call", async () => {
    const h = await boot();
    for (const action of [MAILBOX_SET_UP_ACTION, MAILBOX_SUBSCRIBE_ACTION, MAILBOX_UNSUBSCRIBE_ACTION]) {
      const called = await h.act("eng.feature", action, { workers: ["eng.mallory"] });
      expect(called.error, action).toBeDefined();
    }
    expect((await h.stateOf("eng.feature"))!.members).toEqual(["eng.ivy"]);
  });

  it("leaves members, lists and workers as they were after every action a client can call", async () => {
    // The session-state route is read-only, so a client reaches a mailbox
    // only through its public actions. None of them writes these fields.
    const h = await boot();
    await h.internal(MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.coder"], worksTaskList: true });
    const before = await h.stateOf("eng.feature");
    const fields = (state: Record<string, unknown> | undefined) => ({
      members: state?.members,
      taskLists: state?.taskLists,
      workersByList: state?.workersByList
    });
    for (const [action, input] of [
      ["post", { body: "hello", author: "eng.ivy" }],
      ["read", {}],
      ["fileTask", { board: "work", goal: "g" }],
      ["readBoard", { board: "work" }],
      ["registerMailboxInInventory", {}],
      ["join", { members: ["eng.mallory"] }]
    ] as const) {
      await h.act("eng.feature", action, input);
    }
    expect(fields(await h.stateOf("eng.feature"))).toEqual(fields(before));
  });
});
