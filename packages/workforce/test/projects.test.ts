/**
 * Projects, over the real HTTP router, as three verified users in one
 * organization: `alice` and `bob` (members), and `mallory` (in the org, not a
 * member).
 *
 * Covers the row writes (`createProject`, `setRepository`, `setBrief`) and the project
 * files read. Identity comes from a verified header, never the body (BP-031).
 *
 * **Controls.** Three modules are swappable on purpose, and each swap must turn
 * this file red:
 *
 *   FSD_CONTROL=no-gate  pnpm --filter @flow-state-dev/workforce exec vitest run test/projects.test.ts
 *     The membership gate admits everyone: the outsider tests fail.
 *   FSD_CONTROL=no-retry pnpm --filter @flow-state-dev/workforce exec vitest run test/projects.test.ts
 *     The projects' own retry runs once: the repository burst loses writes.
 *   FSD_CONTROL=any-repository pnpm --filter @flow-state-dev/workforce exec vitest run test/projects.test.ts
 *     The repository check admits every value: the invalid-repository test fails.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineProjectBlocks,
  defineProjectFilesCollection,
  defineProjectsCollection,
  projectRowSchema,
} from "../src/index";

vi.mock("../src/projects/membership-gate", async (original) =>
  process.env.FSD_CONTROL === "no-gate" ? { isMember: () => true } : original()
);
vi.mock("../src/projects/repository-value", async (original) =>
  process.env.FSD_CONTROL === "any-repository" ? { repositoryProblem: () => undefined } : original()
);
vi.mock("../src/projects/cas-retry", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return process.env.FSD_CONTROL === "no-retry"
    ? { ...real, retryOnConflict: (write: () => Promise<unknown>) => write() }
    : real;
});

const ORG = "lab";

// --- The app's own flow: the project writes, plus test-only seeds and reads. ---

const projects = defineProjectsCollection();
const projectFiles = defineProjectFilesCollection();

/** Reads what a refused write must leave alone: a row. */
const inspect = handler({
  name: "inspect",
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({ row: z.unknown() }),
  resources: { projects },
  execute: async (input, ctx) => {
    const rows = ctx.resources.projects as unknown as ResourceCollectionRef;
    const row = await rows.getOptional(input.projectId);
    return { row: row === undefined ? null : { ...row.state } };
  }
});

/** Writes one project file, as a run's sync back does. */
const seedProjectFile = handler({
  name: "seed-project-file",
  inputSchema: z.object({ key: z.string(), content: z.string() }),
  outputSchema: z.object({}),
  resources: { "project-files": projectFiles },
  execute: async (input, ctx) => {
    const files = ctx.resources["project-files"] as unknown as ResourceCollectionRef;
    const ref = await files.create(input.key, { path: input.key, hash: "seeded", updatedAt: "2026-10-04T00:00:00.000Z" });
    await ref.writeContent(input.content);
    return {};
  }
});

const projectBlocks = defineProjectBlocks();
const labFlow = defineFlow({
  kind: "lab",
  actions: {
    ...projectBlocks.actions,
    seedProjectFile: { block: seedProjectFile },
    inspect: { block: inspect },
  }
});

// --- Harness ---

type Answer = { status: number; json: any };

/** Boot a host, over `primary` when given. */
async function boot(options: { primary?: ReturnType<typeof inMemoryStores> } = {}) {
  const primary = options.primary ?? inMemoryStores();
  const state = createFlowState({
    flows: { lab: labFlow },
    stores: { default: { primary } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const inProcess = createInProcessFetch(state);
  const stores: StoreRegistry = (await state.getRuntime()).stores;

  const call = async (method: "GET" | "POST", user: string, path: string[], body?: unknown, query = ""): Promise<Answer> => {
    const response = await inProcess(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const openSession = async (user: string, flow: string, initial?: unknown): Promise<string> => {
    const { status, json } = await call("POST", user, [flow, "sessions"], {
      userId: user,
      ...(initial === undefined ? {} : { state: initial })
    });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session.id;
  };

  /** Run an action and wait for it to settle: its status, output and error. */
  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) return { http: answer.status, settled: undefined, output: undefined, error: answer.json };
    for (let i = 0; i < 1000; i += 1) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      if (["completed", "errored", "failed", "cancelled"].includes(polled.json?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    return { http: answer.status, settled: found.status as string, output: found.result?.output, error: found.result?.error };
  };

  /** The output of an action that must complete. */
  const ok = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const result = await act(user, flow, sessionId, action, input);
    if (result.settled !== "completed") {
      throw new Error(`${action} as ${user}: ${result.settled} ${JSON.stringify(result.error)}`);
    }
    return result.output;
  };

  const lab = await openSession("alice", "lab");
  const inspectRow = (projectId: string) => ok("alice", "lab", lab, "inspect", { projectId }) as Promise<{ row: any }>;

  return { primary, stores, call, openSession, act, ok, inspectRow };
}

type Harness = Awaited<ReturnType<typeof boot>>;

const refusal = (result: { settled?: string; error?: unknown }) => JSON.stringify(result.error ?? "");

/** alice creates `apollo` with bob. */
async function apollo(h: Harness) {
  const aliceLab = await h.openSession("alice", "lab");
  const created = await h.ok("alice", "lab", aliceLab, "createProject", {
    id: "apollo",
    title: "Apollo",
    brief: "Ship the storefront.",
    members: ["bob"]
  });
  return { aliceLab, created };
}

describe("project rows", () => {
  it("creates an org project owned by the creator, listed by another member of the org", async () => {
    const h = await boot();
    const { created } = await apollo(h);
    expect(created.created).toBe(true);
    expect(created.project).toMatchObject({
      id: "apollo",
      ownerUserId: "alice",
      members: ["alice", "bob"],
      brief: "Ship the storefront.",
      status: "active"
    });
    // A project lists no workstreams of its own: they are entries, which name it.
    expect(created.project).not.toHaveProperty("workstreams");

    // Anyone in the org lists it through the browser read — mallory too: a
    // shared project is the organization's to read.
    const malloryLab = await h.openSession("mallory", "lab");
    const listed = await h.call("GET", "mallory", ["sessions", malloryLab, "resources", "projects"]);
    expect(listed.status).toBe(200);
    expect(listed.json.items.map((i: any) => i.clientData)).toEqual([
      expect.objectContaining({ id: "apollo", title: "Apollo", members: ["alice", "bob"] })
    ]);
  });

  it("refuses each bad write and leaves the row as it was", async () => {
    const h = await boot();
    await apollo(h);
    const before = await h.inspectRow("apollo");
    const malloryLab = await h.openSession("mallory", "lab");
    const bobLab = await h.openSession("bob", "lab");

    const held = await h.act("mallory", "lab", malloryLab, "createProject", { id: "apollo", title: "Mine now" });
    expect(held.settled).not.toBe("completed");
    expect(refusal(held)).toContain("project-id-held");

    const reserved = await h.act("bob", "lab", bobLab, "createProject", { id: "unassigned", title: "No project" });
    expect(refusal(reserved)).toContain("invalid-project-id");

    // Its files are mounted at the id, and a mount scope can't hold a backslash.
    const backslash = await h.act("bob", "lab", bobLab, "createProject", { id: "acme\\store", title: "Acme store" });
    expect(refusal(backslash)).toContain("invalid-project-id");

    expect((await h.inspectRow("hermes")).row).toBeNull();
    expect(await h.inspectRow("apollo")).toEqual(before);
  });

  it("hands a re-sent create its row back, unchanged", async () => {
    const h = await boot();
    const first = await h.ok("alice", "lab", await h.openSession("alice", "lab"), "createProject", { id: "atlas", title: "Atlas" });
    const resent = await h.ok("alice", "lab", await h.openSession("alice", "lab"), "createProject", { id: "atlas", title: "Atlas" });
    expect(resent.created).toBe(false);
    expect(resent.project).toEqual(first.project);
  });
});

describe("a project's repository", () => {
  it("records the repository a project is created with, and null when none is given", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const named = await h.ok("alice", "lab", lab, "createProject", {
      id: "storefront",
      title: "Storefront",
      repository: "https://github.com/acme/storefront.git"
    });
    const bare = await h.ok("alice", "lab", lab, "createProject", { id: "sandbox", title: "Sandbox" });
    expect(named.project.repository).toBe("https://github.com/acme/storefront.git");
    expect(bare.project.repository).toBeNull();
    expect((await h.inspectRow("storefront")).row.repository).toBe("https://github.com/acme/storefront.git");
    expect((await h.inspectRow("sandbox")).row.repository).toBeNull();

    // Anyone in the org reads it with the row, as Shift Manager's Brief does.
    const malloryLab = await h.openSession("mallory", "lab");
    const listed = await h.call("GET", "mallory", ["sessions", malloryLab, "resources", "projects"]);
    const byId = Object.fromEntries(listed.json.items.map((i: any) => [i.clientData.id, i.clientData.repository]));
    expect(byId).toEqual({ storefront: "https://github.com/acme/storefront.git", sandbox: null });
  });

  it("lets a member set, change and clear it, and moves nothing else on the row", async () => {
    const h = await boot();
    await apollo(h);
    const before = (await h.inspectRow("apollo")).row;
    const bobLab = await h.openSession("bob", "lab");
    const without = ({ repository, ...rest }: Record<string, unknown>) => rest;

    for (const repository of ["https://github.com/acme/storefront.git", "git@github.com:acme/shop.git", null]) {
      const out = await h.ok("bob", "lab", bobLab, "setRepository", { project: { visibility: "shared", id: "apollo" }, repository });
      expect(out.project.repository).toBe(repository);
      const row = (await h.inspectRow("apollo")).row;
      expect(row.repository).toBe(repository);
      expect(without(row)).toEqual(without(before));
    }
  });

  // Each refused value is refused by both writes, and its refusal never repeats
  // the value: a credential in it would otherwise reach logs and the request record.
  const REFUSED_REPOSITORIES: Array<[string, string]> = [
    ["an absolute path", "/srv/git/storefront"],
    ["a relative path", "./storefront"],
    ["a parent path", "../storefront"],
    ["a home path", "~/code/storefront"],
    ["a bare name", "storefront"],
    ["a Windows path", "C:\\code\\storefront"],
    ["a Windows path with forward slashes", "C:/code/storefront"],
    ["an empty value", ""],
    ["a leading dash", "--upload-pack=touch /tmp/pwned"],
    ["a leading dash, short", "-oProxyCommand=touch"],
    ["leading whitespace hiding a dash", " -oProxyCommand=touch"],
    ["an ssh host that is an option", "ssh://-oProxyCommand=touch/x/y"],
    ["a remote helper", "ext::sh -c touch% /tmp/pwned"],
    ["a user and password on https", "https://alice:hunter2@github.com/acme/storefront.git"],
    ["a token as the https user", "https://ghp_tokenvalue@github.com/acme/storefront.git"],
    ["a user on http", "http://alice@git.internal/acme/storefront.git"],
    ["a password on ssh", "ssh://git:hunter2@github.com/acme/storefront.git"],
    ["a password in the scp form", "git:hunter2@github.com:acme/storefront.git"],
    ["a control character", "https://github.com/acme/store\nfront.git"]
  ];
  const ACCEPTED_REPOSITORIES = [
    "https://github.com/acme/storefront.git",
    "https://github.com/acme/storefront",
    "git@github.com:acme/storefront.git",
    "ssh://git@github.com/acme/storefront.git",
    "ssh://github.com:2222/acme/storefront.git",
    "file:///srv/git/storefront.git"
  ];

  it("refuses a bare path, a leading dash and a credential as invalid-repository, without repeating the value", async () => {
    const h = await boot();
    await apollo(h);
    const before = (await h.inspectRow("apollo")).row;
    const lab = await h.openSession("alice", "lab");
    for (const [what, repository] of REFUSED_REPOSITORIES) {
      const set = await h.act("alice", "lab", lab, "setRepository", { project: { visibility: "shared", id: "apollo" }, repository });
      const create = await h.act("alice", "lab", lab, "createProject", { id: "fresh", title: "Fresh", repository });
      for (const result of [set, create]) {
        expect(result.settled, what).not.toBe("completed");
        expect(refusal(result), what).toContain("invalid-repository");
        for (const secret of ["hunter2", "ghp_tokenvalue"]) expect(refusal(result), what).not.toContain(secret);
      }
    }
    expect((await h.inspectRow("apollo")).row).toEqual(before);
    expect((await h.inspectRow("fresh")).row).toBeNull();
  });

  it("accepts both SSH spellings, https, a custom port and file://, on create and on set", async () => {
    const h = await boot();
    await apollo(h);
    const lab = await h.openSession("alice", "lab");
    for (const [i, repository] of ACCEPTED_REPOSITORIES.entries()) {
      const set = await h.ok("alice", "lab", lab, "setRepository", { project: { visibility: "shared", id: "apollo" }, repository });
      expect(set.project.repository).toBe(repository);
      const created = await h.ok("alice", "lab", lab, "createProject", { id: `p${i}`, title: "P", repository });
      expect(created.project.repository).toBe(repository);
    }
  });

  it("reads a row written before the field existed as a project with no repository, and sets one on it", async () => {
    const h = await boot();
    // Learn where a row is stored by watching one be written.
    const states = h.stores.resourceState;
    const set = states.set.bind(states);
    let where: { scopeType: Parameters<typeof set>[0]; scopeId: string; key: string } | undefined;
    states.set = async (scopeType, scopeId, key, state, expected) => {
      if (where === undefined && /(^|\/)projects\/seed$/.test(key)) where = { scopeType, scopeId, key };
      return set(scopeType, scopeId, key, state, expected);
    };
    await h.ok("alice", "lab", await h.openSession("alice", "lab"), "createProject", { id: "seed", title: "Seed" });
    states.set = set;
    expect(where).toBeDefined();

    // The stored shape of a row from before `repository`: the key is absent.
    const { scopeType, scopeId, key } = where!;
    const legacy: Record<string, unknown> = { ...(await states.get(scopeType, scopeId, key))!.state, id: "old", title: "Old" };
    delete legacy.repository;
    const oldKey = key.replace(/seed$/, "old");
    expect((await set(scopeType, scopeId, oldKey, legacy as never, "absent")).ok).toBe(true);
    expect(Object.keys((await states.get(scopeType, scopeId, oldKey))!.state)).not.toContain("repository");

    // Stored state is not re-parsed on read, so a reader parses the row (or
    // guards with `== null`, as a browser reader does), and either way it is a
    // project with no repository.
    expect(projectRowSchema.parse((await h.inspectRow("old")).row).repository).toBeNull();
    const malloryLab = await h.openSession("mallory", "lab");
    const listed = await h.call("GET", "mallory", ["sessions", malloryLab, "resources", "projects"]);
    expect(listed.json.items.find((i: any) => i.clientData.id === "old").clientData.repository ?? null).toBeNull();
    const lab = await h.openSession("alice", "lab");
    const resent = await h.ok("alice", "lab", lab, "createProject", { id: "old", title: "Old" });
    expect(resent).toMatchObject({ created: false, project: { id: "old", repository: null } });

    const written = await h.ok("alice", "lab", lab, "setRepository", { project: { visibility: "shared", id: "old" }, repository: "git@github.com:acme/old.git" });
    expect(written.project).toMatchObject({ id: "old", title: "Old", ownerUserId: "alice", repository: "git@github.com:acme/old.git" });
  });

  it("keeps one value whole, and lands every write, when a burst of members set it at once", async () => {
    const h = await boot();
    const lab = await h.openSession("alice", "lab");
    const people = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "heidi"];
    await h.ok("alice", "lab", lab, "createProject", { id: "race", title: "Race", members: people.slice(1) });
    const values = people.map((user) => `https://github.com/acme/${user}.git`);
    const labs = await Promise.all(people.map((user) => h.openSession(user, "lab")));
    // Each member sets its own value three times, all at once, so every write
    // contends with the rest on the one row.
    const outcomes = await Promise.all(
      people.flatMap((user, i) =>
        [0, 1, 2].map(() =>
          h.act(user, "lab", labs[i]!, "setRepository", { project: { visibility: "shared", id: "race" }, repository: values[i] })
        )
      )
    );
    expect(outcomes.filter((o) => o.settled !== "completed").map(refusal)).toEqual([]);
    const row = (await h.inspectRow("race")).row;
    expect(values).toContain(row.repository);
    expect(row.members).toEqual(people);
  });

  it("refuses a non-member and an unknown project, and writes nothing", async () => {
    const h = await boot();
    await apollo(h);
    const before = (await h.inspectRow("apollo")).row;
    const malloryLab = await h.openSession("mallory", "lab");
    const outsider = await h.act("mallory", "lab", malloryLab, "setRepository", {
      project: { visibility: "shared", id: "apollo" },
      repository: "https://github.com/mallory/evil.git"
    });
    expect(outsider.settled).not.toBe("completed");
    expect(refusal(outsider)).toContain("not-a-member");
    const nowhere = await h.act("mallory", "lab", malloryLab, "setRepository", { project: { visibility: "shared", id: "nope" }, repository: null });
    expect(refusal(nowhere)).toContain("no-such-project");
    expect((await h.inspectRow("apollo")).row).toEqual(before);
    expect((await h.inspectRow("nope")).row).toBeNull();
  });
});

describe("a project's brief", () => {
  it("lets a member set, change and clear it, and changes nothing else on the row", async () => {
    const h = await boot();
    await apollo(h);
    const before = (await h.inspectRow("apollo")).row;
    const bobLab = await h.openSession("bob", "lab");
    const set = await h.ok("bob", "lab", bobLab, "setBrief", { project: { visibility: "shared", id: "apollo" }, brief: "Ship guest checkout." });
    expect(set.project).toEqual({ ...before, brief: "Ship guest checkout." });
    expect((await h.inspectRow("apollo")).row).toEqual({ ...before, brief: "Ship guest checkout." });
    const cleared = await h.ok("bob", "lab", bobLab, "setBrief", { project: { visibility: "shared", id: "apollo" }, brief: null });
    expect(cleared.project.brief).toBeNull();
  });

  it("refuses a non-member, an unknown project, and a call naming none from a conversation linked to none", async () => {
    const h = await boot();
    await apollo(h);
    const before = (await h.inspectRow("apollo")).row;
    const malloryLab = await h.openSession("mallory", "lab");
    const outsider = await h.act("mallory", "lab", malloryLab, "setBrief", { project: { visibility: "shared", id: "apollo" }, brief: "Mine now." });
    expect(refusal(outsider)).toContain("not-a-member");
    const nowhere = await h.act("mallory", "lab", malloryLab, "setBrief", { project: { visibility: "shared", id: "nope" }, brief: "x" });
    expect(refusal(nowhere)).toContain("no-such-project");
    const aliceLab = await h.openSession("alice", "lab");
    for (const action of ["setBrief", "setRepository"]) {
      const unnamed = await h.act("alice", "lab", aliceLab, action, action === "setBrief" ? { brief: "x" } : { repository: null });
      expect(refusal(unnamed), action).toContain("no-such-project");
    }
    expect((await h.inspectRow("apollo")).row).toEqual(before);
  });
});

describe("a project's files", () => {
  it("is declared org-scoped, shared across flows, lazy, and with no browser read", () => {
    expect(projectFiles).toMatchObject({ pattern: "project-files/**", scope: "org", flowIsolation: false, prefetchMode: "lazy" });
    expect((projectFiles as { client?: unknown }).client).toBeUndefined();
    expect(defineProjectFilesCollection()).toBe(projectFiles);
  });

  it("hands a member the files under the project's id, and no other project's", async () => {
    const h = await boot();
    await apollo(h);
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "createProject", { id: "apollo2", title: "Apollo 2" });
    await h.ok("alice", "lab", lab, "seedProjectFile", { key: "apollo/notes.md", content: "# Notes" });
    await h.ok("alice", "lab", lab, "seedProjectFile", { key: "apollo/src/index.ts", content: "export {};" });
    // A project whose id starts with the other's: a bare prefix match would leak it.
    await h.ok("alice", "lab", lab, "seedProjectFile", { key: "apollo2/plan.md", content: "not apollo's" });

    const bobLab = await h.openSession("bob", "lab");
    const read = await h.ok("bob", "lab", bobLab, "readProjectFiles", { project: { visibility: "shared", id: "apollo" } });
    // Path and UTF-8 byte size only: the output is logged as the tool result, so a body never rides in it.
    expect([...read.files].sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path))).toEqual([
      { path: "notes.md", size: 7 },
      { path: "src/index.ts", size: 10 }
    ]);
    expect(JSON.stringify(read)).not.toContain("# Notes");
    expect((await h.ok("alice", "lab", lab, "readProjectFiles", { project: { visibility: "shared", id: "apollo2" } })).files).toEqual([
      { path: "plan.md", size: 12 }
    ]);
  });

  it("counts a file's size in UTF-8 bytes, not characters", async () => {
    const h = await boot();
    await apollo(h);
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "seedProjectFile", { key: "apollo/café.md", content: "café" });
    expect((await h.ok("alice", "lab", lab, "readProjectFiles", { project: { visibility: "shared", id: "apollo" } })).files).toEqual([
      { path: "café.md", size: 5 }
    ]);
  });

  it("refuses a non-member, an unknown project, and a browser read of the collection", async () => {
    const h = await boot();
    await apollo(h);
    const lab = await h.openSession("alice", "lab");
    await h.ok("alice", "lab", lab, "seedProjectFile", { key: "apollo/notes.md", content: "secret plan" });

    const malloryLab = await h.openSession("mallory", "lab");
    const outsider = await h.act("mallory", "lab", malloryLab, "readProjectFiles", { project: { visibility: "shared", id: "apollo" } });
    expect(outsider.settled).not.toBe("completed");
    expect(refusal(outsider)).toContain("not-a-member");
    expect(refusal(outsider)).not.toContain("secret plan");
    expect(refusal(await h.act("mallory", "lab", malloryLab, "readProjectFiles", { project: { visibility: "shared", id: "nope" } }))).toContain(
      "no-such-project"
    );
    expect((await h.call("GET", "mallory", ["sessions", malloryLab, "resources", "project-files"])).status).toBe(403);
    expect((await h.call("GET", "alice", ["sessions", lab, "resources", "project-files"])).status).toBe(403);
  });
});
