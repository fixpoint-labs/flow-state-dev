/**
 * Task lists a mailbox holds in its own session, beside the ones its file
 * builds onto the kind.
 *
 * A run-time list lives in one org-scoped collection every mailbox kind
 * declares, under `<mailboxId>/<list>`. So the tests that matter are: the list
 * works with no board in any file, a name the mailbox does not hold is refused
 * naming what it does hold, two mailboxes' `tasks` never meet, the read is
 * bounded by the list's prefix in the store, and a session written before
 * these fields existed reads exactly as it did.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAILBOX_TASK_LISTS_ID } from "../src/mailbox/mailbox-board";
import type { MailboxManifest } from "../src/index";
import { host } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

/** A file mailbox with no board, so the built-in kind is registered and holds none. */
const QUIET: MailboxManifest = { id: "eng.quiet", declared: { members: [] }, body: "C." };

async function boot(roster: MailboxManifest[] = [QUIET]) {
  const h = await host(roster);
  hosts.push(h);
  return h;
}

/** A run-time mailbox's session state, as the run-time opener writes it. */
function runTimeState(members: string[]) {
  return { members, instructions: "Charter.", transcript: [], origin: "runtime", taskLists: ["tasks"] };
}

describe("a task list held in the mailbox's session", () => {
  it("files and reads a task when no file declares any board", async () => {
    const h = await boot();
    await h.seed("platform.login", runTimeState(["platform.ada"]));

    const filed = await h.act("platform.login", "fileTask", { board: "tasks", goal: "Build the login page" });
    expect(filed.error).toBeUndefined();
    const { taskId } = filed.output as { taskId: string };

    // Stored under the list's own prefix of the one declared collection.
    expect(await h.keys(`${MAILBOX_TASK_LISTS_ID}/`)).toEqual([
      `${MAILBOX_TASK_LISTS_ID}/platform.login/tasks/${taskId}`
    ]);

    const read = await h.act("platform.login", "readBoard", { board: "tasks" });
    expect(read.error).toBeUndefined();
    expect((read.output as { tasks: Array<{ goal: string }> }).tasks.map((t) => t.goal)).toEqual([
      "Build the login page"
    ]);
  });

  it("refuses a list the mailbox holds in neither its file nor its session, naming the ones it has", async () => {
    const h = await boot([{ id: "eng.feature", declared: { members: [], boards: ["work"] }, body: "C." }]);
    await h.seed("platform.login", runTimeState([]));

    const refused = await h.act("platform.login", "fileTask", { board: "nope", goal: "g" });
    expect(String(refused.error)).toMatch(/declares no board "nope"\. Boards: tasks\b/);
    // Another mailbox's file board is not this one's.
    const other = await h.act("platform.login", "fileTask", { board: "work", goal: "g" });
    expect(String(other.error)).toMatch(/declares no board "work"\. Boards: tasks\b/);
  });

  it("keeps two mailboxes' `tasks` lists apart", async () => {
    const h = await boot();
    await h.seed("platform.login", runTimeState([]));
    await h.seed("support.outage", runTimeState([]));

    await h.act("platform.login", "fileTask", { board: "tasks", goal: "login" });
    await h.act("support.outage", "fileTask", { board: "tasks", goal: "outage" });

    const login = await h.act("platform.login", "readBoard", { board: "tasks" });
    const outage = await h.act("support.outage", "readBoard", { board: "tasks" });
    expect((login.output as { tasks: Array<{ goal: string }> }).tasks.map((t) => t.goal)).toEqual(["login"]);
    expect((outage.output as { tasks: Array<{ goal: string }> }).tasks.map((t) => t.goal)).toEqual(["outage"]);
  });

  it("reads a list's rows by its prefix in the store, never the whole collection", async () => {
    const h = await boot();
    await h.seed("platform.login", runTimeState([]));
    await h.seed("support.outage", runTimeState([]));
    await h.act("support.outage", "fileTask", { board: "tasks", goal: "outage" });

    const getByPrefix = vi.spyOn(h.stores.resourceState, "getByPrefix");
    await h.act("platform.login", "fileTask", { board: "tasks", goal: "login" });
    await h.act("platform.login", "readBoard", { board: "tasks" });

    const prefixes = getByPrefix.mock.calls.map((call) => call[2]).filter((p) => String(p).startsWith(MAILBOX_TASK_LISTS_ID));
    expect(prefixes.length).toBeGreaterThan(0);
    expect(new Set(prefixes)).toEqual(new Set([`${MAILBOX_TASK_LISTS_ID}/platform.login/tasks/`]));
  });

  it("names its run-time lists in `read`, beside the file's boards", async () => {
    const h = await boot();
    await h.seed("platform.login", runTimeState(["platform.ada"]));
    const read = await h.act("platform.login", "read", {});
    expect((read.output as { boards?: string[] }).boards).toEqual(["tasks"]);
  });
});

describe("a session written before run-time lists existed", () => {
  it("reads exactly as it did: no `boards` key on a boardless mailbox", async () => {
    const h = await boot();
    await h.seed("eng.old", { members: ["eng.ivy"], instructions: "Old charter.", transcript: [] });
    const read = await h.act("eng.old", "read", {});
    expect(read.output).toEqual({ id: "eng.old", members: ["eng.ivy"], transcript: [] });
    // And it holds no list for a task to land on.
    const refused = await h.act("eng.old", "fileTask", { board: "tasks", goal: "g" });
    expect(String(refused.error)).toMatch(/declares no board "tasks"\. Boards: \(none\)/);
  });

  it("files onto a file board as before", async () => {
    const h = await boot([{ id: "eng.feature", declared: { members: ["eng.ivy"], boards: ["work"] }, body: "C." }]);
    const filed = await h.act("eng.feature", "fileTask", { board: "work", goal: "g" });
    expect(filed.output).toMatchObject({ board: "work", boardId: "eng.feature.work", status: "pending" });
    const { taskId } = filed.output as { taskId: string };
    expect(await h.row(`eng.feature.work/${taskId}`)).toMatchObject({ goal: "g" });
  });
});
