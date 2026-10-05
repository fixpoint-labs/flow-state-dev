/**
 * Filing a task for a worker, through the run-time opener.
 *
 * The opener's `fileTask` puts a task on one of a mailbox's lists, a run-time
 * `tasks` list or a file's board, and records who filed it as
 * `filingWorker`. An assignee must be one of the list's workers
 * (`taskListWorkers`): a member who does not work the list, or a worker taken
 * off it, is refused by name and nothing is filed. The entry it runs is
 * internal, so a client can neither reach it nor set `filingWorker`.
 *
 * Graded on what the list holds, read back through the mailbox's own
 * `readBoard`, never on what the opener returned.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MAILBOX_FILE_TASK_FOR_WORKER_ACTION,
  openMailboxAtRunTime,
  type MailboxManifest
} from "../src/index";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

const FEATURE: MailboxManifest = { id: "eng.feature", declared: { members: ["eng.ivy"], boards: ["work"] }, body: "C." };

async function boot() {
  const h = await host([FEATURE], { inventory: true });
  hosts.push(h);
  const open = openMailboxAtRunTime({ client: h.client, run: h.run, userId: USER_ID, teams: ["eng", "platform"] });
  const tasksOn = async (mailboxId: string, list: string) => {
    const read = await h.act(mailboxId, "readBoard", { board: list });
    if (read.error !== undefined) throw read.error;
    return (read.output as { tasks: Array<Record<string, any>> }).tasks;
  };
  return { ...h, open, tasksOn };
}

const LOGIN = {
  orgId: ORG_ID,
  team: "platform",
  name: "login",
  description: "The login page.",
  charter: "Build and ship the login page.",
  members: ["platform.ada", "platform.rev"]
};

describe("filing a task for a worker", () => {
  it("puts the task on the run-time list with its assignee, and records the filing worker beside it", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await h.open.subscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.ada"], worksTaskList: true });

    await h.open.fileTask({
      orgId: ORG_ID,
      mailboxId: "platform.login",
      list: "tasks",
      goal: "Build the login page.",
      title: "Login page",
      assignee: "platform.ada",
      filingWorker: "eng.lead"
    });

    const tasks = await h.tasksOn("platform.login", "tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      goal: "Build the login page.",
      title: "Login page",
      assignee: "platform.ada",
      metadata: { filingWorker: "eng.lead" }
    });
  });

  it("files with no assignee", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await h.open.fileTask({ orgId: ORG_ID, mailboxId: "platform.login", list: "tasks", goal: "g", filingWorker: "eng.lead" });
    expect(await h.tasksOn("platform.login", "tasks")).toHaveLength(1);
  });

  it("refuses an assignee who is a member but does not work the list, naming who does, and files nothing", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await h.open.subscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.ada"], worksTaskList: true });
    await expect(
      h.open.fileTask({ orgId: ORG_ID, mailboxId: "platform.login", list: "tasks", goal: "g", assignee: "platform.rev", filingWorker: "eng.lead" })
    ).rejects.toThrow(/"platform\.rev" does not work.*"tasks".*platform\.ada/);
    expect(await h.tasksOn("platform.login", "tasks")).toEqual([]);
  });

  it("refuses a list the mailbox does not hold, naming the lists it has", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await expect(
      h.open.fileTask({ orgId: ORG_ID, mailboxId: "platform.login", list: "backlog", goal: "g", filingWorker: "eng.lead" })
    ).rejects.toThrow(/backlog.*tasks/);
  });

  it("files on a file mailbox's board for a hire subscribed to work it, and refuses a file member taken off it", async () => {
    const h = await boot();
    await h.open.subscribe({ orgId: ORG_ID, mailboxId: "eng.feature", workers: ["eng.hire"], worksTaskList: true });
    await h.open.unsubscribe({ orgId: ORG_ID, mailboxId: "eng.feature", workers: ["eng.ivy"] });

    await h.open.fileTask({ orgId: ORG_ID, mailboxId: "eng.feature", list: "work", goal: "g", assignee: "eng.hire", filingWorker: "eng.lead" });
    await expect(
      h.open.fileTask({ orgId: ORG_ID, mailboxId: "eng.feature", list: "work", goal: "g", assignee: "eng.ivy", filingWorker: "eng.lead" })
    ).rejects.toThrow(/"eng\.ivy" does not work/);
    expect((await h.tasksOn("eng.feature", "work")).map((task) => task.assignee)).toEqual(["eng.hire"]);
  });

  it("is an entry no client can reach, so a client never sets filingWorker", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    const called = await h.act("platform.login", MAILBOX_FILE_TASK_FOR_WORKER_ACTION, {
      list: "tasks",
      goal: "g",
      filingWorker: "eng.mallory"
    });
    expect(called.error).toBeDefined();
    // The public door files, but takes no filing worker.
    const publicFile = await h.act("platform.login", "fileTask", { board: "tasks", goal: "g", filingWorker: "eng.mallory" });
    expect(publicFile.error).toBeDefined();
    expect(await h.tasksOn("platform.login", "tasks")).toEqual([]);
  });
});
