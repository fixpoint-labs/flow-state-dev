/**
 * The project tools any worker flow can carry in its catalog: the project
 * writes and list under the names a `tools:` line spells, the writes that
 * name a repository waiting on the user, and `setWorkProject`, the
 * work-project action's own block as a tool. What the writes do is the
 * project blocks' own suites'; the approvals are run in the Shift
 * Coordinator's suite, which uses these same tools.
 */
import { describe, expect, it } from "vitest";
import { defineProjectBlocks, projectTools, setWorkProjectInputSchema, setWorkProjectTool } from "../src";
import { forCodingOf } from "../src/projects/project-tools";

describe("projectTools", () => {
  it("names each tool for its key, so a `tools:` line reaches it", () => {
    const tools = projectTools(defineProjectBlocks());
    expect(Object.keys(tools).sort()).toEqual(["createProject", "listProjects", "setBrief", "setRepository"]);
    for (const [key, tool] of Object.entries(tools)) expect(tool.name).toBe(key);
  });

  it("waits for the user before a repository write, and adds what to do with a coder's task to the list", () => {
    const tools = projectTools(defineProjectBlocks());
    expect(tools.createProject.kind).toBe("sequencer");
    expect(tools.setRepository.kind).toBe("sequencer");
    expect(tools.listProjects.outputSchema.safeParse({ projects: [], forCoding: "x" }).success).toBe(true);
    expect(tools.listProjects.outputSchema.safeParse({ projects: [] }).success).toBe(false);
    // A project's MCP servers are set on its page, never by a worker.
    expect(tools.createProject.inputSchema.safeParse({ id: "relay", title: "Relay", mcpServers: [] }).success).toBe(false);
  });

  it("setWorkProject is the work-project action's block, as a tool", () => {
    expect(setWorkProjectTool.name).toBe("setWorkProject");
    expect(setWorkProjectTool.inputSchema).toBe(setWorkProjectInputSchema);
  });
});

describe("forCodingOf", () => {
  const project = (id: string, repository: string | null) => ({ visibility: "shared" as const, id, title: id.toUpperCase(), repository });

  // Two projects on one repository reach the same code: asking which one is a
  // question the user can't usefully answer (FSD and Shift Manager both point
  // at the framework's repository), so the turn is told to file, and say which.
  it("files without asking when every project with a repository shares one", () => {
    const line = forCodingOf({ projects: [project("fsd", "git@x:fsd.git"), project("shift-manager", "git@x:fsd.git"), project("notes", null)] });
    expect(line).toMatch(/share one repository/);
    expect(line).toMatch(/don't ask/);
    expect(line).not.toMatch(/File nothing/);
  });

  it("still asks, naming each, when the repositories differ", () => {
    const line = forCodingOf({ projects: [project("fsd", "git@x:fsd.git"), project("billing", "git@x:billing.git")] });
    expect(line).toMatch(/File nothing/);
    expect(line).toContain("FSD");
    expect(line).toContain("BILLING");
  });

  it("files for the one project with a repository, and asks when none has one", () => {
    expect(forCodingOf({ projects: [project("fsd", "git@x:fsd.git"), project("notes", null)] })).toMatch(/One project has a repository: FSD/);
    expect(forCodingOf({ projects: [project("notes", null)] })).toMatch(/No project has a repository/);
  });
});
