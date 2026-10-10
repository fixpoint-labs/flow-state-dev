/**
 * A user's project coordinator (FIX-1793 S5, BR-21 to BR-27, V5): one session
 * per user per project, of the standard coordinator worker the installation
 * names, linked to its project when it is created. Its delegates are one
 * record per workstream its user has open in the project, written only by the
 * workstream's open and done paths; a post hands work to one of them, into
 * that workstream's own session.
 *
 * On the real engine and the real HTTP router, as users of two organizations
 * named by verified headers. Each user hires their own leads on the `lead`
 * flow, which takes a delegated post and leads a workstream. The coordinator's
 * judgment turn is scripted.
 */
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { runAction } from "@flow-state-dev/engine";
import { mockGenerator, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  COORDINATOR_KIND,
  COORDINATOR_ROUTE,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineWorkstreamBlocks,
  delegatedPostEntry,
  MAX_DELEGATES,
  projectCoordinatorTools,
  WORKSTREAM_DELEGATE_ACTION,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import type { WorkerManifest } from "../src/manifest";
import { ROSTER_FLOW_KIND } from "../src/workers/keys";
import { bootProjectsHost, countingStores, OTHER_ORG, refusal } from "./projects-harness";

const apollo = { visibility: "shared" as const, id: "apollo" };
const notes = { visibility: "private" as const, id: "notes" };
const PROJECT_COORDINATOR = "project-coordinator";

/** The standard workers: the project coordinator the installation names, and another coordinator. */
const standardWorkers: WorkerManifest[] = [
  {
    id: PROJECT_COORDINATOR,
    declared: {
      flow: "coordinator",
      routing: "judgment",
      description: "Talks to you about one project.",
      tools: ["readProject"]
    },
    body: "Answer from the project's workstreams; hand work only to your own.",
    skills: []
  },
  { id: "chief", declared: { flow: "coordinator", description: "Your one point of contact." }, body: "", skills: [] }
];

/** One delegated post a lead heard: who, what, and in which session. */
type Heard = { worker: string; message: string; sessionId: string };

async function boot(options: { judgment?: MockGeneratorInstance; counted?: boolean } = {}) {
  const heard: Heard[] = [];
  const counting = options.counted === true ? countingStores() : undefined;
  const projects = defineProjectBlocks();
  const leadFlowRef = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {}, onDelegatedPost: {} } } };
  const h = await bootProjectsHost(
    {
      standardWorkers,
      projectCoordinator: PROJECT_COORDINATOR,
      lab: (installation) => ({
        ...projects.actions,
        ...defineWorkstreamBlocks({ installation, leadFlows: [leadFlowRef] }).actions
      }),
      lead: (installation) => {
        const { updateWorkstreamTool } = defineWorkstreamBlocks({ installation, leadFlows: [leadFlowRef] });
        const load = handler({
          name: "lead-load",
          inputSchema: z.record(z.unknown()),
          outputSchema: z.record(z.unknown()),
          resources: { ...installation.resources },
          execute: async (input, ctx) => {
            await installation.resolveWorker(ctx, "lead");
            return input;
          }
        });
        return {
          updateOwn: {
            block: sequencer({ name: "lead-update-own", inputSchema: z.record(z.unknown()) }).step(load).step(updateWorkstreamTool)
          }
        };
      },
      leadInternal: (installation) => {
        const turn = handler({
          name: "lead-delegated-turn",
          inputSchema: z.object({ message: z.string() }),
          resources: { ...installation.resources },
          execute: async (input, ctx) => {
            const worker = await installation.resolveWorker(ctx, "lead");
            heard.push({ worker: worker.id, message: input.message, sessionId: ctx.session.identity.id });
            return `${worker.id} on it: ${input.message}`;
          }
        });
        return { [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry(), onDelegatedPost: delegatedPostEntry(turn) };
      },
      flows: (installation) => ({
        [COORDINATOR_KIND]: defineCoordinatorFlow({
          installation,
          delegateFlows: [leadFlowRef],
          routeModel: "typesafe-ai/jev",
          agent: { catalog: projectCoordinatorTools }
        })
      }),
      models: { generators: { "coordinator-judgment": options.judgment ?? mockGenerator({ script: [] }) } }
    },
    counting === undefined ? {} : { stores: counting.stores }
  );
  const lab = (user: string, org?: string) => h.openSession(user, "lab", undefined, org);
  const client = (user: string, org?: string) => createWorkforceClient({ userId: user, fetcher: h.fetcherFor(user, org) });
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "notes", title: "My notes", visibility: "private" });

  /** `user` hires `lead` (once) and opens `id` in `project` with it. */
  const open = async (user: string, id: string, lead: string, project: { visibility: "shared" | "private"; id: string } = apollo) => {
    // Hiring an id already on the roster is refused, and that's fine here.
    await h.act(user, ROSTER_FLOW_KIND, await h.openSession(user, ROSTER_FLOW_KIND), "hire", { id: lead, flow: "lead" });
    return h.ok(user, "lab", await lab(user), "openWorkstream", { project, id, title: `${user}'s ${id}`, lead });
  };
  /** Mark `user`'s workstream `id` with `status`, from the app. */
  const mark = async (user: string, id: string, status: string) =>
    h.ok(user, "lab", await lab(user), "updateWorkstream", { project: apollo, id, status });
  /** `user`'s project coordinator for `project`, created the first time. */
  const coordinator = async (user: string, project = apollo, org?: string) =>
    (await client(user, org).ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: project })).id;
  /** The coordinator conversation's delegate records, as `listDelegates` answers them. */
  const delegates = async (user: string, sessionId: string) =>
    ((await h.ok(user, COORDINATOR_KIND, sessionId, "listDelegates", {})) as { delegates: Array<{ worker: string; target?: string }> })
      .delegates.map(({ worker, target }) => ({ worker, ...(target === undefined ? {} : { target }) }));
  /** Wait until `check` passes, or fail with its last error. */
  const eventually = async (check: () => Promise<void>, ms = 5_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        return await check();
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  };
  /** Run the coordinator's internal entry for workstream records, as an entry path does. */
  const internal = async (user: string, sessionId: string, input: unknown) =>
    runAction({
      flow: h.instances[COORDINATOR_KIND]!,
      actionName: WORKSTREAM_DELEGATE_ACTION,
      input,
      userId: user,
      orgId: "acme",
      sessionId,
      stores: h.runtime.stores,
      runtimeConfig: { ...h.runtime.runtimeConfig },
      source: "internal"
    } as never) as Promise<{ status?: string; error?: unknown }>;
  /** Every request in the store, once none is still running. */
  const settled = async () => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const all = await h.runtime.stores.request.list({});
      if (!all.some((request: { status: string }) => request.status === "in_progress")) return all;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  /** A conversation's `coordinator-route` records and messages, oldest first. */
  const items = async (sessionId: string) => {
    const requests = await h.runtime.stores.request.list({ sessionId, withItems: true });
    const all = requests
      .sort((a: { createdAt: number }, b: { createdAt: number }) => a.createdAt - b.createdAt)
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? []);
    return {
      records: all.filter((item) => item.type === "component" && item.component === COORDINATOR_ROUTE).map((item) => item.data),
      messages: all
        .filter((item) => item.type === "message")
        .map((item) => ({ agentName: item.agentName as string | undefined, text: JSON.stringify(item.content ?? item.text ?? "") }))
    };
  };
  return { ...h, heard, counting, lab, client, open, mark, coordinator, delegates, eventually, internal, settled, items };
}

describe("a user's project coordinator (BR-21, BR-22, BR-23)", () => {
  it("is her own session of the named coordinator, linked to the project when it is created, and found after (BR-21)", async () => {
    const h = await boot();
    const first = await h.coordinator("alice");
    expect(await h.coordinator("alice")).toBe(first);
    const record = await h.sessionRecord(first);
    expect(record).toMatchObject({ userId: "alice", flowKind: COORDINATOR_KIND });
    expect(record!.state).toMatchObject({ workerId: PROJECT_COORDINATOR, projectId: "shared/apollo" });
    // One per project: her private project has its own.
    const mine = await h.coordinator("alice", notes);
    expect(mine).not.toBe(first);
    expect((await h.sessionRecord(mine))!.state).toMatchObject({ projectId: "private/notes" });
    expect(await h.client("alice").findWorkerSession({ worker: PROJECT_COORDINATOR, projectId: apollo })).toMatchObject({ id: first });
  });

  it("is Bob's own for Bob, and he never reaches Alice's (BR-22)", async () => {
    const h = await boot();
    const hers = await h.coordinator("alice");
    const his = await h.coordinator("bob");
    expect(his).not.toBe(hers);
    expect((await h.sessionRecord(his))!.userId).toBe("bob");
    const reached = await h.act("bob", COORDINATOR_KIND, hers, "run", { message: "what's going on?" });
    expect(reached.settled).not.toBe("completed");
    expect(reached.http).toBeGreaterThanOrEqual(400);
  });

  it("refuses a create naming a project its user can't read, a worker other than the named one, or an id of its own (BR-23)", async () => {
    const h = await boot();
    /** What a refused ensure answered: its status and its body. */
    const refusedWith = async (attempt: Promise<unknown>) => {
      try {
        await attempt;
      } catch (error) {
        const failed = error as { status?: number; body?: unknown };
        return { status: failed.status, body: JSON.stringify(failed.body ?? "") };
      }
      throw new Error("expected the create to be refused");
    };
    // Alice's private project is not Bob's to reach.
    const bobs = await refusedWith(h.client("bob").ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: notes }));
    expect(bobs).toMatchObject({ status: 404, body: expect.stringContaining('no private project \\"notes\\"') });
    // A project nobody made.
    const nope = await refusedWith(
      h.client("alice").ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: { visibility: "shared", id: "nope" } })
    );
    expect(nope).toMatchObject({ status: 404, body: expect.stringContaining("nope") });
    // Apollo is acme's, not the second organization's.
    const elsewhere = await refusedWith(
      h.client("alice", OTHER_ORG).ensureWorkerSession({ worker: PROJECT_COORDINATOR, projectId: apollo })
    );
    expect(elsewhere).toMatchObject({ status: 404, body: expect.stringContaining("apollo") });
    // Another coordinator can't carry the link.
    const chief = await refusedWith(h.client("alice").ensureWorkerSession({ worker: "chief", projectId: apollo }));
    expect(chief.body).toContain(PROJECT_COORDINATOR);
    // Nor can a session created at an id of the caller's choosing.
    const byHand = await h.tryOpenSession("alice", COORDINATOR_KIND, { workerId: PROJECT_COORDINATOR, projectId: "shared/apollo" });
    expect(byHand.status).toBe(400);
    expect(JSON.stringify(byHand.json)).toContain("one session per user per project");
    expect(await h.sessionsWith("projectId", "shared/nope")).toEqual([]);
    expect((await h.sessionsWith("projectId", "shared/apollo")).length).toBe(0);
  });
});

describe("its delegates (BR-21a, BR-21b)", () => {
  it("takes a record for each workstream she has open when it is first created, two for one lead's two, and none of Bob's", async () => {
    const h = await boot();
    await h.open("alice", "checkout", "alice-lead");
    await h.open("alice", "search", "alice-lead");
    await h.open("bob", "billing", "bob-lead");
    await h.open("alice", "drafts", "alice-lead", notes);
    const id = await h.coordinator("alice");
    expect(await h.delegates("alice", id)).toEqual([
      { worker: "alice-lead", target: "shared/apollo/checkout" },
      { worker: "alice-lead", target: "shared/apollo/search" }
    ]);
    expect(await h.delegates("bob", await h.coordinator("bob"))).toEqual([
      { worker: "bob-lead", target: "shared/apollo/billing" }
    ]);
  });

  it("gains a record when she opens a workstream, loses it when she marks it done, and gets it back when she moves it out of done", async () => {
    const h = await boot();
    const id = await h.coordinator("alice");
    expect(await h.delegates("alice", id)).toEqual([]);
    await h.open("alice", "checkout", "alice-lead");
    const record = { worker: "alice-lead", target: "shared/apollo/checkout" };
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([record]));
    await h.mark("alice", "checkout", "done");
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([]));
    await h.mark("alice", "checkout", "waiting on legal");
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([record]));
  });

  it("drops the record when the lead marks the workstream done from its own session", async () => {
    const h = await boot();
    const opened = await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    expect(await h.delegates("alice", id)).toHaveLength(1);
    await h.ok("alice", "lead", opened.workstream.sessionId, "updateOwn", { status: "done" });
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([]));
  });

  it("restores a missing record when the same workstream is opened again", async () => {
    const h = await boot();
    const id = await h.coordinator("alice");
    await h.open("alice", "checkout", "alice-lead");
    const record = { worker: "alice-lead", target: "shared/apollo/checkout" };
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([record]));
    const removed = await h.internal("alice", id, { change: "remove", ...record });
    expect(removed.error, JSON.stringify(removed.error)).toBeUndefined();
    expect(await h.delegates("alice", id)).toEqual([]);
    expect((await h.open("alice", "checkout", "alice-lead")).opened).toBe(false);
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([record]));
  });

  it("refuses a record for a workstream that isn't hers, open, and led by that worker", async () => {
    const h = await boot();
    await h.open("bob", "billing", "bob-lead");
    await h.open("alice", "checkout", "alice-lead");
    await h.mark("alice", "checkout", "done");
    const id = await h.coordinator("alice");
    for (const record of [
      { worker: "bob-lead", target: "shared/apollo/billing" },
      { worker: "alice-lead", target: "shared/apollo/checkout" },
      { worker: "bob-lead", target: "shared/apollo/nothing" },
      { worker: "alice-lead", target: "shared/other/checkout" }
    ]) {
      const added = await h.internal("alice", id, { change: "add", ...record });
      expect(added.error, JSON.stringify(record)).toBeDefined();
    }
    expect(await h.delegates("alice", id)).toEqual([]);
  });

  it(`refuses her workstream past ${MAX_DELEGATES} open in one project, naming the cap, and writes nothing (BR-21b)`, async () => {
    const h = await boot();
    for (let i = 0; i < MAX_DELEGATES; i += 1) await h.open("alice", `ws-${i}`, "alice-lead");
    const lab = await h.lab("alice");
    const refused = await h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "one-more", title: "One more", lead: "alice-lead" });
    expect(refused.settled).not.toBe("completed");
    expect(refusal(refused)).toContain(String(MAX_DELEGATES));
    expect(await h.sessionsWith("workstreamId", "shared/apollo/one-more")).toEqual([]);
    // Marking one done makes room.
    await h.mark("alice", "ws-0", "done");
    expect(await h.ok("alice", "lab", lab, "openWorkstream", { project: apollo, id: "one-more", title: "One more", lead: "alice-lead" })).toMatchObject({ opened: true });
  }, 60_000);
});

describe("a post (BR-24 to BR-27, V5)", () => {
  /** A judgment turn that runs `calls`, one tool call each step, then answers `last`. */
  const scripted = (calls: Array<{ toolName: string; args: Record<string, unknown> }>, last = "Done.") =>
    mockGenerator({
      script: [
        ...calls.map((call, index) => ({ toolCalls: [{ toolCallId: `c${index}`, toolName: call.toolName, args: call.args }] })),
        { text: last }
      ]
    });

  it("hands work to her own workstream's lead, delivered once into that workstream's session, and its answer comes back (BR-25)", async () => {
    const judgment = scripted([{ toolName: "handOff", args: { worker: "alice-lead", target: "shared/apollo/checkout" } }]);
    const h = await boot({ judgment });
    const opened = await h.open("alice", "checkout", "alice-lead");
    await h.open("alice", "search", "alice-lead");
    const id = await h.coordinator("alice");
    const posted = await h.act("alice", COORDINATOR_KIND, id, "run", { message: "Please add guest checkout." });
    expect(posted.settled, JSON.stringify(posted.error)).toBe("completed");
    await h.settled();
    expect(h.heard).toEqual([
      { worker: "alice-lead", message: expect.stringContaining("Please add guest checkout."), sessionId: opened.workstream.sessionId }
    ]);
    const { records, messages } = await h.items(id);
    expect(records).toEqual([
      expect.objectContaining({
        by: "judgment",
        delegates: [{ worker: "alice-lead", target: "shared/apollo/checkout", outcome: "delivered" }]
      })
    ]);
    expect(messages.some((message) => message.agentName === "alice-lead" && message.text.includes("on it"))).toBe(true);
  });

  it("refuses Bob's workstream like a missing delegate, and records it (BR-26)", async () => {
    const judgment = scripted([{ toolName: "handOff", args: { worker: "bob-lead", target: "shared/apollo/billing" } }]);
    const h = await boot({ judgment });
    await h.open("bob", "billing", "bob-lead");
    await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_KIND, id, "run", { message: "Get billing to fix the invoice." });
    await h.settled();
    expect(h.heard).toEqual([]);
    const [record] = (await h.items(id)).records;
    expect(record).toMatchObject({ by: "judgment", none: "the coordinator handed it to no delegate" });
    expect(record.delegates).toEqual([
      expect.objectContaining({ worker: "bob-lead", outcome: "skipped", reason: expect.stringContaining("isn't a delegate") })
    ]);
  });

  it("reads every entry, Bob's included, and has nobody to hand work to when she owns no workstream there (BR-24, BR-27)", async () => {
    const judgment = scripted([{ toolName: "readProject", args: {} }], "Bob's billing is on track; you have no workstream here.");
    const h = await boot({ judgment });
    await h.open("bob", "billing", "bob-lead");
    await h.mark("bob", "billing", "PERIWINKLE-7319");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_KIND, id, "run", { message: "How is Apollo going?" });
    await h.settled();
    expect(await h.delegates("alice", id)).toEqual([]);
    // The tool's answer reached the model: Bob's held-out status word with it.
    // The tool's answer reached the turn: Bob's held-out status word with it.
    const requests = await h.runtime.stores.request.list({ sessionId: id, withItems: true });
    const toolItems = requests
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
      .filter((item) => JSON.stringify(item).includes("readProject"));
    expect(JSON.stringify(toolItems)).toContain("PERIWINKLE-7319");
    // Nothing was opened for her.
    expect((await h.sessionsWith("workerId", "alice-lead")).length).toBe(0);
  });

  it("lists the project's entries at most once in a turn, for its delegates and its read tool together (V5)", async () => {
    const judgment = scripted([
      { toolName: "readProject", args: {} },
      { toolName: "handOff", args: { worker: "alice-lead", target: "shared/apollo/checkout" } }
    ]);
    const h = await boot({ judgment, counted: true });
    await h.open("alice", "checkout", "alice-lead");
    await h.open("bob", "billing", "bob-lead");
    const id = await h.coordinator("alice");
    h.counting!.reads.length = 0;
    await h.act("alice", COORDINATOR_KIND, id, "run", { message: "Status, then hand checkout the copy." });
    await h.settled();
    expect(h.heard).toHaveLength(1);
    const lists = h.counting!.reads.filter((read) => read.includes("prefix") && read.includes("workstreams/"));
    expect(lists.length, lists.join("\n")).toBeLessThanOrEqual(1);
  });
});
