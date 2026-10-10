/**
 * `projectWorkspace()` for a run that works for a workstream (FIX-1793 BR-33,
 * BR-34), on the real engine: the run's session is the lead's workstream
 * session, and the source finds the project from the workstream it leads, by
 * the session's readonly `workstreamId`, then the owner's entry, then the row
 * at the project's visibility. Files come from that visibility's scope.
 *
 * The mailbox-board path (claims) keeps its own tests in
 * `project-workspace.test.ts`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { localWorkspaceHost, type RunSourceAnswer } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  defineProjectBlocks,
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  defineSessionBoard,
  defineWorkstreamBlocks,
  projectWorkspace,
  projectWorkspaceCapability,
  WORKER_TASK_ENTRY,
  workerConfigSchema,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import type { WorkerInstallation } from "../src/workers/installation";
import { bootProjectsHost } from "./projects-harness";

const root = mkdtempSync(join(tmpdir(), "project-workspace-workstream-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const host = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: projectWorkspace() });

/** A plain view of an answer: the collection ref does not cross the action boundary. */
function view(answer: RunSourceAnswer) {
  if (answer.kind === "refused") return answer;
  if (answer.kind === "files") return { kind: answer.kind, projectId: answer.projectId };
  return { kind: answer.kind, repo: answer.repo, projectId: answer.projectId };
}

/**
 * Ask the source from the session this runs in, as the run's owner. With
 * `runAs`, the run's owner is someone else than the session's: what a run
 * started for the workstream by another user would be.
 */
const askSource = handler({
  name: "ask-source",
  inputSchema: z.object({ provision: z.string().optional(), runAs: z.string().optional() }),
  outputSchema: z.unknown(),
  uses: [projectWorkspaceCapability],
  execute: async (input, ctx) => {
    const asked =
      input.runAs === undefined
        ? ctx
        : new Proxy(ctx, {
            get: (target, prop, receiver) =>
              prop === "user" ? { identity: { userId: input.runAs } } : Reflect.get(target, prop, receiver)
          });
    const answer = await projectWorkspace()(asked as never);
    if (input.provision === undefined || answer.kind === "refused") return { answer: view(answer) };
    const made = await host.provision(answer, { place: [input.provision] });
    const files = readdirSync(made.cwd).sort();
    return { answer: view(answer), files, plan: files.includes("plan.md") ? readFileSync(join(made.cwd, "plan.md"), "utf8") : null };
  }
});

/** Writes one of the caller's project files at a visibility, as a run's save does. */
const seedFile = handler({
  name: "seed-file",
  inputSchema: z.object({ visibility: z.enum(["shared", "private"]), key: z.string(), content: z.string() }),
  outputSchema: z.object({}),
  resources: { shared: defineProjectFilesCollection(), mine: definePrivateProjectFilesCollection() },
  execute: async (input, ctx) => {
    const files = ctx.resources[input.visibility === "private" ? "mine" : "shared"] as unknown as ResourceCollectionRef;
    const ref = await files.create(input.key, { path: input.key, hash: null, updatedAt: null });
    await ref.writeContent(input.content);
    return {};
  }
});

async function boot() {
  const projects = defineProjectBlocks();
  const leadFlow = { kind: "lead", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const h = await bootProjectsHost({
    lab: (installation) => ({
      ...projects.actions,
      ...defineWorkstreamBlocks({ installation, leadFlows: [leadFlow] }).actions,
      seedFile: { block: seedFile },
      askSource: { block: askSource }
    }),
    lead: () => ({ askSource: { block: askSource } }),
    leadInternal: () => ({ [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() })
  });
  const lab = (user: string) => h.openSession(user, "lab");
  /** `user` opens workstream `id` in `project`, and returns its lead's session. */
  const openWorkstream = async (user: string, project: { visibility: "shared" | "private"; id: string }, id: string) => {
    await h.hire(user, `${user}-${id}`, "lead");
    const out = (await h.ok(user, "lab", await lab(user), "openWorkstream", { project, id, title: id, lead: `${user}-${id}` })) as any;
    return out.workstream.sessionId as string;
  };
  return { ...h, lab, openWorkstream };
}

describe("projectWorkspace for a workstream", () => {
  it("answers a shared project's repository from the workstream the run's session leads (BR-33)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", {
      id: "storefront",
      title: "Storefront",
      repository: "https://github.com/acme/storefront.git"
    });
    const session = await h.openWorkstream("alice", { visibility: "shared", id: "storefront" }, "checkout");
    const asked = (await h.ok("alice", "lead", session, "askSource", {})) as any;
    expect(asked.answer).toEqual({ kind: "repo", repo: "https://github.com/acme/storefront.git", projectId: "storefront" });
  });

  it("answers a private project with its owner's files, and never the org's files under the same id (BR-33)", async () => {
    const h = await boot();
    const aliceLab = await h.lab("alice");
    await h.ok("alice", "lab", aliceLab, "createProject", { id: "apollo", title: "Mine", visibility: "private" });
    await h.ok("bob", "lab", await h.lab("bob"), "createProject", { id: "apollo", title: "The org's", repository: "git@github.com:acme/apollo.git" });
    await h.ok("alice", "lab", aliceLab, "seedFile", { visibility: "private", key: "apollo/plan.md", content: "alice's private plan" });
    await h.ok("bob", "lab", await h.lab("bob"), "seedFile", { visibility: "shared", key: "apollo/plan.md", content: "the org's plan" });

    const session = await h.openWorkstream("alice", { visibility: "private", id: "apollo" }, "drafts");
    const asked = (await h.ok("alice", "lead", session, "askSource", { provision: "alice-run" })) as any;
    expect(asked.answer).toEqual({ kind: "files", projectId: "apollo" });
    expect(asked.plan).toBe("alice's private plan");
  });

  it("refuses a run whose owner is not the workstream's owner, naming both (BR-34)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "storefront", title: "Storefront", members: ["bob"] });
    const session = await h.openWorkstream("alice", { visibility: "shared", id: "storefront" }, "checkout");
    const asked = (await h.ok("alice", "lead", session, "askSource", { runAs: "bob" })) as any;
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "not-the-owner" });
    expect(asked.answer.message).toContain('"bob"');
    expect(asked.answer.message).toContain('"alice"');
  });

  it("reads only the session owner's own entry, so a session forged to name another's workstream finds none", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", {
      id: "storefront",
      title: "Storefront",
      members: ["bob"],
      repository: "https://github.com/acme/storefront.git"
    });
    await h.openWorkstream("alice", { visibility: "shared", id: "storefront" }, "checkout");
    // The lab flow checks no workstream link at create, so bob's session can carry one naming alice's.
    const forged = await h.openSession("bob", "lab", { workstreamId: "shared/storefront/checkout" });
    const asked = (await h.ok("bob", "lab", forged, "askSource", {})) as any;
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "no-such-workstream" });
    expect(asked.answer.message).toContain('"bob" has no workstream "checkout"');
  });

  it("refuses a run whose session leads no workstream and names no board", async () => {
    const h = await boot();
    const asked = (await h.ok("alice", "lab", await h.lab("alice"), "askSource", {})) as any;
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "no-project" });
  });

  it("reads only the session owner's own entry for a workstream it was filed from, too", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "storefront", title: "Storefront", members: ["bob"] });
    await h.openWorkstream("alice", { visibility: "shared", id: "storefront" }, "checkout");
    const forged = await h.openSession("bob", "lab", { filingWorkstreamId: "shared/storefront/checkout" });
    const asked = (await h.ok("bob", "lab", forged, "askSource", {})) as any;
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "no-such-workstream" });
  });
});

/**
 * A run in a task session the lead filed from its workstream session (V6's
 * walk-up leg): the lead's flow carries a session board, so its worker files
 * tasks for its delegates; the task's session is born carrying the
 * workstream it was filed from, and a run there finds the workstream's
 * project.
 */
describe("projectWorkspace for a task filed from a workstream session", () => {
  const doorInput = z.object({ message: z.string() });

  /** The lead's flow: it leads workstreams, and its workers file for their delegates. */
  function filerFlow(installation: WorkerInstallation) {
    const board = defineSessionBoard({ installation, flowKind: "filer" });
    const door = handler({
      name: "filer-run",
      inputSchema: doorInput,
      resources: { ...installation.resources },
      execute: async (_input, ctx) => (await installation.resolveWorker(ctx, "filer")).id
    });
    return defineFlow({
      kind: "filer",
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message }, ...board.actions },
      internal: { actions: { ...board.entries(door), [WORKSTREAM_OPENED_ENTRY]: workstreamOpenedEntry() } }
    } as never);
  }

  /** A delegate that takes a task: its turn asks the run source, as a coding run's would, and keeps the answer. */
  function takerFlow(installation: WorkerInstallation, answers: unknown[]) {
    const turn = handler({
      name: "taker-turn",
      inputSchema: doorInput,
      uses: [projectWorkspaceCapability],
      resources: { ...installation.resources },
      execute: async (_input, ctx) => {
        await installation.resolveWorker(ctx, "taker");
        answers.push({ state: { ...(ctx.session.state as object) }, answer: view(await projectWorkspace()(ctx as never)) });
        return "asked";
      }
    });
    return defineFlow({
      kind: "taker",
      configSchema: workerConfigSchema(),
      session: installation.session(),
      resources: { ...installation.resources },
      actions: { run: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
      task: { actions: { [WORKER_TASK_ENTRY]: workerTaskEntry({ name: "taker-task", turn }) } }
    } as never);
  }

  async function bootFiling() {
    const answers: Array<{ state: Record<string, unknown>; answer: unknown }> = [];
    const projects = defineProjectBlocks();
    const filerRef = { kind: "filer", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
    const h = await bootProjectsHost({
      lab: (installation) => ({
        ...projects.actions,
        ...defineWorkstreamBlocks({ installation, leadFlows: [filerRef] }).actions
      }),
      flows: (installation) => ({ filer: filerFlow(installation), taker: takerFlow(installation, answers) })
    });
    const lab = (user: string) => h.openSession(user, "lab");
    /** Every request done. */
    const settled = async () => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const all = await h.runtime.stores.request.list({});
        if (!all.some((request: { status: string }) => request.status === "in_progress")) return;
        if (Date.now() > deadline) throw new Error("a request never finished");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    return { ...h, lab, answers, settled };
  }

  it("answers the workstream's project to a run in a task session its lead filed (BR-33, V6)", async () => {
    const h = await bootFiling();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", {
      id: "storefront",
      title: "Storefront",
      repository: "https://github.com/acme/storefront.git"
    });
    await h.hire("alice", "alice-taker", "taker");
    const roster = await h.openSession("alice", "workforce-roster");
    await h.ok("alice", "workforce-roster", roster, "hire", { id: "alice-filer", flow: "filer", settings: { delegates: ["alice-taker"] } });
    const opened = (await h.ok("alice", "lab", await h.lab("alice"), "openWorkstream", {
      project: { visibility: "shared", id: "storefront" },
      id: "checkout",
      title: "Checkout",
      lead: "alice-filer"
    })) as any;
    const filed = (await h.ok("alice", "filer", opened.workstream.sessionId, "addTask_tasks", {
      goal: "Add guest checkout",
      assignee: "alice-taker"
    })) as any;
    expect(filed).toMatchObject({ ok: true });
    await h.settled();
    expect(h.answers).toEqual([
      {
        state: expect.objectContaining({ filingWorkstreamId: "shared/storefront/checkout", workerId: "alice-taker" }),
        answer: { kind: "repo", repo: "https://github.com/acme/storefront.git", projectId: "storefront" }
      }
    ]);
  });

  it("answers no project to a task filed from a session that works for no workstream", async () => {
    const h = await bootFiling();
    await h.hire("alice", "alice-taker", "taker");
    const roster = await h.openSession("alice", "workforce-roster");
    await h.ok("alice", "workforce-roster", roster, "hire", { id: "alice-filer", flow: "filer", settings: { delegates: ["alice-taker"] } });
    const talk = await h.openSession("alice", "filer", { workerId: "alice-filer" });
    await h.ok("alice", "filer", talk, "addTask_tasks", { goal: "Tidy up", assignee: "alice-taker" });
    await h.settled();
    expect(h.answers).toHaveLength(1);
    expect(h.answers[0]!.state).not.toHaveProperty("filingWorkstreamId");
    expect(h.answers[0]!.answer).toMatchObject({ kind: "refused", reason: "no-project" });
  });

  it("refuses a create that names the workstream a task was filed from: only the hand-over sets it", async () => {
    const h = await bootFiling();
    await h.hire("alice", "alice-taker", "taker");
    const forged = await h.tryOpenSession("alice", "taker", { workerId: "alice-taker", filingWorkstreamId: "shared/storefront/checkout" });
    expect(forged.status).toBe(400);
    expect(JSON.stringify(forged.json)).toContain("filingWorkstreamId");
  });
});
