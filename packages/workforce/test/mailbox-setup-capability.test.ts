/**
 * `createMailboxSetupCapability`: a coordinator sets up mailboxes, puts
 * workers on and takes them off, and files tasks, as catalog tools.
 *
 * Every case runs the coordinator's real `run` turn on a real host, with a
 * scripted model that calls one tool, and grades what the host then holds:
 * the mailbox's session, its list, and who a post woke. Never a tool's return.
 *
 * - The tools are a grant a worker names (BR-21): an empty `tools:` reaches none.
 * - The org is the caller's (BR-22): an `orgId` in the input changes nothing.
 * - Every worker name is looked up over the host's live list (BR-4): a name no
 *   worker holds, or two workers hold, is refused by name and opens nothing.
 * - `fileTask` refuses an assignee no worker holds, two hold, or the list does
 *   not count among its workers (BR-16), and records the calling worker's own
 *   name as `filingWorker` (BR-15).
 * - A worker hired after boot and subscribed is woken by the next post (BR-8);
 *   one unsubscribed is not, even after it was fired (BR-11, BR-14).
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, type MockGeneratorInstance, type MockGeneratorScriptStep } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createMailboxSetupCapability,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxNotifyInputSchema,
  openMailboxAtRunTime,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxManifest,
  type MailboxNotifyInput,
  type RunTimeMailboxOpener
} from "../src/index";
import { host, ORG_ID, USER_ID } from "./run-time-mailbox-host";

const hosts: Array<{ dispose: () => Promise<void> }> = [];
const heard: string[] = [];
afterEach(async () => {
  heard.length = 0;
  while (hosts.length > 0) await hosts.pop()!.dispose();
});

/** A worker kind that hears posts and records who heard what. */
const listener = defineFlow({
  kind: "listener",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { ask: { block: handler({ name: "setup-ask", execute: () => ({}) }) } },
  internal: {
    actions: {
      onMailboxPost: {
        inputSchema: mailboxNotifyInputSchema,
        block: handler({
          name: "setup-listen",
          inputSchema: mailboxNotifyInputSchema,
          outputSchema: z.object({}),
          execute: (post: MailboxNotifyInput, ctx) => {
            heard.push(`${String((ctx.flow.config as { seatId?: string }).seatId)}|${post.body}`);
            return {};
          }
        })
      }
    }
  }
} as never);

/**
 * The coordinator's model: each turn's message is `call <tool> <json>`; it
 * calls that tool once, then says it is done.
 */
function scriptedCoordinator(): MockGeneratorInstance {
  let cursor = new WeakMap<object, number>();
  return {
    name: "agent-answer",
    calls: [],
    reset: () => {
      cursor = new WeakMap();
    },
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const turn = JSON.stringify([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const directive = /call (\w+) (\{.*\})/.exec(JSON.parse(turn) as string);
      if (directive === null) return { text: "no directive" };
      const step = cursor.get(messages) ?? 0;
      cursor.set(messages, step + 1);
      if (step > 0) return { text: "done" };
      return { toolCalls: [{ toolCallId: `tc_${Math.random()}`, toolName: directive[1]!, args: JSON.parse(directive[2]!) }] };
    }
  };
}

const FEATURE: MailboxManifest = { id: "eng.feature", declared: { members: ["eng.ivy"], boards: ["work"] }, body: "C." };
const TOOLS = ["setUpMailbox", "subscribeWorkers", "unsubscribeWorkers", "fileTask"];

async function boot(options: { leadTools?: string[] } = {}) {
  let registry: { list(): FlowInstance[] } | undefined;
  const live = () => registry?.list() ?? [];
  let opener: RunTimeMailboxOpener | undefined;
  const setup = createMailboxSetupCapability({ open: () => opener!, workers: live });
  const kinds = { agent: defineAgentWorkerFlow({ uses: [setup] }), listener } as never;
  const declared = hireWorkforce(
    [
      { id: "eng.lead", declared: { tools: options.leadTools ?? TOOLS }, body: "You coordinate." },
      { id: "eng.ivy", declared: { flow: "listener" }, body: "" }
    ],
    { kinds }
  );
  const h = await host([FEATURE], {
    inventory: true,
    kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(live), inventory: true }) } as never,
    flows: Object.fromEntries(declared.map((worker) => [worker.id, worker])),
    modelResolver: createMockModelResolver({ generators: { "agent-answer": scriptedCoordinator() }, policy: "allow" })
  });
  hosts.push(h);
  registry = h.runtime.registry;
  opener = openMailboxAtRunTime({ client: h.client, run: h.run, userId: USER_ID, teams: ["eng", "platform"] });

  const lead = declared.find((worker) => worker.id === "eng.lead")!;

  /** One turn of the coordinator: it calls `tool` with `args`. */
  const call = async (tool: string, args: Record<string, unknown>) =>
    (await runAction({
      orgId: ORG_ID,
      flow: lead,
      actionName: "run",
      input: { message: `call ${tool} ${JSON.stringify(args)}` },
      userId: USER_ID,
      sessionId: `lead_${Math.random().toString(36).slice(2)}`,
      stores: h.runtime.stores,
      runtimeConfig: { ...h.runtime.runtimeConfig }
    } as never)) as { error?: { message?: string } };

  /** Register a worker after boot, as a hire does. */
  const hire = (name: string, address = name, pin: { orgId: string; userId?: string } = { orgId: ORG_ID }) => {
    const [worker] = hireWorkforce([{ id: address, seatId: name, declared: { flow: "listener" }, body: "" } as never], { kinds });
    h.runtime.registry.register(worker!, { pin });
    return worker!;
  };

  /** Post, and wait until every run it woke has settled; who heard it. */
  const post = async (mailboxId: string, body: string) => {
    const posted = await h.act(mailboxId, "post", { body });
    expect(posted.error).toBeUndefined();
    for (let i = 0; i < 400; i += 1) {
      const requests = await h.runtime.stores.request.list({});
      if (requests.every((r: { status: string }) => r.status !== "in_progress")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    return heard.filter((line) => line.endsWith(`|${body}`)).map((line) => line.split("|")[0]).sort();
  };

  const tasksOn = async (mailboxId: string, list: string) => {
    const read = await h.act(mailboxId, "readBoard", { board: list });
    if (read.error !== undefined) throw read.error;
    return (read.output as { tasks: Array<Record<string, any>> }).tasks;
  };

  return { ...h, call, hire, post, tasksOn };
}

const LOGIN = {
  team: "platform",
  name: "login",
  description: "The login page.",
  charter: "Build and ship the login page."
};

describe("who may call the tools", () => {
  it("BR-21 · a worker whose tools: names none of them reaches none, and nothing is opened", async () => {
    const h = await boot({ leadTools: [] });
    h.hire("platform.ada");
    await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ada"] });
    await h.call("subscribeWorkers", { mailboxId: "eng.feature", workers: ["platform.ada"] });
    expect(await h.stateOf("platform.login")).toBeUndefined();
    expect((await h.stateOf("eng.feature"))!.members).toEqual(["eng.ivy"]);
  });

  it("BR-22 · an orgId in the input is ignored: the rows are written in the caller's organization", async () => {
    const h = await boot();
    h.hire("platform.ada");
    const ran = await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ada"], orgId: "globex" });
    expect(ran.error).toBeUndefined();
    expect(await h.row("inventory/mailboxes/platform.login")).toMatchObject({ origin: "runtime", members: ["platform.ada"] });
    expect(await h.stores.resourceState.get("org", "globex", "inventory/mailboxes/platform.login")).toBeUndefined();
  });
});

describe("setUpMailbox", () => {
  it("opens the mailbox with members looked up by name, who work its list with worksTaskList", async () => {
    const h = await boot();
    h.hire("platform.ada", `${ORG_ID}.platform.ada`);
    const ran = await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ada"], worksTaskList: true });
    expect(ran.error).toBeUndefined();
    expect(await h.stateOf("platform.login")).toMatchObject({
      members: ["platform.ada"],
      instructions: "Build and ship the login page.",
      origin: "runtime",
      taskLists: ["tasks"],
      workersByList: { tasks: { added: ["platform.ada"], removed: [] } }
    });
    expect(await h.post("platform.login", "hello login")).toEqual(["platform.ada"]);
  });

  it("refuses a member no worker holds, naming it, and opens nothing", async () => {
    const h = await boot();
    const ran = await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ghost"] });
    expect(ran.error?.message).toMatch(/"platform\.ghost"/);
    expect(await h.stateOf("platform.login")).toBeUndefined();
  });

  it("refuses a member two workers hold, naming both, and opens nothing", async () => {
    const h = await boot();
    h.hire("platform.dup", `${ORG_ID}.platform.dup`);
    h.hire("platform.dup", `${ORG_ID}.~${USER_ID}.platform.dup`, { orgId: ORG_ID, userId: USER_ID });
    const ran = await h.call("setUpMailbox", { ...LOGIN, members: ["platform.dup"] });
    expect(ran.error?.message).toMatch(/"platform\.dup".*two workers/);
    expect(await h.stateOf("platform.login")).toBeUndefined();
  });

  it("refuses an id that is already a mailbox, naming it", async () => {
    const h = await boot();
    const ran = await h.call("setUpMailbox", { ...LOGIN, team: "eng", name: "feature", members: [] });
    expect(ran.error?.message).toMatch(/"eng\.feature" is already a mailbox/);
  });
});

describe("subscribeWorkers and unsubscribeWorkers", () => {
  it("BR-8 · a worker hired after boot and put on a file mailbox is woken by its next post, and works its board", async () => {
    const h = await boot();
    expect(await h.post("eng.feature", "before")).toEqual(["eng.ivy"]);
    h.hire("eng.hire", `${ORG_ID}.eng.hire`);
    const ran = await h.call("subscribeWorkers", { mailboxId: "eng.feature", workers: ["eng.hire"], worksTaskList: true });
    expect(ran.error).toBeUndefined();
    expect(await h.post("eng.feature", "after")).toEqual(["eng.hire", "eng.ivy"]);
    expect((await h.stateOf("eng.feature"))!.workersByList).toEqual({ work: { added: ["eng.hire"], removed: [] } });
  });

  it("refuses to subscribe a name no worker holds, and changes nothing", async () => {
    const h = await boot();
    const ran = await h.call("subscribeWorkers", { mailboxId: "eng.feature", workers: ["eng.ghost"] });
    expect(ran.error?.message).toMatch(/"eng\.ghost"/);
    expect((await h.stateOf("eng.feature"))!.members).toEqual(["eng.ivy"]);
  });

  it("BR-11 · BR-14 · a file member taken off is not woken, even one already fired", async () => {
    const h = await boot();
    const hire = h.hire("eng.temp", `${ORG_ID}.eng.temp`);
    await h.call("subscribeWorkers", { mailboxId: "eng.feature", workers: ["eng.temp"] });
    h.runtime.registry.unregister(hire.id);
    const ran = await h.call("unsubscribeWorkers", { mailboxId: "eng.feature", workers: ["eng.ivy", "eng.temp"] });
    expect(ran.error).toBeUndefined();
    expect((await h.stateOf("eng.feature"))!.members).toEqual([]);
    expect(await h.post("eng.feature", "nobody")).toEqual([]);
  });
});

describe("fileTask", () => {
  it("BR-15 · files on the list for one of its workers, with the calling worker's own name as filingWorker", async () => {
    const h = await boot();
    h.hire("platform.ada", `${ORG_ID}.platform.ada`);
    await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ada"], worksTaskList: true });
    const ran = await h.call("fileTask", {
      mailboxId: "platform.login",
      title: "Login page",
      goal: "Build the login page.",
      assignee: "platform.ada"
    });
    expect(ran.error).toBeUndefined();
    const tasks = await h.tasksOn("platform.login", "tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assignee: "platform.ada", metadata: { filingWorker: "eng.lead" } });
  });

  it("refuses a filingWorker in the input: the tool's input is closed to it", async () => {
    const h = await boot();
    await h.call("setUpMailbox", { ...LOGIN, members: [] });
    const ran = await h.call("fileTask", { mailboxId: "platform.login", goal: "g", filingWorker: "eng.mallory" });
    expect(ran.error).toBeDefined();
    expect(await h.tasksOn("platform.login", "tasks")).toEqual([]);
  });

  it("BR-16 · refuses an assignee no worker holds, two workers hold, or the list does not count, and files nothing", async () => {
    const h = await boot();
    h.hire("platform.ada", `${ORG_ID}.platform.ada`);
    h.hire("platform.rev", `${ORG_ID}.platform.rev`);
    h.hire("platform.dup", `${ORG_ID}.platform.dup`);
    h.hire("platform.dup", `${ORG_ID}.~${USER_ID}.platform.dup`, { orgId: ORG_ID, userId: USER_ID });
    await h.call("setUpMailbox", { ...LOGIN, members: ["platform.ada"], worksTaskList: true });
    await h.call("subscribeWorkers", { mailboxId: "platform.login", workers: ["platform.rev"] });

    const missing = await h.call("fileTask", { mailboxId: "platform.login", goal: "g", assignee: "platform.ghost" });
    expect(missing.error?.message).toMatch(/"platform\.ghost"/);
    const ambiguous = await h.call("fileTask", { mailboxId: "platform.login", goal: "g", assignee: "platform.dup" });
    expect(ambiguous.error?.message).toMatch(/"platform\.dup".*two workers/);
    const notAWorker = await h.call("fileTask", { mailboxId: "platform.login", goal: "g", assignee: "platform.rev" });
    expect(notAWorker.error?.message).toMatch(/"platform\.rev" does not work list "tasks"/);
    expect(await h.tasksOn("platform.login", "tasks")).toEqual([]);
  });
});
