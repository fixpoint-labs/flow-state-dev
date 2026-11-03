/**
 * A project's MCP servers: the names its coding runs get, set when it is
 * created and with `setMcpServers`, over the real engine and HTTP router.
 *
 * The host offers `linear` and `github`. A project names some of them by
 * name; anything else, or anything that isn't a bare name, is refused and
 * nothing is written. The row holds names only.
 */
import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { z } from "zod";
import { defineProjectBlocks, mcpCredentialsCapability, projectRowSchema } from "../src/index";
import { bootProjectsHost, ORG, refusal } from "./projects-harness";

const OFFERED = ["linear", "github"];
const apollo = { visibility: "shared" as const, id: "apollo" };

/** A host offering `offered`, with alice's `apollo` (bob a member) when `seed` is set. */
async function boot(offered: readonly string[] = OFFERED) {
  const h = await bootProjectsHost({ lab: () => defineProjectBlocks({ mcpServers: offered }).actions });
  const lab = (user: string) => h.openSession(user, "lab");
  const row = async (id: string) => {
    const stored = await h.runtime.stores.resourceState.get("org", ORG, `projects/${id}`);
    return stored === undefined ? undefined : (stored.state as Record<string, unknown>);
  };
  return { ...h, lab, row };
}

describe("naming a project's MCP servers", () => {
  it("stores the names a project is created with, once each, and none when it names none (BR-1, BR-7)", async () => {
    const h = await boot();
    const named = await h.ok("alice", "lab", await h.lab("alice"), "createProject", {
      id: "apollo",
      title: "Apollo",
      mcpServers: ["linear", "github", "linear"]
    });
    const bare = await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "sandbox", title: "Sandbox" });
    expect(named.project.mcpServers).toEqual(["linear", "github"]);
    expect((await h.row("apollo"))!.mcpServers).toEqual(["linear", "github"]);
    expect(bare.project.mcpServers).toEqual([]);
  });

  it("replaces the whole list for a member, [] turning them off, and changes nothing else on the row (BR-4)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"], mcpServers: ["linear"] });
    const before = (await h.row("apollo"))!;
    const bob = await h.lab("bob");
    const set = await h.ok("bob", "lab", bob, "setMcpServers", { project: apollo, mcpServers: ["github"] });
    expect(set.project).toEqual({ ...before, mcpServers: ["github"] });
    expect(await h.row("apollo")).toEqual({ ...before, mcpServers: ["github"] });
    await h.ok("bob", "lab", bob, "setMcpServers", { project: apollo, mcpServers: [] });
    expect(await h.row("apollo")).toEqual({ ...before, mcpServers: [] });
  });

  it("refuses a name the host doesn't offer, naming what it offers, and writes nothing (BR-2)", async () => {
    const h = await boot();
    const lab = await h.lab("alice");
    const create = await h.act("alice", "lab", lab, "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear", "jira"] });
    expect(create.settled).not.toBe("completed");
    expect(refusal(create)).toContain("unknown-mcp-server");
    expect(refusal(create)).toContain('\\"jira\\" is not an MCP server this host offers: it offers \\"linear\\", \\"github\\"');
    expect(await h.row("apollo")).toBeUndefined();

    await h.ok("alice", "lab", lab, "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear"] });
    const set = await h.act("alice", "lab", lab, "setMcpServers", { project: apollo, mcpServers: ["jira"] });
    expect(refusal(set)).toContain("unknown-mcp-server");
    expect((await h.row("apollo"))!.mcpServers).toEqual(["linear"]);
  });

  it("refuses every name on a host that offers none, saying so", async () => {
    const h = await boot([]);
    const create = await h.act("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear"] });
    expect(refusal(create)).toContain("unknown-mcp-server");
    expect(refusal(create)).toContain("this host offers no MCP servers");
    // Naming none is still a project.
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", mcpServers: [] });
  });

  it("refuses a value that isn't a bare name, without repeating it (BR-3)", async () => {
    const h = await boot();
    const lab = await h.lab("alice");
    await h.ok("alice", "lab", lab, "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear"] });
    const values = [
      "https://mcp.linear.app/mcp?token=sk-live-SENTINEL",
      { url: "https://mcp.linear.app/mcp" },
      "$LINEAR_MCP_API_KEY",
      "Linear",
      "linear app",
      "lin_api_SENTINELSENTINEL"
    ];
    for (const value of values) {
      const set = await h.act("alice", "lab", lab, "setMcpServers", { project: apollo, mcpServers: [value] });
      expect(refusal(set), JSON.stringify(value)).toContain("invalid-mcp-server");
      expect(refusal(set)).not.toContain("SENTINEL");
      expect(refusal(set)).not.toContain("mcp.linear.app");
    }
    expect((await h.row("apollo"))!.mcpServers).toEqual(["linear"]);
  });

  it("refuses a non-member, as setRepository does (BR-5)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear"] });
    const outsider = await h.act("mallory", "lab", await h.lab("mallory"), "setMcpServers", { project: apollo, mcpServers: [] });
    expect(outsider.settled).not.toBe("completed");
    expect(refusal(outsider)).toContain("not-a-member");
    expect((await h.row("apollo"))!.mcpServers).toEqual(["linear"]);
  });
});

describe("a project row read by a client", () => {
  it("shows the names and nothing else of a server: no address, variable or key (BR-26)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", mcpServers: ["linear"] });
    const [item] = await h.listed("mallory", await h.lab("mallory"), "projects");
    expect(item!.data.mcpServers).toEqual(["linear"]);
    expect(JSON.stringify(item)).not.toMatch(/https?:|seedEnv|Bearer|_KEY/);
  });

  it("names no servers on a row stored before the field existed, and takes a list without a migration (BR-6)", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "seed", title: "Seed" });
    const legacy: Record<string, unknown> = { ...(await h.row("seed"))!, id: "old", title: "Old" };
    delete legacy.mcpServers;
    expect((await h.runtime.stores.resourceState.set("org", ORG, "projects/old", legacy as never, "absent")).ok).toBe(true);
    expect(Object.keys((await h.row("old"))!)).not.toContain("mcpServers");

    expect(projectRowSchema.parse(await h.row("old")).mcpServers).toEqual([]);
    const [item] = (await h.listed("alice", await h.lab("alice"), "projects")).filter((i) => i.data.id === "old");
    expect(item!.data.mcpServers ?? []).toEqual([]);
    const set = await h.ok("alice", "lab", await h.lab("alice"), "setMcpServers", { project: { visibility: "shared", id: "old" }, mcpServers: ["linear"] });
    expect(set.project).toMatchObject({ id: "old", title: "Old", mcpServers: ["linear"] });
  });
});

describe("a user's keys read by a client", () => {
  it("show when each was set, never the value (BR-9)", async () => {
    const holder = handler({
      name: "holds-keys",
      inputSchema: z.object({}),
      uses: [mcpCredentialsCapability],
      execute: async () => "held"
    });
    const h = await bootProjectsHost({ lab: () => ({ ...defineProjectBlocks().actions, holdKeys: { block: holder } }) });
    const cell = resolveUserStorageKey("alice", ORG, { id: "", isolateUserState: false });
    await h.runtime.stores.resourceState.set("user", cell, "mcp-credentials/linear", { value: "lin_api_SENTINEL", setAt: "2026-10-13T00:00:00.000Z" }, "any");
    const items = await h.listed("alice", await h.openSession("alice", "lab"), "mcpCredentials");
    expect(items).toEqual([{ key: "mcp-credentials/linear", data: { setAt: "2026-10-13T00:00:00.000Z" } }]);
    expect(JSON.stringify(items)).not.toContain("SENTINEL");
    // Another user's read lists none of alice's.
    expect(await h.listed("bob", await h.openSession("bob", "lab"), "mcpCredentials")).toEqual([]);
  });
});

describe("naming a project's checks", () => {
  it("stores the commands a project is created with, and none when it names none", async () => {
    const h = await boot();
    const named = await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", checks: [" pnpm typecheck "] });
    const bare = await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "sandbox", title: "Sandbox" });
    expect(named.project.checks).toEqual(["pnpm typecheck"]);
    expect(bare.project.checks).toEqual([]);
  });

  it("replaces the whole list for a member, and changes nothing else on the row", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo", members: ["bob"], checks: ["pnpm test"] });
    const before = (await h.row("apollo"))!;
    const set = await h.ok("bob", "lab", await h.lab("bob"), "setChecks", { project: apollo, checks: ["pnpm typecheck", "pnpm test"] });
    expect(set.project).toEqual({ ...before, checks: ["pnpm typecheck", "pnpm test"] });
  });

  it("refuses a command a shell would read as more than one, and writes nothing", async () => {
    const h = await boot();
    const lab = await h.lab("alice");
    const create = await h.act("alice", "lab", lab, "createProject", { id: "apollo", title: "Apollo", checks: ["pnpm i && pnpm test"] });
    expect(refusal(create)).toContain("invalid-check");
    expect(await h.row("apollo")).toBeUndefined();

    await h.ok("alice", "lab", lab, "createProject", { id: "apollo", title: "Apollo", checks: ["pnpm test"] });
    const set = await h.act("alice", "lab", lab, "setChecks", { project: apollo, checks: ["pnpm test | tee log"] });
    expect(refusal(set)).toContain("invalid-check");
    expect((await h.row("apollo"))!.checks).toEqual(["pnpm test"]);
  });

  it("refuses a non-member's change", async () => {
    const h = await boot();
    await h.ok("alice", "lab", await h.lab("alice"), "createProject", { id: "apollo", title: "Apollo" });
    const set = await h.act("carol", "lab", await h.lab("carol"), "setChecks", { project: apollo, checks: ["pnpm test"] });
    expect(refusal(set)).toContain("not-a-member");
  });
});
