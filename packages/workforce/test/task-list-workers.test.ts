/**
 * `taskListWorkers`: who works one of a mailbox's task lists.
 *
 * One read for a file's list and a run-time one: workers subscribed with
 * `worksTaskList`, minus those unsubscribed since. Being a member never counts.
 * Every case reads the state the real entries wrote, through a registered
 * flow, so the read is checked against what the store holds.
 *
 * The file's own term (a `MAILBOX.md` naming a list's workers) does not exist
 * yet; when it does, the removal cases here are what keep an unsubscribed
 * worker off a list the file names it on.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskListWorkers, type MailboxManifest } from "../src/index";
import { MAILBOX_SUBSCRIBE_ACTION, MAILBOX_UNSUBSCRIBE_ACTION } from "../src/mailbox/mailbox-flow";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

const FEATURE: MailboxManifest = { id: "eng.feature", declared: { members: ["eng.ivy"], boards: ["work"] }, body: "C." };

async function boot() {
  const h = await host([FEATURE]);
  hosts.push(h);
  await h.seed("platform.login", {
    members: ["platform.ada"],
    instructions: "Build the login page.",
    transcript: [],
    origin: "runtime",
    taskLists: ["tasks"]
  });
  const internal = (sessionId: string, action: string, input: unknown) =>
    h.run({ action, input, userId: USER_ID, orgId: ORG_ID, flowKind: "mailbox", sessionId, source: "internal" });
  /** The read, in a context running in the mailbox's own session, over what the store holds. */
  const workers = async (mailboxId: string, list: string) => {
    const state = await h.stateOf(mailboxId);
    const ctx = { session: { identity: { id: mailboxId }, state } } as unknown as BlockContext;
    return [...taskListWorkers(ctx, mailboxId, list)].sort();
  };
  return { ...h, internal, workers };
}

describe("who works a run-time list", () => {
  it("is the workers subscribed with worksTaskList, and never a member who was not", async () => {
    const h = await boot();
    await h.internal("platform.login", MAILBOX_SUBSCRIBE_ACTION, { workers: ["platform.builder"], worksTaskList: true });
    await h.internal("platform.login", MAILBOX_SUBSCRIBE_ACTION, { workers: ["platform.reviewer"] });

    expect(await h.workers("platform.login", "tasks")).toEqual(["platform.builder"]);
  });

  it("drops a worker once it is unsubscribed", async () => {
    const h = await boot();
    await h.internal("platform.login", MAILBOX_SUBSCRIBE_ACTION, { workers: ["platform.builder"], worksTaskList: true });
    await h.internal("platform.login", MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["platform.builder"] });
    expect(await h.workers("platform.login", "tasks")).toEqual([]);
  });

  it("takes a worker back when it is subscribed again with worksTaskList", async () => {
    const h = await boot();
    await h.internal("platform.login", MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["platform.builder"] });
    await h.internal("platform.login", MAILBOX_SUBSCRIBE_ACTION, { workers: ["platform.builder"], worksTaskList: true });
    expect(await h.workers("platform.login", "tasks")).toEqual(["platform.builder"]);
  });
});

describe("who works a file's list", () => {
  it("is nobody the file named as a member, and the worker subscribed to it", async () => {
    const h = await boot();
    expect(await h.workers("eng.feature", "work")).toEqual([]);
    await h.internal("eng.feature", MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.coder"], worksTaskList: true });
    expect(await h.workers("eng.feature", "work")).toEqual(["eng.coder"]);
  });

  it("keeps an unsubscribed worker off it, and records the removal against the list", async () => {
    const h = await boot();
    await h.internal("eng.feature", MAILBOX_SUBSCRIBE_ACTION, { workers: ["eng.coder"], worksTaskList: true });
    await h.internal("eng.feature", MAILBOX_UNSUBSCRIBE_ACTION, { workers: ["eng.coder", "eng.ivy"] });
    expect(await h.workers("eng.feature", "work")).toEqual([]);
    expect((await h.stateOf("eng.feature"))!.workersByList).toEqual({
      work: { added: [], removed: ["eng.coder", "eng.ivy"] }
    });
  });
});

describe("where it runs", () => {
  it("reads a session written before the fields existed as nobody", async () => {
    const h = await boot();
    await h.seed("eng.old", { members: ["eng.ivy"], instructions: "Old.", transcript: [] });
    expect(await h.workers("eng.old", "work")).toEqual([]);
  });

  it("refuses a context running in another session, naming both", async () => {
    const ctx = { session: { identity: { id: "eng.other" }, state: {} } } as unknown as BlockContext;
    expect(() => taskListWorkers(ctx, "eng.feature", "work")).toThrow(/eng\.feature[\s\S]*eng\.other/);
  });
});
