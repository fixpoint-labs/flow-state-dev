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
