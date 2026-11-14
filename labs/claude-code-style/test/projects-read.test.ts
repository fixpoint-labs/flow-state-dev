// FIX-2624.
/**
 * The project picker finds or makes no session: the repository check is the
 * projects flow's view, the projects you may work in are a direct read by
 * scope, and a new project is a send to the projects collection, run by the
 * projects flow in your write session. Against the lab's own host, in
 * process, with every request recorded.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { scriptedModels } from "../../test-support/contract";
import { openLab } from "../host.mts";
import { createWiredLab } from "../src/adapter";
import { PROJECTS_FLOW } from "../flows/projects.mts";

const cleanups: Array<() => Promise<void> | void> = [];

/** A committed git repository at `dir` that ignores a run's question files, as a project's must. */
function makeRepository(dir: string): string {
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env });
  return dir;
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the project picker", () => {
  it("asks the projects flow's view, with no session found or made", async () => {
    const data = mkdtempSync(join(tmpdir(), "claude-code-style-projects-"));
    cleanups.push(() => rmSync(data, { recursive: true, force: true }));
    const { flowState } = await openLab({
      data,
      userId: "u_lab",
      model: "test/scripted",
      utilityModel: "test/utility",
      repositories: [],
      modelResolver: scriptedModels({}) as never,
    });
    cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
    const inProcess = createInProcessFetch(flowState as never) as unknown as typeof fetch;
    const asked: string[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${decodeURIComponent(String(input))}`);
      return inProcess(input, init);
    }) as typeof fetch;
    const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
    const lab = createWiredLab(client, { fetcher });

    expect(await lab.checkRepository(join(data, "not-listed"))).toMatchObject({ usable: false });
    expect(asked.filter((line) => /\/sessions\b|\/actions\//.test(line))).toEqual([]);
    expect(await client.sessions.list({ userId: "u_lab" })).toEqual([]);
  });

  it("makes a project and lists it with no session of yours found or made", async () => {
    const data = mkdtempSync(join(tmpdir(), "claude-code-style-projects-"));
    cleanups.push(() => rmSync(data, { recursive: true, force: true }));
    const repository = makeRepository(join(data, "repo"));
    const { flowState } = await openLab({
      data,
      userId: "u_lab",
      model: "test/scripted",
      utilityModel: "test/utility",
      repositories: [repository],
      modelResolver: scriptedModels({}) as never,
    });
    cleanups.push(async () => (flowState as unknown as { dispose?: () => Promise<void> }).dispose?.());
    const inProcess = createInProcessFetch(flowState as never) as unknown as typeof fetch;
    const asked: string[] = [];
    const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${decodeURIComponent(String(input))}`);
      return inProcess(input, init);
    }) as typeof fetch;
    const client = createClient({ userId: "u_lab", baseUrl: "", fetcher });
    const lab = createWiredLab(client, { fetcher });

    const made = await lab.createProject("Acme Web", `file://${repository}`);
    expect(made).toEqual({ id: "private/acme-web", name: "Acme Web" });
    expect(await lab.listProjects()).toEqual([made]);
    // Made again under the same id: refused, naming the project there.
    await expect(lab.createProject("Acme web!", `file://${repository}`)).rejects.toThrow(/already uses the id "acme-web"/);
    // No session was listed, opened or sent to; the create ran in the server's write session.
    expect(asked.filter((line) => /\/sessions\b/.test(line) || (/\/actions\//.test(line) && !line.includes("/api/flows/resources/")))).toEqual([]);
    expect(await client.sessions.list({ userId: "u_lab" })).toEqual([]);
    const runtime = await (flowState as unknown as { getRuntime(): Promise<{ stores: { request: { list(q: object): Promise<Array<{ actionName: string; flowKind: string; sessionId?: string }>> } } }> }).getRuntime();
    const creates = (await runtime.stores.request.list({})).filter((record) => record.actionName === "createProject");
    expect(creates.map((record) => record.flowKind)).toEqual([PROJECTS_FLOW, PROJECTS_FLOW]);
    expect(creates.every((record) => record.sessionId?.startsWith("fsd-write.") === true)).toBe(true);
  });
});
