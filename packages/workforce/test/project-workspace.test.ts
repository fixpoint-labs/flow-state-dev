/**
 * `projectWorkspace({ board })`, the run source for a coding run on a project's
 * board, over the real HTTP router as three verified users in one organization:
 * `alice` and `bob` (members) and `mallory` (in the org, on no project).
 *
 * What is pinned: the source answers from the workstream's claim and the
 * project row and from nothing else; it hands a host the project's own files
 * and no other project's; and it refuses a run whose owner is not a member, or
 * whose workstream no project holds, before a single file is read.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { localWorkspaceHost, WorkspaceRefusedError, type RunSourceAnswer } from "@flow-state-dev/workspace";
import { z } from "zod";
import {
  MAILBOX_KIND,
  defineMailboxInventoryCollection,
  defineProjectBlocks,
  defineProjectFilesCollection,
  mailboxBoard,
  projectWorkspace,
  projectWorkspaceCapability
} from "../src/index";

const ORG = "lab";
const MAILBOXES = ["eng.feature", "eng.triage", "ops.release"];
const board = mailboxBoard("eng.feature", "work");

const root = mkdtempSync(join(tmpdir(), "project-workspace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const host = localWorkspaceHost({ root, remotes: { allow: ["file"] }, source: projectWorkspace({ board }) });

/** Every read the source made through `ctx.resources`, as `<accessor>.<method>(<key>)`. */
function recording(ctx: object, log: string[]): object {
  const resources = (ctx as { resources: Record<string, unknown> }).resources;
  const watched = new Proxy(resources, {
    get(target, accessor, receiver) {
      const ref = Reflect.get(target, accessor, receiver);
      if (typeof accessor !== "string" || ref === null || typeof ref !== "object") return ref;
      return new Proxy(ref as object, {
        get(inner, method, innerReceiver) {
          const value = Reflect.get(inner, method, innerReceiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            log.push(`${accessor}.${String(method)}(${args.filter((a) => typeof a === "string").join(",")})`);
            return (value as (...a: unknown[]) => unknown).apply(inner, args);
          };
        }
      });
    }
  });
  return new Proxy(ctx, { get: (target, prop, receiver) => (prop === "resources" ? watched : Reflect.get(target, prop, receiver)) });
}

/** A plain view of an answer: the collection ref does not cross the action boundary. */
function view(answer: RunSourceAnswer) {
  if (answer.kind === "refused") return answer;
  if (answer.kind === "files") return { kind: answer.kind, projectId: answer.projectId };
  return { kind: answer.kind, repo: answer.repo, projectId: answer.projectId };
}

/** Ask the source as the calling user; with `provision`, also hand its answer to the host and list what it laid down. */
const askSource = handler({
  name: "ask-source",
  inputSchema: z.object({ provision: z.string().optional() }),
  outputSchema: z.unknown(),
  uses: [projectWorkspaceCapability],
  execute: async (input, ctx) => {
    const reads: string[] = [];
    const answer = await projectWorkspace({ board })(recording(ctx, reads) as never);
    if (input.provision === undefined) return { answer: view(answer), reads };
    const place = [input.provision];
    try {
      const made = await host.provision(answer, { place });
      return { answer: view(answer), reads, files: readdirSync(made.cwd).sort() };
    } catch (error) {
      return {
        answer: view(answer),
        reads,
        refusedBy: error instanceof WorkspaceRefusedError ? error.reason : String(error),
        placeExists: existsSync(join(root, ...place))
      };
    }
  }
});

/** Writes one project file, as a run's save does. */
const seedProjectFile = handler({
  name: "seed-project-file",
  inputSchema: z.object({ key: z.string(), content: z.string() }),
  outputSchema: z.object({}),
  resources: { "project-files": defineProjectFilesCollection() },
  execute: async (input, ctx) => {
    const files = ctx.resources["project-files"] as unknown as ResourceCollectionRef;
    const ref = await files.create(input.key, { path: input.key, hash: null, updatedAt: null });
    await ref.writeContent(input.content);
    return {};
  }
});

/** The same source, on a block that does not hold its collections. */
const askWithout = handler({
  name: "ask-without",
  inputSchema: z.object({}),
  outputSchema: z.unknown(),
  execute: async (_input, ctx) => projectWorkspace({ board })(ctx as never)
});

const seedMailboxes = handler({
  name: "seed-mailboxes",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  resources: { "mailbox-inventory": defineMailboxInventoryCollection() },
  execute: async (_input, ctx) => {
    const rows = ctx.resources["mailbox-inventory"] as unknown as ResourceCollectionRef;
    for (const id of MAILBOXES) await rows.upsert(id, { id, kind: MAILBOX_KIND, members: [], openedAt: null });
    return {};
  }
});

const labFlow = defineFlow({
  kind: "lab",
  actions: {
    ...defineProjectBlocks().actions,
    askSource: { block: askSource },
    seedProjectFile: { block: seedProjectFile }
  }
});
const seederFlow = defineFlow({ kind: "seeder", actions: { seedMailboxes: { block: seedMailboxes } } });
/** A flow of its own: a capability's collections are installed flow-wide, so beside `askSource` they would be there. */
const bareFlow = defineFlow({ kind: "bare", actions: { askWithout: { block: askWithout } } });

async function boot() {
  const state = createFlowState({
    flows: { lab: labFlow, seeder: seederFlow, bare: bareFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const router = (await state.getRouter()) as any;

  const call = async (method: "GET" | "POST", user: string, path: string[], body?: unknown, query = "") => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status as number, json: text.length > 0 ? JSON.parse(text) : undefined };
  };
  const session = async (user: string, flow: string): Promise<string> => {
    const { status, json } = await call("POST", user, [flow, "sessions"], { userId: user });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session.id;
  };
  /** Run an action to completion and return its output, or throw naming how it settled. */
  const run = async (user: string, flow: string, action: string, input: unknown): Promise<any> => {
    const sessionId = await session(user, flow);
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) throw new Error(`${action}: ${JSON.stringify(answer.json)}`);
    for (let i = 0; i < 1000; i += 1) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      if (["completed", "errored", "failed", "cancelled"].includes(polled.json?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    if (found.status !== "completed") throw new Error(`${action} as ${user}: ${found.status} ${JSON.stringify(found.result?.error)}`);
    return found.result?.output;
  };

  await run("alice", "seeder", "seedMailboxes", {});
  return { run };
}

describe("projectWorkspace", () => {
  it("answers a project with no repository with its files, reading only the workstream's claim and the project's row", async () => {
    const h = await boot();
    await h.run("alice", "lab", "createProject", { id: "sandbox", title: "Sandbox", members: ["bob"], workstreams: ["eng.feature"] });
    // A project whose id starts with the other's: a bare prefix match would hand its files over.
    await h.run("alice", "lab", "createProject", { id: "sandbox2", title: "Sandbox 2" });
    await h.run("alice", "lab", "seedProjectFile", { key: "sandbox/notes/plan.md", content: "the sandbox's plan" });
    await h.run("alice", "lab", "seedProjectFile", { key: "sandbox2/secret.md", content: "not the sandbox's" });

    const asked = await h.run("bob", "lab", "askSource", {});
    expect(asked.answer).toEqual({ kind: "files", projectId: "sandbox" });
    // Where the source comes from is stored, server-written data: the claim, then the row. Nothing else.
    expect(asked.reads).toEqual(["workstream-claims.getOptional(eng.feature)", "projects.getOptional(sandbox)"]);

    const provisioned = await h.run("bob", "lab", "askSource", { provision: "bob-run" });
    expect(provisioned.files).toEqual(["notes"]);
    expect(readdirSync(join(root, "bob-run", "workspace", "notes"))).toEqual(["plan.md"]);
  });

  it("answers a project with a repository with that remote and the project's files beside it, and follows a change to it", async () => {
    const h = await boot();
    await h.run("alice", "lab", "createProject", {
      id: "storefront",
      title: "Storefront",
      workstreams: ["eng.feature"],
      repository: "https://github.com/acme/storefront.git"
    });
    expect((await h.run("alice", "lab", "askSource", {})).answer).toEqual({
      kind: "repo",
      repo: "https://github.com/acme/storefront.git",
      projectId: "storefront"
    });

    await h.run("alice", "lab", "setRepository", { project: { visibility: "shared", id: "storefront" }, repository: "git@github.com:acme/shop.git" });
    expect((await h.run("alice", "lab", "askSource", {})).answer).toMatchObject({ kind: "repo", repo: "git@github.com:acme/shop.git" });
    await h.run("alice", "lab", "setRepository", { project: { visibility: "shared", id: "storefront" }, repository: null });
    expect((await h.run("alice", "lab", "askSource", {})).answer).toEqual({ kind: "files", projectId: "storefront" });
  });

  it("refuses a run whose owner is not a member, naming the project, before any file is read or any place made", async () => {
    const h = await boot();
    await h.run("alice", "lab", "createProject", { id: "sandbox", title: "Sandbox", workstreams: ["eng.feature"] });
    await h.run("alice", "lab", "seedProjectFile", { key: "sandbox/notes.md", content: "members only" });

    const asked = await h.run("mallory", "lab", "askSource", { provision: "mallory-run" });
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "not-a-member" });
    expect(asked.answer.message).toContain('"sandbox"');
    expect(asked.reads.some((read: string) => read.startsWith("project-files"))).toBe(false);
    expect(asked.refusedBy).toBe("not-a-member");
    expect(asked.placeExists).toBe(false);
  });

  it("refuses a workstream no project holds, naming the workstream", async () => {
    const h = await boot();
    await h.run("alice", "lab", "createProject", { id: "elsewhere", title: "Elsewhere", workstreams: ["eng.triage"] });
    const asked = await h.run("alice", "lab", "askSource", { provision: "nowhere-run" });
    expect(asked.answer).toMatchObject({ kind: "refused", reason: "no-project" });
    expect(asked.answer.message).toContain('"eng.feature"');
    expect(asked.placeExists).toBe(false);
  });

  it("is refused at build for a board id that names no mailbox, and when asked on a block that does not hold its collections", async () => {
    expect(() => projectWorkspace({ board: { id: "work" } })).toThrow(/not a mailbox board's id/);
    const h = await boot();
    await expect(h.run("alice", "bare", "askWithout", {})).rejects.toThrow(/projectWorkspaceCapability/);
  });
});
