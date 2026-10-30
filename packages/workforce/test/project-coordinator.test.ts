/**
 * A user's project coordinator (FIX-1793 S5, BR-21 to BR-27, V5): one session
 * per user per project, of the standard coordinator worker the installation
 * names, linked to its project when it is created. Its delegates are one
 * record per workstream its user has open in the project, written only by the
 * workstream's open and done paths; a routed task hands work to one of them,
 * naming its record by `target`, into that workstream's own session.
 *
 * On the real engine and the real HTTP router, as users of two organizations
 * named by verified headers. Each user hires their own leads on the `lead`
 * flow, which takes a conversation's tasks and leads a workstream. The coordinator's
 * judgment turn is scripted.
 */
import { createClient } from "@flow-state-dev/client";
import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { runAction } from "@flow-state-dev/engine";
import { mockEvaluationModel, mockGenerator, type MockEvaluationModel, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  COORDINATOR_FLOW,
  COORDINATOR_ROUTE,
  defineCoordinatorFlow,
  defineProjectBlocks,
  defineWorkstreamBlocks,
  MAX_DELEGATES,
  projectCoordinatorTools,
  WORKSTREAM_DELEGATE_ACTION,
  WORKSTREAM_OPENED_ENTRY,
  workerTaskEntry,
  workstreamOpenedEntry
} from "../src/index";
import type { WorkerManifest } from "../src/manifest";
import { ROSTER_FLOW } from "../src/workers/keys";
import { askMidway, currentWorkerClaim } from "@flow-state-dev/orchestration/task-board";
import { findTaskPartitions } from "@flow-state-dev/orchestration/tasks";
import { CONVERSATION_LEDGER_ID, conversationLedgerAt } from "../src/conversation-board/ledger";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import { workerMessagesResources } from "../src/messages";
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
      tools: ["readProject", "listLeads", "openWorkstream", "editWorkstream"]
    },
    body: "Answer from the project's workstreams; hand work only to your own.",
    skills: []
  },
  { id: "chief", declared: { flow: "coordinator", description: "Your one point of contact." }, body: "", skills: [] }
];

/**
 * The project coordinator's catalog: its project read, the workstream open
 * and lead list an app gives whoever opens workstreams, and the owner's edit.
 */
function openingTools(installation: Parameters<typeof defineWorkstreamBlocks>[0]["installation"], checksFit = false) {
  const workstreams = defineWorkstreamBlocks({
    installation,
    leadFlows: [{ kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } }],
    ...(checksFit ? { leadFit: { model: "test/fit" } } : {})
  });
  return {
    ...projectCoordinatorTools,
    listLeads: workstreams.listLeadsTool,
    openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream", description: "Open a workstream." }),
    editWorkstream: workstreams.editWorkstreamTool
  };
}

/** A judgment turn that runs `calls`, one tool call each step, then answers `last`. */
const scripted = (calls: Array<{ toolName: string; args: Record<string, unknown> }>, last = "Done.") =>
  mockGenerator({
    script: [
      ...calls.map((call, index) => ({ toolCalls: [{ toolCallId: `c${index}`, toolName: call.toolName, args: call.args }] })),
      { text: last }
    ]
  });

/** One routed task a lead heard: who, what, and in which session. */
type Heard = { worker: string; message: string; sessionId: string };

async function boot(
  options: {
    judgment?: MockGeneratorInstance;
    counted?: boolean;
    /** The one fit check's scripted evaluation, asked about the chosen lead. */
    leadFit?: MockEvaluationModel;
    /** When set, the fit check's evaluation is refused as a language model's, and this answers the same question. */
    leadFitAsLanguage?: MockGeneratorInstance;
    coordinatorDelegates?: "all";
    /** The lead flow hears worker messages, so its tasks' questions are told to their filer. */
    hears?: boolean;
  } = {}
) {
  const heard: Heard[] = [];
  const counting = options.counted === true ? countingStores() : undefined;
  const projects = defineProjectBlocks();
  const leadFlowRef = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost(
    {
      standardWorkers:
        options.coordinatorDelegates === undefined
          ? standardWorkers
          : standardWorkers.map((worker) =>
              worker.id === PROJECT_COORDINATOR ? { ...worker, declared: { ...worker.declared, delegates: options.coordinatorDelegates } } : worker
            ),
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
      leadInternal: (installation) => ({
        [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry(),
        ...(options.hears === true ? { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "lead" }) } : {})
      }),
      leadTask: (installation) => {
        const turn = handler({
          name: "lead-task-turn",
          inputSchema: z.object({ message: z.string() }),
          resources: { ...installation.resources, ...(options.hears === true ? workerMessagesResources : {}) },
          execute: async (input, ctx) => {
            const worker = await installation.resolveWorker(ctx, "lead");
            heard.push({ worker: worker.id, message: input.message, sessionId: ctx.session.identity.id });
            // `[ask]` asks one question midway, once: the lead's model calling holdTaskForUser.
            const claim = input.message.includes("[ask]") ? currentWorkerClaim(ctx as never) : undefined;
            if (claim !== undefined) {
              const [partition] = await findTaskPartitions(ctx as never, CONVERSATION_LEDGER_ID, claim.taskId);
              const board = (await conversationLedgerAt(ctx as never, partition!))!;
              if (board.get(claim.taskId)?.askedInTurn === undefined) {
                const asked = await askMidway(ctx as never, board, [{ prompt: "Which payment provider?" }]);
                if (!asked.ok) throw new Error(`the question could not hold the task: ${asked.reason}`);
                return "asked";
              }
            }
            return `${worker.id} on it: ${input.message}`;
          }
        });
        return { work: workerTaskEntry({ name: "lead-task", turn }) };
      },
      flows: (installation) => ({
        [COORDINATOR_FLOW]: defineCoordinatorFlow({
          installation,
          routeModel: "typesafe-ai/jev",
          agent: { catalog: openingTools(installation, options.leadFit !== undefined || options.leadFitAsLanguage !== undefined) }
        })
      }),
      models: {
        evaluators: {
          ...(options.leadFitAsLanguage !== undefined
            ? {
                // The gateway's refusal of a language model, whatever `leadFit.model` names.
                "workstream-lead-fit": mockEvaluationModel({
                  error: new Error("Model is a language model, not a decision model. Use the language generation API instead.")
                })
              }
            : options.leadFit === undefined
              ? {}
              : { "workstream-lead-fit": options.leadFit })
        },
        generators: {
          "coordinator-judgment": options.judgment ?? mockGenerator({ script: [] }),
          ...(options.leadFitAsLanguage === undefined ? {} : { "workstream-lead-fit-ask": options.leadFitAsLanguage })
        }
      }
    },
    counting === undefined ? {} : { stores: counting.stores }
  );
  const lab = (user: string, org?: string) => h.openSession(user, "lab", undefined, org);
  const client = (user: string, org?: string) => createWorkforceClient(createClient({ userId: user, fetcher: h.fetcherFor(user, org) }));
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "notes", title: "My notes", visibility: "private" });

  /** `user` hires `lead` (once) and opens `id` in `project` with it. */
  const open = async (user: string, id: string, lead: string, project: { visibility: "shared" | "private"; id: string } = apollo) => {
    // Hiring an id already on the roster is refused, and that's fine here.
    await h.act(user, ROSTER_FLOW, await h.openSession(user, ROSTER_FLOW), "hire", { id: lead, flow: "lead", settings: { delegates: [`${lead}.helper`] } });
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
    ((await h.ok(user, COORDINATOR_FLOW, sessionId, "listDelegates", {})) as { delegates: Array<{ worker: string; target?: string }> })
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
      flow: h.instances[COORDINATOR_FLOW]!,
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
    expect(record).toMatchObject({ userId: "alice", flowKind: COORDINATOR_FLOW });
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
    const reached = await h.act("bob", COORDINATOR_FLOW, hers, "respond", { message: "what's going on?" });
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
    const byHand = await h.tryOpenSession("alice", COORDINATOR_FLOW, { workerId: PROJECT_COORDINATOR, projectId: "shared/apollo" });
    expect(byHand.status).toBe(400);
    expect(JSON.stringify(byHand.json)).toContain("one session per user per project");
    expect(await h.sessionsWith("projectId", "shared/nope")).toEqual([]);
    expect((await h.sessionsWith("projectId", "shared/apollo")).length).toBe(0);
  });

  it("no-project-session · is not one of her conversations with the coordinator: she reaches it through its project (FIX-2158)", async () => {
    const h = await boot();
    const project = await h.coordinator("alice");
    const app = h.client("alice");
    // Listed before her default conversation exists: the project session is top-level and names the worker.
    expect(await app.listWorkerSessions(PROJECT_COORDINATOR)).toEqual([]);
    const main = await app.ensureWorkerSession({ worker: PROJECT_COORDINATOR });
    const listed = await app.listWorkerSessions(PROJECT_COORDINATOR);
    expect(listed.map((entry) => [entry.session.id, entry.isDefault])).toEqual([[main.id, true]]);
    expect(listed.map((entry) => entry.session.id)).not.toContain(project);
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

describe("a routed task (BR-24 to BR-27, V5)", () => {
  it("hands work to her own workstream's lead, delivered once into that workstream's session, and its answer comes back (BR-25)", async () => {
    const judgment = scripted([{ toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } }]);
    const h = await boot({ judgment });
    const opened = await h.open("alice", "checkout", "alice-lead");
    await h.open("alice", "search", "alice-lead");
    const id = await h.coordinator("alice");
    const posted = await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." });
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

  it("tells the conversation that routed it the lead's midway question, saying the user answers it from the Inbox (FIX-2241)", async () => {
    const judgment = scripted([{ toolName: "createTask", args: { goal: "Take this [ask]", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } }]);
    const h = await boot({ judgment, hears: true });
    const opened = await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    expect((await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." })).settled).toBe("completed");
    await h.settled();
    expect(h.heard.map((heard) => heard.sessionId)).toEqual([opened.workstream.sessionId]);
    const listed = (await h.ok("alice", COORDINATOR_FLOW, id, "listTasks_tasks", {})) as { tasks: Array<{ id: string; status: string }> };
    expect(listed.tasks).toEqual([expect.objectContaining({ status: "in_progress" })]);
    const told = (await h.items(id)).messages.filter((message) => message.agentName === "alice-lead" && message.text.includes("asks:"));
    expect(told).toHaveLength(1);
    expect(told[0]!.text).toContain(`(${listed.tasks[0]!.id}) asks: \\"Which payment provider?\\"`);
    expect(told[0]!.text).toContain("The user answers it from their Inbox; it isn't yours to answer.");
    expect(told[0]!.text).not.toContain("updateTask");
  });

  it("hands her next ask to the same workstream once the lead answered the first (FIX-2083)", async () => {
    const take = { toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } };
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "c0", ...take }] }, { text: "Handed on." }, { toolCalls: [{ toolCallId: "c1", ...take }] }, { text: "Handed on." }]
    });
    const h = await boot({ judgment });
    const opened = await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    expect((await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." })).settled).toBe("completed");
    await h.settled();
    expect((await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "And a gift note." })).settled).toBe("completed");
    await h.settled();
    expect(h.heard.map((heard) => [heard.message.includes("gift") ? "second" : "first", heard.sessionId])).toEqual([
      ["first", opened.workstream.sessionId],
      ["second", opened.workstream.sessionId]
    ]);
  });

  it("runs a follow-up of a routed task in that workstream's session (FIX-2111)", async () => {
    const judgment = scripted([{ toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } }]);
    const h = await boot({ judgment });
    const opened = await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    expect((await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." })).settled).toBe("completed");
    await h.settled();
    const listed = (await h.ok("alice", COORDINATOR_FLOW, id, "listTasks_tasks", {})) as { tasks: Array<{ id: string; status: string }> };
    expect(listed.tasks).toEqual([expect.objectContaining({ status: "completed" })]);
    const followUp = await h.act("alice", COORDINATOR_FLOW, id, "createTask_tasks", { goal: "Now a shorter version", followUpOf: listed.tasks[0]!.id });
    expect(followUp.output, JSON.stringify(followUp.output)).toMatchObject({ ok: true });
    await h.settled();
    // The lead heard both in the workstream's session, where the first ran.
    expect(h.heard.map((heard) => [heard.message.includes("shorter") ? "follow-up" : "routed", heard.sessionId])).toEqual([
      ["routed", opened.workstream.sessionId],
      ["follow-up", opened.workstream.sessionId]
    ]);
  });

  it("fails a follow-up whose workstream session is gone, and the conversation hears it (FIX-2111)", async () => {
    const take = { toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } };
    // The first call routes the message; any later one is a turn reading a notice.
    const judgment = mockGenerator({
      script: [{ toolCalls: [{ toolCallId: "c0", ...take }] }, { text: "Done." }, { when: () => true, then: { text: "Noted the failure." } }]
    });
    const h = await boot({ judgment });
    const opened = await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    expect((await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." })).settled).toBe("completed");
    await h.settled();
    const listed = (await h.ok("alice", COORDINATOR_FLOW, id, "listTasks_tasks", {})) as { tasks: Array<{ id: string }> };
    // The session the routed task ran in, and its follow-up would run in, no longer exists.
    await h.runtime.stores.session.delete(opened.workstream.sessionId);
    const callsBefore = judgment.calls.length;
    const followUp = await h.act("alice", COORDINATOR_FLOW, id, "createTask_tasks", { goal: "Now a shorter version", followUpOf: listed.tasks[0]!.id });
    const filed = followUp.output as { ok: boolean; taskId?: string };
    expect(filed).toMatchObject({ ok: true });
    await h.settled();
    // A judgment coordinator takes a turn to read the failure, as for any task it filed (FIX-2122).
    const woken = judgment.calls.slice(callsBefore);
    expect(woken).toHaveLength(1);
    expect(JSON.stringify(woken[0]!.input)).toContain("failed for good");
    // It never runs anywhere else: the hand-over fails it, naming the missing session.
    const row = (await h.ok("alice", COORDINATOR_FLOW, id, "getTask_tasks", { id: filed.taskId })) as { task: { status: string; error?: string } };
    expect(row.task).toMatchObject({ status: "errored", error: expect.stringContaining("session-not-found") });
    expect(h.heard).toHaveLength(1);
    // The conversation hears it, once.
    const { messages } = await h.items(id);
    expect(messages.filter((m) => m.text.includes(filed.taskId!) && m.text.includes("failed for good"))).toHaveLength(1);
  });

  it("refuses a task with no assignee and no target when her only delegate is a workstream's lead, rather than run it outside the workstream (FIX-2083)", async () => {
    const h = await boot();
    await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    const filed = await h.act("alice", COORDINATOR_FLOW, id, "createTask_tasks", { goal: "Look at the cart" });
    expect(filed.output).toEqual({ ok: false, error: expect.stringMatching(/^target_required: "alice-lead" leads a workstream here \(shared\/apollo\/checkout\)/) });
    await h.settled();
    expect(h.heard).toEqual([]);
  });

  it("refuses Bob's workstream like a missing delegate (BR-26)", async () => {
    const judgment = scripted([{ toolName: "createTask", args: { goal: "Take this", assignee: "bob-lead", target: "shared/apollo/billing", session: "ongoing", resultTo: "conversation" } }]);
    const h = await boot({ judgment });
    await h.open("bob", "billing", "bob-lead");
    await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Get billing to fix the invoice." });
    await h.settled();
    expect(h.heard).toEqual([]);
    const [record] = (await h.items(id)).records;
    expect(record).toMatchObject({ by: "judgment", delegates: [], none: "the coordinator handed it to no delegate" });
    // Refused by the filing's own check, before anything is routed.
    const outputs = (await h.runtime.stores.request.list({ sessionId: id, withItems: true }))
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
      .filter((item) => item.type === "tool_output" && item.blockName === "createTask");
    expect(outputs.map((item) => item.output.error)).toEqual([expect.stringMatching(/^unknown_assignee: "bob-lead"/)]);
  });

  it("reads every entry, Bob's included, and has nobody to hand work to when she owns no workstream there (BR-24, BR-27)", async () => {
    const judgment = scripted([{ toolName: "readProject", args: {} }], "Bob's billing is on track; you have no workstream here.");
    const h = await boot({ judgment });
    await h.open("bob", "billing", "bob-lead");
    await h.mark("bob", "billing", "PERIWINKLE-7319");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "How is Apollo going?" });
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

  it("marks the user's own workstreams in its read, since the model sees owners only as user ids", async () => {
    const judgment = scripted([{ toolName: "readProject", args: {} }], "Checkout is yours; billing is Bob's.");
    const h = await boot({ judgment });
    await h.open("alice", "checkout", "alice-lead");
    await h.open("bob", "billing", "bob-lead");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Which of these workstreams is mine?" });
    await h.settled();
    const requests = await h.runtime.stores.request.list({ sessionId: id, withItems: true });
    const read = requests
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
      .find((item) => item.type === "tool_output" && item.blockName === "readProject");
    expect(read).toBeDefined();
    // Without the mark, a coordinator read its own user's workstream as another member's and handed it nothing.
    const marks = Object.fromEntries((read.output.workstreams as Array<{ id: string; owner: string; yours: boolean }>).map((w) => [w.id, w.yours]));
    expect(marks).toEqual({ checkout: true, billing: false });
  });

  it("lists the project's entries at most once in a turn, for its delegates and its read tool together (V5)", async () => {
    const judgment = scripted([
      { toolName: "readProject", args: {} },
      { toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } }
    ]);
    const h = await boot({ judgment, counted: true });
    await h.open("alice", "checkout", "alice-lead");
    await h.open("bob", "billing", "bob-lead");
    const id = await h.coordinator("alice");
    h.counting!.reads.length = 0;
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Status, then hand checkout the copy." });
    await h.settled();
    expect(h.heard).toHaveLength(1);
    const lists = h.counting!.reads.filter((read) => read.includes("prefix") && read.includes("workstreams/"));
    expect(lists.length, lists.join("\n")).toBeLessThanOrEqual(1);
  });
});

describe("opening a workstream from the coordinator (BR-38, BR-39, BR-40, BR-42)", () => {
  /** Hire `id` on `flow` onto `user`'s roster, listing `delegates`. */
  const hireOn = async (h: Awaited<ReturnType<typeof boot>>, user: string, id: string, flow: string, delegates: string[] | "all") =>
    h.ok(user, ROSTER_FLOW, await h.openSession(user, ROSTER_FLOW), "hire", {
      id,
      flow,
      description: `${user}'s ${id}`,
      ...(delegates.length === 0 ? {} : { settings: { delegates } })
    });
  /** What `listLeads` answered in a conversation's turns, as their tool outputs carry it. */
  const leadsOffered = async (h: Awaited<ReturnType<typeof boot>>, sessionId: string) => {
    const requests = await h.runtime.stores.request.list({ sessionId, withItems: true });
    return requests
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
      .filter((item) => item.type === "tool_output" && item.blockName === "listLeads")
      .map((item) => (item.output as { leads: Array<{ id: string }> }).leads.map((lead) => lead.id));
  };

  it("opens one led by a worker her hire put on her roster, and hands the request in, in the same turn (BR-38)", async () => {
    const judgment = scripted([
      { toolName: "listLeads", args: {} },
      // No project: the open lands in the project this conversation is linked to.
      { toolName: "openWorkstream", args: { id: "checkout", title: "Guest checkout", lead: "alice-lead", objectives: ["Ship it"] } },
      { toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/checkout", session: "ongoing", resultTo: "conversation" } }
    ]);
    const h = await boot({ judgment, counted: true });
    await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
    await hireOn(h, "alice", "alice-solo", "lead", []);
    await hireOn(h, "alice", "alice-quiet", "quiet", ["alice-quiet.helper"]);
    const roster = (await h.client("alice").roster()).map((worker) => worker.id).sort();
    const id = await h.coordinator("alice");
    h.counting!.reads.length = 0;
    const posted = await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." });
    expect(posted.settled, JSON.stringify(posted.error)).toBe("completed");
    await h.settled();
    // The whole open turn lists the project's entries at most once (V5's budget).
    const lists = h.counting!.reads.filter((read) => read.includes("prefix") && read.includes("workstreams/"));
    expect(lists.length, lists.join("\n")).toBeLessThanOrEqual(1);

    // It offered only the worker that can lead: on a lead flow, listing delegates.
    expect(await leadsOffered(h, id)).toEqual([["alice-lead"]]);
    // The open: her entry, led by her worker, and nothing added to her roster.
    expect((await h.client("alice").roster()).map((worker) => worker.id).sort()).toEqual(roster);
    const listed = (await h.ok("alice", "lab", await h.lab("alice"), "readProject", { project: apollo })) as {
      workstreams: Array<{ id: string; owner: string; lead: string; sessionId: string | null }>;
    };
    const entry = listed.workstreams.find((workstream) => workstream.id === "checkout")!;
    expect(entry).toMatchObject({ owner: "alice", lead: "alice-lead" });
    expect((await h.sessionRecord(entry.sessionId!))!.state).toMatchObject({
      workerId: "alice-lead",
      workstreamId: "shared/apollo/checkout"
    });
    // Its record is on her coordinator, and the dispatch in that same turn was delivered into the workstream's session.
    expect(await h.delegates("alice", id)).toEqual([{ worker: "alice-lead", target: "shared/apollo/checkout" }]);
    expect(h.heard).toEqual([{ worker: "alice-lead", message: expect.stringContaining("Please add guest checkout."), sessionId: entry.sessionId }]);
    const [record] = (await h.items(id)).records;
    expect(record).toMatchObject({
      by: "judgment",
      delegates: [{ worker: "alice-lead", target: "shared/apollo/checkout", outcome: "delivered" }]
    });
  });

  it("opens a second with the same lead as a second session and record, and a routed task to one lands only there (BR-40)", async () => {
    const judgment = scripted([
      { toolName: "openWorkstream", args: { project: apollo, id: "checkout", title: "Checkout", lead: "alice-lead" } },
      { toolName: "openWorkstream", args: { project: apollo, id: "search", title: "Search", lead: "alice-lead" } },
      { toolName: "createTask", args: { goal: "Take this", assignee: "alice-lead", target: "shared/apollo/search", session: "ongoing", resultTo: "conversation" } }
    ]);
    const h = await boot({ judgment });
    await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Make search fuzzy." });
    await h.settled();
    const sessions = await h.sessionsWith("workerId", "alice-lead");
    expect(sessions).toHaveLength(2);
    expect(await h.delegates("alice", id)).toEqual([
      { worker: "alice-lead", target: "shared/apollo/checkout" },
      { worker: "alice-lead", target: "shared/apollo/search" }
    ]);
    const search = sessions.find((session: { state: Record<string, unknown> }) => session.state.workstreamId === "shared/apollo/search");
    expect(h.heard).toEqual([{ worker: "alice-lead", message: expect.stringContaining("Make search fuzzy."), sessionId: search.id }]);
  });

  it("opens only in its own project: naming another she is on is refused, and nothing is written there", async () => {
    const judgment = scripted([
      { toolName: "openWorkstream", args: { project: notes, id: "journal", title: "Journal", lead: "alice-lead" } }
    ]);
    const h = await boot({ judgment });
    await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Start a journal." });
    await h.settled();
    const outputs = (await h.runtime.stores.request.list({ sessionId: id, withItems: true }))
      .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
      .filter((item) => item.blockName === "openWorkstream");
    expect(JSON.stringify(outputs)).toContain("other-project");
    const lab = await h.lab("alice");
    for (const project of [apollo, notes]) {
      const listed = (await h.ok("alice", "lab", lab, "readProject", { project })) as { workstreams: unknown[] };
      expect(listed.workstreams).toEqual([]);
    }
    expect(await h.delegates("alice", id)).toEqual([]);
  });

  it("offers nobody when no worker on her roster can lead (BR-39)", async () => {
    const judgment = scripted([{ toolName: "listLeads", args: {} }], "Nobody on your roster does that work.");
    const h = await boot({ judgment });
    await hireOn(h, "alice", "alice-solo", "lead", []);
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." });
    await h.settled();
    expect(await leadsOffered(h, id)).toEqual([[]]);
    expect(await h.delegates("alice", id)).toEqual([]);
  });

  it("refuses a lead that lists no delegates, or runs on a flow that can't lead, and writes nothing (BR-42)", async () => {
    const h = await boot();
    await hireOn(h, "alice", "alice-solo", "lead", []);
    await hireOn(h, "alice", "alice-quiet", "quiet", ["alice-quiet.helper"]);
    const lab = await h.lab("alice");
    const solo = await h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "checkout", title: "Checkout", lead: "alice-solo" });
    expect(refusal(solo)).toContain("cannot-lead");
    expect(refusal(solo)).toContain("lists no delegates");
    const quiet = await h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "checkout", title: "Checkout", lead: "alice-quiet" });
    expect(refusal(quiet)).toContain("cannot-lead");
    const listed = (await h.ok("alice", "lab", lab, "readProject", { project: apollo })) as { workstreams: unknown[] };
    expect(listed.workstreams).toEqual([]);
  });

  it("keeps a delegates: all coordinator's roster when it opens a workstream from its own turn (FIX-2081 D2)", async () => {
    const judgment = scripted([
      { toolName: "openWorkstream", args: { id: "checkout", title: "Guest checkout", lead: "alice-lead", objectives: ["Ship it"] } }
    ]);
    const h = await boot({ judgment, coordinatorDelegates: "all" });
    await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
    await hireOn(h, "alice", "alice-quiet", "quiet", ["alice-quiet.helper"]);
    const id = await h.coordinator("alice");
    const posted = await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Please add guest checkout." });
    expect(posted.settled, JSON.stringify(posted.error)).toBe("completed");
    await h.settled();
    // Her roster still reaches the coordinator beside the workstream's record. Today the open's own
    // write is a no-op here (the seed already names the new workstream), so this guards the outcome;
    // the defaults the write is handed match the coordinator's own (delegateDefaultsOf + withRoster).
    const workers = (await h.delegates("alice", id)).map((record) => record.worker);
    expect(workers).toEqual(expect.arrayContaining(["alice-lead", "alice-quiet"]));
    expect(await h.delegates("alice", id)).toContainEqual({ worker: "alice-lead", target: "shared/apollo/checkout" });
  });

  it("takes a lead whose file says delegates: all, which is the whole roster and never empty (FIX-2081 D2)", async () => {
    const h = await boot();
    await hireOn(h, "alice", "alice-all", "lead", "all");
    const lab = await h.lab("alice");
    expect(
      await h.ok("alice", "lab", lab, "openWorkstream", { project: apollo, id: "checkout", title: "Checkout", lead: "alice-all" })
    ).toMatchObject({ opened: true });
  });

  describe("checking its pick of lead against the work", () => {
    /**
     * The one fit check's call, asked about the chosen lead: it answers the
     * lead (the pick), `~none-fits`, or `~sort-unsaid` (the work doesn't say
     * its sort), each in turn when given several.
     */
    const fit = (...choices: string[]) => {
      let call = 0;
      return mockEvaluationModel({
        answers: () => ({ worker: { type: "choice", choice: choices[Math.min(call++, choices.length - 1)]!, confidence: 0.9 } })
      });
    };
    const NONE_FITS = "~none-fits";
    const SORT_UNSAID = "~sort-unsaid";
    const research = { id: "research", title: "Research: what to build next", lead: "alice-lead", objectives: ["Rank three ideas"] };
    /** What the open tool answered in a conversation's turns. */
    const opens = async (h: Awaited<ReturnType<typeof boot>>, sessionId: string) =>
      JSON.stringify(
        (await h.runtime.stores.request.list({ sessionId, withItems: true }))
          .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
          .filter((item) => item.type === "tool_output" && item.blockName === "openWorkstream")
      );
    const workstreams = async (h: Awaited<ReturnType<typeof boot>>) =>
      ((await h.ok("alice", "lab", await h.lab("alice"), "readProject", { project: apollo })) as { workstreams: Array<{ id: string }> })
        .workstreams.map((workstream) => workstream.id);

    it("refuses the lead when the one fit check answers none fits, and writes nothing", async () => {
      // The one lead she has can lead, so only its description says it is the wrong one for research.
      const leadFit = fit(NONE_FITS);
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: research }]), leadFit });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();

      expect(await opens(h, id)).toContain("lead-doesnt-fit");
      expect(await workstreams(h)).toEqual([]);
      expect(await h.delegates("alice", id)).toEqual([]);
      expect(h.heard).toEqual([]);
      // One call, asked the lead by its own description and the work, with the two choices beside the pick.
      expect(leadFit.calls).toHaveLength(1);
      const [call] = leadFit.calls;
      const criteria = (call!.questions as { worker: { criteria: Record<string, string> } }).worker.criteria;
      expect(Object.keys(criteria)).toEqual(["alice-lead", NONE_FITS, SORT_UNSAID]);
      expect(criteria["alice-lead"]).toContain("alice's alice-lead");
      expect(JSON.stringify(call!.state)).toContain("Research: what to build next");
      expect(JSON.stringify(call!.state)).toContain("Rank three ideas");
    });

    it("opens it when the one fit check picks the lead", async () => {
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: research }]), leadFit: fit("alice-lead") });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      expect(await workstreams(h)).toEqual(["research"]);
      expect(await opens(h, id)).toContain('"leadFit":{"checked":true}');
    });

    it("opens a bare-name workstream when the check answers the work doesn't say its sort: that is no clear misfit", async () => {
      // The work names no sort, so no lead can be the wrong sort for it.
      const unsaid = { id: "garnet", title: "garnet delta 6965", lead: "alice-lead", objectives: [] };
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: unsaid }]), leadFit: fit(SORT_UNSAID) });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream for garnet delta 6965." });
      await h.settled();
      expect(await opens(h, id)).not.toContain("lead-doesnt-fit");
      expect(await workstreams(h)).toEqual(["garnet"]);
      expect(await opens(h, id)).toContain('"leadFit":{"checked":true}');
    });

    it("opens it when the check can't answer, so a failed model call never stops an open, and says why", async () => {
      // The evaluator fails, and so does the check's one ask again as a language model (unscripted here).
      const h = await boot({
        judgment: scripted([{ toolName: "openWorkstream", args: research }]),
        leadFit: mockEvaluationModel({ error: new Error("the provider is down") })
      });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      expect(await workstreams(h)).toEqual(["research"]);
      // The open's record says the check didn't run, and why: a dead check shows up here, not nowhere.
      expect(await opens(h, id)).toContain('"leadFit":{"checked":false,"why":"unanswered: ');
    });

    it("lets the open through when the check answers something that is no choice, and says what it answered", async () => {
      // An evaluator can only answer a choice, so it is the language-model ask that can answer off the list.
      const leadFitAsLanguage = mockGenerator({ script: [{ structuredOutput: { worker: "someone-else" } }] });
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: research }]), leadFitAsLanguage });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      expect(await workstreams(h)).toEqual(["research"]);
      const answered = await opens(h, id);
      expect(answered).toContain('"leadFit":{"checked":false,"why":"unanswered: answered ');
      expect(answered).toMatch(/someone-else[^}]*which is not a choice/);
    });

    it("asks the same question as a language model when the model is one, as best fit does, and refuses on its none fits", async () => {
      const leadFitAsLanguage = mockGenerator({ script: [{ structuredOutput: { worker: NONE_FITS } }] });
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: research }]), leadFitAsLanguage });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      expect(leadFitAsLanguage.calls).toHaveLength(1);
      const asked = JSON.stringify(leadFitAsLanguage.calls[0]!.input);
      expect(asked).toContain("alice's alice-lead");
      expect(asked).toContain(NONE_FITS);
      expect(asked).toContain("Research: what to build next");
      expect(await opens(h, id)).toContain("lead-doesnt-fit");
      expect(await workstreams(h)).toEqual([]);
    });

    it("refuses on the open's own terms before asking the model: a bad id is refused as one, with no call", async () => {
      const leadFit = fit(NONE_FITS);
      const h = await boot({ judgment: scripted([{ toolName: "openWorkstream", args: { ...research, id: "two/segments" } }]), leadFit });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      const answered = await opens(h, id);
      expect(answered).toContain("invalid-workstream-id");
      expect(answered).not.toContain("lead-doesnt-fit");
      expect(leadFit.calls).toEqual([]);
    });

    it("doesn't check a workstream opened again: it was accepted once, and a second verdict can't refuse it", async () => {
      // The first open is judged a fit; asked again, the check would say none fits, but it is never asked.
      const leadFit = fit("alice-lead", NONE_FITS);
      const h = await boot({
        judgment: scripted([
          { toolName: "openWorkstream", args: research },
          { toolName: "openWorkstream", args: research }
        ]),
        leadFit
      });
      await hireOn(h, "alice", "alice-lead", "lead", ["alice-lead.helper"]);
      const id = await h.coordinator("alice");
      await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Open a workstream: research what to build next." });
      await h.settled();
      const answered = await opens(h, id);
      expect(answered).not.toContain("lead-doesnt-fit");
      expect(answered).toContain('"opened":false');
      expect(answered).toContain('"leadFit":{"checked":false,"why":"already-open"}');
      expect(leadFit.calls).toHaveLength(1);
      expect(await workstreams(h)).toEqual(["research"]);
    });

    it("doesn't check a user's own open from the app: their pick is theirs", async () => {
      const leadFit = fit(NONE_FITS);
      const h = await boot({ leadFit });
      expect(await h.open("alice", "research", "alice-lead")).toMatchObject({ opened: true });
      expect(leadFit.calls).toEqual([]);
    });
  });
});

describe("changing her workstreams from the coordinator", () => {
  /** What `editWorkstream` answered in a conversation's turns. */
  const edits = async (h: Awaited<ReturnType<typeof boot>>, sessionId: string) =>
    JSON.stringify(
      (await h.runtime.stores.request.list({ sessionId, withItems: true }))
        .flatMap((request: unknown) => (request as { items?: any[] }).items ?? [])
        .filter((item) => item.type === "tool_output" && item.blockName === "editWorkstream")
    );
  /** Every entry in Apollo, as the app's read lists them. */
  const entries = async (h: Awaited<ReturnType<typeof boot>>, user = "alice") =>
    ((await h.ok(user, "lab", await h.lab(user), "readProject", { project: apollo })) as {
      workstreams: Array<{ id: string; owner: string; title: string; status: string; due: string | null }>;
    }).workstreams;

  it("renames and dates her workstream, then closes it, and the close drops its record in that same turn", async () => {
    const judgment = scripted([
      // No project: the edit lands in the project this conversation is linked to.
      { toolName: "editWorkstream", args: { id: "checkout", title: "Guest checkout", due: "2026-11-30" } },
      { toolName: "editWorkstream", args: { id: "checkout", status: "done" } }
    ]);
    const h = await boot({ judgment });
    await h.open("alice", "checkout", "alice-lead");
    await h.open("alice", "search", "alice-lead");
    const id = await h.coordinator("alice");
    expect(await h.delegates("alice", id)).toHaveLength(2);
    const posted = await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Rename checkout to Guest checkout, due Nov 30, then close it." });
    expect(posted.settled, JSON.stringify(posted.error)).toBe("completed");
    await h.settled();
    expect((await entries(h)).find((entry) => entry.id === "checkout")).toMatchObject({
      owner: "alice",
      title: "Guest checkout",
      due: "2026-11-30",
      status: "done"
    });
    // Its record went in the turn itself, not by a dispatch landing after it: a
    // dispatch later in that turn must not find a closed workstream.
    expect(await h.delegates("alice", id)).toEqual([{ worker: "alice-lead", target: "shared/apollo/search" }]);
  });

  it("reopening one gets its record back only through the checked entry: a lead fired since takes none", async () => {
    const judgment = scripted([{ toolName: "editWorkstream", args: { id: "checkout", status: "on-track" } }]);
    const h = await boot({ judgment });
    await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    await h.mark("alice", "checkout", "done");
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([]));
    await h.ok("alice", ROSTER_FLOW, await h.openSession("alice", ROSTER_FLOW), "fire", { id: "alice-lead" });
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Reopen checkout." });
    await h.settled();
    expect((await entries(h)).find((entry) => entry.id === "checkout")).toMatchObject({ status: "on-track" });
    // The record add ran the delegate check, which refuses a lead no longer on her roster.
    expect(await h.delegates("alice", id)).toEqual([]);
  });

  it("reopening one whose lead is still hers brings its record back", async () => {
    const judgment = scripted([{ toolName: "editWorkstream", args: { id: "checkout", status: "on-track" } }]);
    const h = await boot({ judgment });
    await h.open("alice", "checkout", "alice-lead");
    const id = await h.coordinator("alice");
    await h.mark("alice", "checkout", "done");
    await h.eventually(async () => expect(await h.delegates("alice", id)).toEqual([]));
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Reopen checkout." });
    await h.settled();
    await h.eventually(async () =>
      expect(await h.delegates("alice", id)).toEqual([{ worker: "alice-lead", target: "shared/apollo/checkout" }])
    );
  });

  it.each([
    { refused: "no-such-workstream", what: "Bob's billing, by its id", args: { id: "billing", status: "done" } },
    { refused: "other-project", what: "her drafts in another project", args: { project: notes, id: "drafts", status: "done" } }
  ])("changes only her own, in its own project: $what is refused $refused, and nothing is written", async ({ refused, args }) => {
    const h = await boot({ judgment: scripted([{ toolName: "editWorkstream", args }]) });
    await h.open("bob", "billing", "bob-lead");
    await h.open("alice", "drafts", "alice-lead", notes);
    const bobsBefore = await entries(h, "bob");
    const id = await h.coordinator("alice");
    await h.act("alice", COORDINATOR_FLOW, id, "respond", { message: "Close it." });
    await h.settled();
    expect(await edits(h, id)).toContain(refused);
    expect(await entries(h, "bob")).toEqual(bobsBefore);
    const drafts = (await h.ok("alice", "lab", await h.lab("alice"), "readProject", { project: notes })) as {
      workstreams: Array<{ id: string; status: string }>;
    };
    expect(drafts.workstreams).toEqual([expect.objectContaining({ id: "drafts", status: "on-track" })]);
  });
});
