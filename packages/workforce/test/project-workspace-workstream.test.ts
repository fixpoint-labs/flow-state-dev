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
import { handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { localWorkspaceHost, type RunSourceAnswer } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  defineProjectBlocks,
  defineProjectFilesCollection,
  definePrivateProjectFilesCollection,
  defineWorkstreamBlocks,
  projectWorkspace,
  projectWorkspaceCapability,
  WORKSTREAM_OPENED_ENTRY,
  workstreamOpenedEntry
} from "../src/index";
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
});
