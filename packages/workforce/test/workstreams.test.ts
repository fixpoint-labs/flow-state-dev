/**
 * Workstreams: one entry per workstream, owned by one user, and its lead's
 * workstream session (FIX-1793 BR-7 to BR-17), on the real engine and the
 * real HTTP router, as users of one organization.
 *
 * - `alice` and `bob` are members of the shared `apollo`; `mallory` is in the
 *   org and on no project.
 * - Each user hires their own leads through the roster flow. A worker on
 *   `lead` can lead a workstream; one on `quiet` can't.
 *
 * Who may write an entry is the engine's owner rule at the store. These tests
 * try it by every path a user has: the app's action, the lead's tool, and flow
 * code writing the collection directly from a registered flow.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler, sequencer } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createWorkforceClient } from "../src/browser";
import {
  defineProjectBlocks,
  defineWorkstreamBlocks,
  WORKSTREAM_OPENED_ENTRY,
  WORKSTREAM_RESOURCES,
  WORKSTREAMS_RESOURCE,
  workstreamEntryKey,
  workstreamOpenedEntry,
  workstreamRef
} from "../src/index";
import { createWorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost, ORG, refusal, type ProjectsHost } from "./projects-harness";

const apollo = { visibility: "shared" as const, id: "apollo" };
const notes = { visibility: "private" as const, id: "notes" };

/** A registered flow that writes the entries directly, as any flow's code could. */
const forceWrite = handler({
  name: "force-write",
  inputSchema: z.object({ owner: z.string(), id: z.string() }),
  outputSchema: z.record(z.string()),
  resources: WORKSTREAM_RESOURCES,
  execute: async (input, ctx) => {
    const entries = ctx.resources[WORKSTREAMS_RESOURCE] as unknown as ResourceCollectionRef;
    const key = workstreamEntryKey("apollo", input.owner, input.id);
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "landed";
      } catch (error) {
        return `refused: ${(error as Error).message}`;
      }
    };
    const signed = { writtenBy: { userId: ctx.session.identity.userId! } };
    return {
      patch: await attempt(() => entries.upsert(key, { status: "blocked", ...signed } as never)),
      update: await attempt(async () => (await entries.get(key)).updateState((s: any) => ({ ...s, title: "MINE" }))),
      content: await attempt(async () => (await entries.get(key)).writeContent("overwritten")),
      replace: await attempt(() =>
        entries.create(key, { title: "MINE", lead: "x", openedAt: "x", updatedAt: "x", ...signed } as never, { replace: true })
      ),
      createUnderHerKey: await attempt(() =>
        entries.create(workstreamEntryKey("apollo", input.owner, "planted"), {
          title: "planted",
          lead: "x",
          openedAt: "x",
          updatedAt: "x",
          ...signed
        } as never)
      ),
      delete: await attempt(() => entries.delete(key))
    };
  }
});

/** Every entry of `apollo` at org scope, as stored: key, state and content. */
/**
 * The owner's own entry, made with no session named: what an open leaves
 * behind when it stalls after making the entry and before naming its session.
 */
const plantStalledOpen = handler({
  name: "plant-stalled-open",
  inputSchema: z.object({ id: z.string(), lead: z.string() }),
  outputSchema: z.object({}),
  resources: WORKSTREAM_RESOURCES,
  execute: async (input, ctx) => {
    const entries = ctx.resources[WORKSTREAMS_RESOURCE] as unknown as ResourceCollectionRef;
    const at = new Date().toISOString();
    await entries.create(workstreamEntryKey("apollo", ctx.session.identity.userId!, input.id), {
      title: input.id,
      lead: input.lead,
      sessionId: null,
      openedAt: at,
      updatedAt: at,
      writtenBy: { userId: ctx.session.identity.userId! }
    } as never);
    return {};
  }
});

const readAll = handler({
  name: "read-all-entries",
  inputSchema: z.object({ visibility: z.enum(["shared", "private"]).default("shared"), project: z.string().default("apollo") }),
  outputSchema: z.unknown(),
  resources: WORKSTREAM_RESOURCES,
  execute: async (input, ctx) => {
    const entries = ctx.resources[input.visibility === "private" ? "privateWorkstreams" : WORKSTREAMS_RESOURCE] as unknown as ResourceCollectionRef;
    const out: Array<{ path: string; state: unknown; report: string | null }> = [];
    for (const ref of await entries.list(`${input.project}/`)) {
      out.push({ path: ref.path, state: { ...ref.state }, report: await ref.readContent() });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
});

async function boot(): Promise<ProjectsHost & { lab: (user: string) => Promise<string> }> {
  const projects = defineProjectBlocks();
  const h = await bootProjectsHost({
    lab: (installation) => {
      const leadFlow = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
      const lead2Flow = { kind: "lead2", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
      const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [leadFlow, lead2Flow] });
      return {
        ...projects.actions,
        ...workstreams.actions,
        forceWrite: { block: forceWrite },
        readAll: { block: readAll },
        plantStalledOpen: { block: plantStalledOpen }
      };
    },
    leadInternal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() }),
    lead2Internal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() }),
    lead: (installation) => {
      const { updateWorkstreamTool } = defineWorkstreamBlocks({
        installation,
        leadFlows: [{ kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } }]
      });
      // The lead's turn: load its worker, as a worker flow's turn does, then run the tool.
      const loadWorker = handler({
        name: "lead-load-worker",
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
          block: sequencer({ name: "lead-update-own", inputSchema: z.record(z.unknown()) }).step(loadWorker).step(updateWorkstreamTool)
        }
      };
    }
  });
  const lab = (user: string) => h.openSession(user, "lab");
  // A shared project with alice and bob; mallory is in the org, not a member.
  await h.ok("alice", "lab", await lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
  return { ...h, lab };
}

type Host = Awaited<ReturnType<typeof boot>>;

/** `user` hires `lead` on the lead flow, and opens `id` in `project` with it. */
async function open(h: Host, user: string, id: string, lead: string, project = apollo, extra: Record<string, unknown> = {}) {
  await h.hire(user, lead, "lead");
  return h.ok(user, "lab", await h.lab(user), "openWorkstream", { project, id, title: `${user}'s ${id}`, lead, ...extra });
}

const entriesOf = async (h: Host, user = "alice", input: Record<string, unknown> = {}) =>
  (await h.ok(user, "lab", await h.lab(user), "readAll", input)) as Array<{ path: string; state: any; report: string | null }>;

describe("opening a workstream", () => {
  it("makes the member's own entry and the lead's workstream session, theirs, linked at create, and names it on the entry (BR-7)", async () => {
    const h = await boot();
    const out = await open(h, "alice", "checkout", "alice-lead", apollo, { due: "2026-11-01", objectives: ["Ship guest checkout"] });
    expect(out.opened).toBe(true);
    expect(out.workstream).toMatchObject({
      project: apollo,
      id: "checkout",
      owner: "alice",
      lead: "alice-lead",
      status: "on-track",
      due: "2026-11-01",
      objectives: [{ text: "Ship guest checkout", met: false, metAt: null, metBy: null }],
      writtenBy: { userId: "alice" }
    });

    const [entry] = await entriesOf(h);
    expect(entry!.path).toBe("workstreams/apollo/~alice/checkout");
    const sessionId = entry!.state.sessionId as string;
    expect(sessionId).toBe(out.workstream.sessionId);
    const session = await h.sessionRecord(sessionId);
    expect(session).toMatchObject({ userId: "alice", flowKind: "lead" });
    expect(session!.state).toMatchObject({ workerId: "alice-lead", workstreamId: "shared/apollo/checkout" });
    expect(await h.sessionsWith("workstreamId", "shared/apollo/checkout")).toHaveLength(1);
  });

  it("refuses a non-member, writing nothing (BR-8)", async () => {
    const h = await boot();
    await h.hire("mallory", "mallory-lead", "lead");
    const refused = await h.act("mallory", "lab", await h.lab("mallory"), "openWorkstream", {
      project: apollo,
      id: "checkout",
      title: "Checkout",
      lead: "mallory-lead"
    });
    expect(refused.settled).not.toBe("completed");
    expect(refusal(refused)).toContain("not-a-member");
    expect(await entriesOf(h)).toEqual([]);
    expect(await h.sessionsWith("workstreamId", "shared/apollo/checkout")).toEqual([]);
  });

  it("opens one on the owner's private project in her user scope, which nobody else reads (BR-9)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "notes", title: "Notes", visibility: "private" });
    const out = await open(h, "alice", "drafts", "alice-lead", notes);
    expect(out.workstream).toMatchObject({ project: notes, owner: "alice", lead: "alice-lead" });
    expect((await entriesOf(h, "alice", { visibility: "private", project: "notes" })).map((e) => e.path)).toEqual([
      "workstreams/notes/~alice/drafts"
    ]);
    expect(await entriesOf(h, "bob", { visibility: "private", project: "notes" })).toEqual([]);
    expect(await entriesOf(h, "bob", { project: "notes" })).toEqual([]);
    const session = await h.sessionRecord(out.workstream.sessionId);
    expect(session!.state).toMatchObject({ workerId: "alice-lead", workstreamId: "private/notes/drafts" });

    // Bob's private address reaches only his own scope, where there is no "notes".
    await h.hire("bob", "bob-lead", "lead");
    const bobs = await h.act("bob", "lab", await h.lab("bob"), "openWorkstream", {
      project: notes,
      id: "drafts",
      title: "Mine",
      lead: "bob-lead"
    });
    expect(refusal(bobs)).toContain("no-such-project");
  });

  it("refuses a lead that is another user's worker, no worker, or one whose flow can't lead, writing nothing (BR-10)", async () => {
    const h = await boot();
    await h.hire("bob", "bob-lead", "lead");
    await h.hire("alice", "alice-quiet", "quiet");
    const lab = await h.lab("alice");
    const attempt = (lead: string) => h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "checkout", title: "Checkout", lead });

    const bobs = await attempt("bob-lead");
    expect(refusal(bobs)).toContain("no-such-worker");
    expect(refusal(bobs)).toContain('No worker \\"bob-lead\\" on your roster');
    expect(refusal(await attempt("nobody"))).toContain("no-such-worker");
    expect(refusal(await attempt("alice-quiet"))).toContain("cannot-lead");
    expect(await entriesOf(h)).toEqual([]);
  });

  it("starts each lead's workstream session on the flow that lead runs on, with two lead flows", async () => {
    const h = await boot();
    const onFirst = await open(h, "alice", "checkout", "alice-lead");
    await h.hire("alice", "alice-lead2", "lead2");
    const onSecond = await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: apollo,
      id: "search",
      title: "Search",
      lead: "alice-lead2"
    });
    expect(await h.sessionRecord(onFirst.workstream.sessionId)).toMatchObject({ flowKind: "lead" });
    const second = await h.sessionRecord(onSecond.workstream.sessionId);
    expect(second).toMatchObject({ flowKind: "lead2", userId: "alice" });
    expect(second!.state).toMatchObject({ workerId: "alice-lead2", workstreamId: "shared/apollo/search" });
  });

  it("refuses a workstream id that is not one path segment (BR-15)", async () => {
    const h = await boot();
    await h.hire("alice", "alice-lead", "lead");
    const lab = await h.lab("alice");
    const slash = await h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "a/b", title: "x", lead: "alice-lead" });
    expect(refusal(slash)).toContain("invalid-workstream-id");
    const empty = await h.act("alice", "lab", lab, "openWorkstream", { project: apollo, id: "", title: "x", lead: "alice-lead" });
    expect(empty.settled).not.toBe("completed");
    expect(await entriesOf(h)).toEqual([]);
  });

  it("leaves one entry and one session when the owner opens one workstream twice at once, from one session and from two (BR-14)", async () => {
    const h = await boot();
    await h.hire("alice", "alice-lead", "lead");
    const lab = await h.lab("alice");
    const send = (session: string, id: string) =>
      h.ok("alice", "lab", session, "openWorkstream", { project: apollo, id, title: id, lead: "alice-lead" });

    const same = await Promise.all([send(lab, "checkout"), send(lab, "checkout")]);
    const other = await h.lab("alice");
    const apart = await Promise.all([send(lab, "search"), send(other, "search")]);

    for (const [pair, id] of [[same, "checkout"], [apart, "search"]] as const) {
      expect(pair.filter((out: any) => out.opened)).toHaveLength(1);
      expect(new Set(pair.map((out: any) => out.workstream.sessionId)).size).toBe(1);
      const sessions = await h.sessionsWith("workstreamId", `shared/apollo/${id}`);
      expect(sessions.map((s) => s.id)).toEqual([pair[0].workstream.sessionId]);
    }
    expect((await entriesOf(h)).map((e) => e.path)).toEqual(["workstreams/apollo/~alice/checkout", "workstreams/apollo/~alice/search"]);
  });

  it("hands an open workstream back when it is opened again, and refuses another lead for it", async () => {
    const h = await boot();
    const first = await open(h, "alice", "checkout", "alice-lead");
    const again = await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: apollo,
      id: "checkout",
      title: "Checkout, again",
      lead: "alice-lead"
    });
    expect(again).toMatchObject({ opened: false, workstream: { title: first.workstream.title, sessionId: first.workstream.sessionId } });

    await h.hire("alice", "alice-other", "lead");
    const other = await h.act("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: apollo,
      id: "checkout",
      title: "Checkout",
      lead: "alice-other"
    });
    expect(refusal(other)).toContain("lead-differs");
  });

  it("hands out only the session the entry names, when an open that stalled past the wait left a second one", async () => {
    const h = await boot();
    await h.hire("alice", "alice-lead", "lead");
    const address = { project: apollo, id: "checkout" };
    const ref = workstreamRef(address);
    // The first open, from one conversation, made the entry and stalled before naming its session.
    await h.ok("alice", "lab", await h.lab("alice"), "plantStalledOpen", { id: "checkout", lead: "alice-lead" });
    // Its session comes into being while the entry names none, so it passes the create check.
    const stalled = await h.openSession("alice", "lead", { workerId: "alice-lead", workstreamId: ref });
    // The second open, from another conversation, waits out the stall and names its own.
    const second = (await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: apollo,
      id: "checkout",
      title: "Checkout",
      lead: "alice-lead"
    })) as any;
    const named = second.workstream.sessionId as string;
    expect(named).not.toBe(stalled);
    // The stalled session is the most recent: it took a turn after the entry named the other.
    await h.ok("alice", "lead", stalled, "run", { message: "still here" });
    expect((await h.sessionsWith("workstreamId", ref)).map((s) => s.id).sort()).toEqual([named, stalled].sort());

    const client = createWorkforceClient({ userId: "alice", fetcher: h.fetcherFor("alice") });
    expect((await client.findWorkerSession({ worker: "alice-lead", workstreamId: address }))?.id).toBe(named);
    expect((await client.ensureWorkerSession({ worker: "alice-lead", workstreamId: address })).id).toBe(named);
  });

  it("hands out no session for a workstream whose entry names none yet, and starts none", async () => {
    const h = await boot();
    await h.hire("alice", "alice-lead", "lead");
    const address = { project: apollo, id: "checkout" };
    await h.ok("alice", "lab", await h.lab("alice"), "plantStalledOpen", { id: "checkout", lead: "alice-lead" });
    const stray = await h.openSession("alice", "lead", { workerId: "alice-lead", workstreamId: workstreamRef(address) });

    const client = createWorkforceClient({ userId: "alice", fetcher: h.fetcherFor("alice") });
    expect(await client.findWorkerSession({ worker: "alice-lead", workstreamId: address })).toBeUndefined();
    await expect(client.ensureWorkerSession({ worker: "alice-lead", workstreamId: address })).rejects.toThrow(
      /no lead session yet.*openWorkstream/
    );
    // A workstream that isn't there at all gets the same answer, and nothing is created for either.
    await expect(
      client.ensureWorkerSession({ worker: "alice-lead", workstreamId: { project: apollo, id: "nowhere" } })
    ).rejects.toThrow(/no lead session yet/);
    expect((await h.sessionsWith("workstreamId", workstreamRef(address))).map((s) => s.id)).toEqual([stray]);
    expect(await h.sessionsWith("workstreamId", "shared/apollo/nowhere")).toEqual([]);
  });

  it("refuses a workstream session created by hand that its entry doesn't name, and finds the real one by its workstream", async () => {
    const h = await boot();
    const out = await open(h, "alice", "checkout", "alice-lead");
    const ref = workstreamRef({ project: apollo, id: "checkout" });

    // A second session for an open workstream, a lead it doesn't have, and a workstream that isn't there.
    const second = await h.tryOpenSession("alice", "lead", { workerId: "alice-lead", workstreamId: ref });
    expect(second.status).toBe(403);
    expect(JSON.stringify(second.json)).toContain("already has its lead's session");
    await h.hire("alice", "alice-other", "lead");
    expect((await h.tryOpenSession("alice", "lead", { workerId: "alice-other", workstreamId: ref })).status).toBe(403);
    expect((await h.tryOpenSession("alice", "lead", { workerId: "alice-lead", workstreamId: "shared/apollo/none" })).status).toBe(404);
    // Bob's own worker naming Alice's workstream reads Bob's own entry, which isn't there.
    await h.hire("bob", "bob-lead", "lead");
    expect((await h.tryOpenSession("bob", "lead", { workerId: "bob-lead", workstreamId: ref })).status).toBe(404);

    const client = createWorkforceClient({ userId: "alice", fetcher: h.fetcherFor("alice") });
    const found = await client.findWorkerSession({ worker: "alice-lead", workstreamId: { project: apollo, id: "checkout" } });
    expect(found?.id).toBe(out.workstream.sessionId);
    // A lookup that doesn't name the workstream never returns its session.
    expect(await client.findWorkerSession({ worker: "alice-lead" })).toBeUndefined();
  });
});

describe("who writes an entry", () => {
  it("refuses another user's write by every path, naming the owner rule, and changes nothing (BR-11)", async () => {
    const h = await boot();
    await open(h, "alice", "checkout", "alice-lead");
    await h.ok("alice", "lab", await h.lab("alice"), "updateWorkstream", { project: apollo, id: "checkout", report: "ALICE-REPORT" });
    const before = await entriesOf(h);

    // Flow code writing the collection, registered and run as bob.
    const forced = await h.ok("bob", "lab", await h.lab("bob"), "forceWrite", { owner: "alice", id: "checkout" });
    for (const outcome of Object.values(forced)) {
      expect(outcome).toContain("refused: A row of an owner-writes collection is written only by the user it belongs to.");
    }
    // The app's action, naming her entry: the store refuses it by the same rule.
    const action = await h.act("bob", "lab", await h.lab("bob"), "updateWorkstream", {
      project: apollo,
      owner: "alice",
      id: "checkout",
      status: "blocked",
      report: "BOB-REPORT"
    });
    expect(action.settled).not.toBe("completed");
    expect(refusal(action)).toContain("A row of an owner-writes collection is written only by the user it belongs to.");
    // Left to the caller, the action addresses bob's own entry, which he doesn't have.
    const his = await h.act("bob", "lab", await h.lab("bob"), "updateWorkstream", { project: apollo, id: "checkout", status: "blocked" });
    expect(refusal(his)).toContain("no-such-workstream");
    // The lead's tool writes the workstream its own session leads: bob's, never hers.
    await open(h, "bob", "search", "bob-lead");
    const bobSession = (await entriesOf(h)).find((e) => e.path.includes("~bob"))!.state.sessionId as string;
    await h.ok("bob", "lead", bobSession, "updateOwn", { status: "blocked" });

    const after = await entriesOf(h);
    expect(after.find((e) => e.path.includes("~alice"))).toEqual(before[0]);
    expect(after.find((e) => e.path.includes("~bob"))!.state.status).toBe("blocked");

    // The same flow code, run as the owner, lands: the refusal is the owner rule, not the flow.
    const own = await h.ok("alice", "lab", await h.lab("alice"), "forceWrite", { owner: "alice", id: "checkout" });
    expect(own.update).toBe("landed");
  });

  it("lands the lead's update from its workstream session as the owner, naming the lead, with the server's time (BR-16, BR-16a)", async () => {
    const h = await boot();
    const out = await open(h, "alice", "checkout", "alice-lead", apollo, { objectives: ["Ship guest checkout", "Pass review"] });
    const opened = out.workstream.updatedAt as string;
    await new Promise((r) => setTimeout(r, 5));

    const updated = await h.ok("alice", "lead", out.workstream.sessionId, "updateOwn", {
      status: "at-risk",
      objectives: [
        { text: "Ship guest checkout", met: true },
        { text: "Pass review", met: false }
      ],
      report: "Payments sandbox is down."
    });
    expect(updated.workstream).toMatchObject({
      status: "at-risk",
      writtenBy: { userId: "alice", workerId: "alice-lead" },
      objectives: [
        { text: "Ship guest checkout", met: true, metBy: { userId: "alice", workerId: "alice-lead" } },
        { text: "Pass review", met: false, metAt: null, metBy: null }
      ]
    });
    expect(updated.workstream.updatedAt > opened).toBe(true);
    const metAt = updated.workstream.objectives[0].metAt as string;
    expect(metAt).toBe(updated.workstream.updatedAt);

    // The owner's own write from the app names her alone, and keeps when the objective was met.
    const mine = await h.ok("alice", "lab", await h.lab("alice"), "updateWorkstream", {
      project: apollo,
      id: "checkout",
      objectives: [
        { text: "Ship guest checkout", met: true },
        { text: "Pass review", met: true }
      ]
    });
    expect(mine.workstream.writtenBy).toEqual({ userId: "alice" });
    expect(mine.workstream.objectives[0]).toMatchObject({ metAt, metBy: { userId: "alice", workerId: "alice-lead" } });
    expect(mine.workstream.objectives[1]).toMatchObject({ met: true, metBy: { userId: "alice" } });
    const [entry] = await entriesOf(h);
    expect(entry!.report).toBe("Payments sandbox is down.");
  });

  it("refuses the lead's tool on a session that leads no workstream", async () => {
    const h = await boot();
    await h.hire("alice", "alice-lead", "lead");
    const plain = await h.openSession("alice", "lead", { workerId: "alice-lead" });
    const refused = await h.act("alice", "lead", plain, "updateOwn", { status: "blocked" });
    expect(refusal(refused)).toContain("not-a-workstream-session");
  });

  it("keeps a done workstream listed, as done (BR-17)", async () => {
    const h = await boot();
    await open(h, "alice", "checkout", "alice-lead");
    await h.ok("alice", "lab", await h.lab("alice"), "updateWorkstream", { project: apollo, id: "checkout", status: "done" });
    expect((await entriesOf(h)).map((e) => [e.path, e.state.status])).toEqual([["workstreams/apollo/~alice/checkout", "done"]]);
  });
});

describe("who reads an entry", () => {
  it("serves another user every entry of a shared project from the browser, report included, but never the owner's workstream session (BR-12)", async () => {
    const h = await boot();
    const out = await open(h, "alice", "checkout", "alice-lead", apollo, { due: "2026-11-01", objectives: ["Ship"] });
    await h.ok("alice", "lab", await h.lab("alice"), "updateWorkstream", { project: apollo, id: "checkout", report: "ALICE-REPORT" });

    const bobLab = await h.lab("bob");
    const [item] = await h.listed("bob", bobLab, WORKSTREAMS_RESOURCE);
    expect(item!.key).toBe("workstreams/apollo/~alice/checkout");
    expect(item!.data).toMatchObject({ title: "alice's checkout", lead: "alice-lead", status: "on-track", due: "2026-11-01" });
    const content = await h.call("GET", "bob", ["sessions", bobLab, "resources", WORKSTREAMS_RESOURCE, ...item!.key.split("/"), "content"]);
    expect(JSON.stringify(content.json)).toContain("ALICE-REPORT");

    const session = await h.call("GET", "bob", ["sessions", out.workstream.sessionId]);
    expect(session.status).toBeGreaterThanOrEqual(400);
    const run = await h.call("POST", "bob", ["lead", out.workstream.sessionId, "actions", "run"], { userId: "bob", input: { message: "hi" } });
    expect(run.status).toBeGreaterThanOrEqual(400);
  });
});

describe("the startup fence", () => {
  it("refuses an app whose flow declares a collection that reaches the entries, naming both (BR-13)", async () => {
    const installation = createWorkerInstallation({ standardWorkers: [], workerFlows: () => ({}) as never });
    const sneaky = defineResourceCollection({ pattern: "workstreams/*/*/*", scope: "org", stateSchema: z.object({}).passthrough() });
    const reads = handler({ name: "sneak", inputSchema: z.object({}), outputSchema: z.object({}), resources: { sneaky }, execute: () => ({}) });
    const blocks = defineWorkstreamBlocks({ installation, leadFlows: [] });
    const { createFlowState, inMemoryStores } = await import("@flow-state-dev/engine");
    for (const order of [
      { first: blocks.actions, second: { sneak: { block: reads } } },
      { first: { sneak: { block: reads } }, second: blocks.actions }
    ]) {
      const one = defineFlow({ kind: "one", actions: order.first } as never);
      const two = defineFlow({ kind: "two", actions: order.second } as never);
      const boot = async () => {
        const state = createFlowState({ flows: { one: one(), two: two() } as never, stores: { default: { primary: inMemoryStores() } } } as never);
        await state.getRouter();
      };
      await expect(boot()).rejects.toThrow(/workstreams\/\*\/\*\/\*.*workstreams\/\[project\]\/\[owner\]\/\[workstream\]/s);
    }
  });
});

describe("the organization", () => {
  it("serves the org's entries to its own users only", async () => {
    const h = await boot();
    await open(h, "alice", "checkout", "alice-lead");
    const elsewhere = await h.openSession("bob", "lab", undefined, "beta");
    expect(await h.listed("bob", elsewhere, WORKSTREAMS_RESOURCE, "beta")).toEqual([]);
    expect((await h.listed("bob", await h.lab("bob"), WORKSTREAMS_RESOURCE, ORG)).length).toBe(1);
  });
});
