/**
 * `openMailboxAtRunTime`: the host's opener for a mailbox set up while the app
 * runs, and the door to its membership entries.
 *
 * A run-time mailbox follows a file mailbox's id rules and refusals, lives in
 * the org's data (its session and its inventory row), and survives a restart:
 * opening the file mailboxes leaves it alone, and a file that later takes its
 * id is treated as an edit and reported, never a reason not to start.
 *
 * The restart cases run on SQLite: the second host is a second connection to
 * the same file, so what it reads is what the first one stored.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  inventoryWriterActions,
  mailboxSessionStateSchema,
  openMailboxAtRunTime,
  type MailboxKind,
  type MailboxManifest
} from "../src/index";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose();
});
/** A SQLite file, and a fresh adapter over it for each host: one per process. Disposing the host closes it. */
function sqliteFile() {
  const file = join(mkdtempSync(join(tmpdir(), "run-time-mailbox-")), "app.db");
  return () => sqliteStores({ filename: file });
}

const FEATURE: MailboxManifest = { id: "eng.feature", declared: { members: ["eng.ivy"], boards: ["work"] }, body: "C." };

/** A hand-rolled mailbox kind: its `MAILBOX.md` picks it, and it owns its own state. */
const BRIEFING = "briefing";
function briefingKind(): MailboxKind {
  const flow = defineFlow({
    kind: BRIEFING,
    cardinality: "singleton",
    session: { stateSchema: mailboxSessionStateSchema },
    actions: { ...inventoryWriterActions(BRIEFING) }
  } as never);
  return Object.assign(() => (flow as any)(), { kind: BRIEFING }) as unknown as MailboxKind;
}

async function boot(roster: MailboxManifest[] = [FEATURE], options: Parameters<typeof host>[1] = {}) {
  const h = await host(roster, { inventory: true, ...options });
  hosts.push(h);
  const open = openMailboxAtRunTime({ client: h.client, run: h.run, userId: USER_ID, teams: ["eng", "platform"] });
  return { ...h, open };
}

const LOGIN = {
  orgId: ORG_ID,
  team: "platform",
  name: "login",
  description: "The login page.",
  charter: "Build and ship the login page.",
  members: ["platform.ada"]
};

describe("setting a mailbox up", () => {
  it("opens it with its members, charter, one `tasks` list and an inventory row marked runtime", async () => {
    const h = await boot();
    expect(await h.open.setUp(LOGIN)).toEqual({ mailboxId: "platform.login", taskList: "tasks" });

    expect(await h.stateOf("platform.login")).toMatchObject({
      members: ["platform.ada"],
      instructions: "Build and ship the login page.",
      origin: "runtime",
      taskLists: ["tasks"]
    });
    // Nobody works the list unless the setup says so.
    expect((await h.stateOf("platform.login"))!.workersByList ?? null).toBeNull();
    expect(await h.row("inventory/mailboxes/platform.login")).toMatchObject({
      id: "platform.login",
      members: ["platform.ada"],
      origin: "runtime"
    });
    expect(await h.row("inventory/members/platform.ada/platform.login")).toBeDefined();
  });

  it("records the initial members as working the list with worksTaskList", async () => {
    const h = await boot();
    await h.open.setUp({ ...LOGIN, worksTaskList: true });
    expect((await h.stateOf("platform.login"))!.workersByList).toEqual({
      tasks: { added: ["platform.ada"], removed: [] }
    });
  });

  it("refuses a team that does not exist, and a name that breaks the file naming rule, opening nothing", async () => {
    const h = await boot();
    await expect(h.open.setUp({ ...LOGIN, team: "marketing" })).rejects.toThrow(/team "marketing"/);
    await expect(h.open.setUp({ ...LOGIN, name: "Login Page" })).rejects.toThrow(/Login Page/);
    expect(await h.stateOf("marketing.login")).toBeUndefined();
    expect(await h.keys("inventory/mailboxes/")).toEqual([]);
  });

  it("refuses an id a file mailbox holds, naming it, and changes nothing", async () => {
    const h = await boot();
    const before = await h.stateOf("eng.feature");
    await expect(h.open.setUp({ ...LOGIN, team: "eng", name: "feature" })).rejects.toThrow(/"eng\.feature" is already a mailbox/);
    expect(await h.stateOf("eng.feature")).toEqual(before);
  });

  it("refuses an id set up earlier, after writing its inventory row if it was missing", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    await h.stores.resourceState.delete("org", ORG_ID, "inventory/mailboxes/platform.login", "any");
    expect(await h.row("inventory/mailboxes/platform.login")).toBeUndefined();

    await expect(h.open.setUp({ ...LOGIN, members: ["platform.bob"] })).rejects.toThrow(/"platform\.login" is already a mailbox/);
    // The retry made it findable again, and changed nothing else.
    expect(await h.row("inventory/mailboxes/platform.login")).toMatchObject({ members: ["platform.ada"], origin: "runtime" });
    expect((await h.stateOf("platform.login"))!.members).toEqual(["platform.ada"]);
  });
});

describe("subscribing through the opener", () => {
  it("adds and removes workers on a file mailbox and a run-time one", async () => {
    const h = await boot();
    await h.open.setUp(LOGIN);
    expect(await h.open.subscribe({ orgId: ORG_ID, mailboxId: "eng.feature", workers: ["eng.newhire"] })).toEqual({
      members: ["eng.ivy", "eng.newhire"]
    });
    expect(await h.open.unsubscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.ada"] })).toEqual({
      members: []
    });
  });

  it("refuses a mailbox whose file picks a custom kind, naming the kind", async () => {
    const custom: MailboxManifest = { id: "eng.brief", declared: { members: ["eng.ivy"], flow: BRIEFING }, body: "C." };
    const h = await boot([FEATURE, custom], { kinds: { [BRIEFING]: briefingKind() } });
    await expect(h.open.subscribe({ orgId: ORG_ID, mailboxId: "eng.brief", workers: ["eng.x"] })).rejects.toThrow(
      /"eng\.brief" runs on mailbox kind "briefing"/
    );
  });

  it("refuses a mailbox nobody opened", async () => {
    const h = await boot();
    await expect(h.open.subscribe({ orgId: ORG_ID, mailboxId: "eng.nowhere", workers: ["eng.x"] })).rejects.toThrow(
      /eng\.nowhere/
    );
  });
});

describe("after a restart on a durable store", () => {
  it("keeps the mailbox, its members, its list, who works it and its tasks; opening the files leaves it alone", async () => {
    const connect = sqliteFile();
    const first = await boot([FEATURE], { stores: connect() });
    await first.open.setUp({ ...LOGIN, worksTaskList: true });
    await first.open.subscribe({ orgId: ORG_ID, mailboxId: "platform.login", workers: ["platform.hire"] });
    await first.open.subscribe({ orgId: ORG_ID, mailboxId: "eng.feature", workers: ["platform.hire"], worksTaskList: true });
    await first.open.unsubscribe({ orgId: ORG_ID, mailboxId: "eng.feature", workers: ["eng.ivy"] });
    const filed = await first.act("platform.login", "fileTask", { board: "tasks", goal: "Login page" });
    const before = { login: await first.stateOf("platform.login"), feature: await first.stateOf("eng.feature") };
    await first.dispose();
    hosts.splice(hosts.indexOf(first), 1);

    const second = await boot([FEATURE], { stores: connect() });
    expect(await second.stateOf("platform.login")).toEqual(before.login);
    expect(await second.stateOf("eng.feature")).toEqual(before.feature);
    const read = await second.act("platform.login", "readBoard", { board: "tasks" });
    expect((read.output as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id)).toEqual([
      (filed.output as { taskId: string }).taskId
    ]);
    expect(await second.row("inventory/mailboxes/platform.login")).toMatchObject({ origin: "runtime" });
  });

  it("starts when a later file takes a run-time mailbox's id: members and tasks kept, the file's lists added, the clash reported", async () => {
    const connect = sqliteFile();
    const first = await boot([FEATURE], { stores: connect() });
    await first.open.setUp({ ...LOGIN, team: "eng", name: "launch" });
    const filed = await first.act("eng.launch", "fileTask", { board: "tasks", goal: "Launch" });
    await first.dispose();
    hosts.splice(hosts.indexOf(first), 1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const launchFile: MailboxManifest = {
        id: "eng.launch",
        declared: { members: ["eng.someone-else"], boards: ["work"] },
        body: "The file's charter."
      };
      const second = await boot([FEATURE, launchFile], { stores: connect() });
      expect(warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("eng.launch"))).toHaveLength(1);

      expect(await second.stateOf("eng.launch")).toMatchObject({
        members: ["platform.ada"],
        instructions: "Build and ship the login page.",
        origin: "runtime"
      });
      const tasks = await second.act("eng.launch", "readBoard", { board: "tasks" });
      expect((tasks.output as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id)).toEqual([
        (filed.output as { taskId: string }).taskId
      ]);
      const work = await second.act("eng.launch", "fileTask", { board: "work", goal: "From the file's board" });
      expect(work.error).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
