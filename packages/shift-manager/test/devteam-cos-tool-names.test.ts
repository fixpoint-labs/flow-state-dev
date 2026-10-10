/**
 * The chief of staff's rename-only tools are the Workforce blocks themselves,
 * shown to the model under the names its `tools:` line spells. The model must
 * read the same name and description it always has; what changed is that no
 * wrapper sits between the tool and the write.
 */
import { describe, expect, it } from "vitest";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  defineProjectBlocks,
  defineWorkstreamBlocks,
  WORKSTREAM_OPENED_ENTRY,
} from "@flow-state-dev/workforce";
import { chiefOfStaffProjectTools, chiefOfStaffRosterTools } from "../teams/devteam/host.mts";

/** The project tools over an installation with no workers, and one lead flow. */
function projectTools() {
  const installation = createWorkerInstallation({ standardWorkers: [], workerFlows: () => ({}) });
  const blocks = defineProjectBlocks();
  const lead = { kind: "agent", internal: { actions: { [WORKSTREAM_OPENED_ENTRY]: {} } } };
  const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [lead] });
  return { blocks, workstreams, tools: chiefOfStaffProjectTools(blocks, workstreams) };
}

describe("chief of staff tools presented with .as()", () => {
  it("setWorkstreams is the project block under the tool's own name", () => {
    const { blocks, tools } = projectTools();
    const tool = tools.setWorkstreams;
    expect(tool.name).toBe("setWorkstreams");
    expect(tool.description).toMatch(/^Replace a project's workstreams with this list of full mailbox ids\./);
    // No wrapper: the tool is the Workforce block, with its own kind and schemas.
    expect(tool.kind).toBe(blocks.setWorkstreams.kind);
    expect(tool.kind).not.toBe("sequencer");
    expect(tool.inputSchema).toBe(blocks.setWorkstreams.inputSchema);
  });

  it("hire is the Workforce hire block under the tool's own name", () => {
    const installation = createWorkerInstallation({ standardWorkers: [], workerFlows: () => ({}) });
    const tool = chiefOfStaffRosterTools(installation).hire;
    const block = createWorkerHireBlocks(installation).hire;
    expect(tool.name).toBe("hire");
    expect(tool.description).toMatch(/^Hire a worker of the person's own: `id` is a short lowercase slug/);
    expect(tool.kind).toBe(block.kind);
    expect(tool.kind).not.toBe("sequencer");
    expect(tool.inputSchema).toBe(block.inputSchema);
  });

  it("the tools that wait for an approval keep their sequencer", () => {
    const installation = createWorkerInstallation({ standardWorkers: [], workerFlows: () => ({}) });
    const project = projectTools().tools;
    expect(chiefOfStaffRosterTools(installation).fire.kind).toBe("sequencer");
    expect(project.createProject.kind).toBe("sequencer");
    expect(project.setRepository.kind).toBe("sequencer");
  });

  it("openWorkstream runs Workforce's open, by the project's address", () => {
    const { tools } = projectTools();
    const tool = tools.openWorkstream;
    expect(tool.name).toBe("openWorkstream");
    expect(tool.description).toMatch(/by the project's address \(`visibility` and `id`\)/);
    // A sequencer over the one open step, with the open's own input: the tool adds no rule of its own.
    expect(tool.kind).toBe("sequencer");
    expect(tool.inputSchema.safeParse({ project: { visibility: "private", id: "notes" }, id: "w", title: "W", lead: "x" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ project: "notes", id: "w", title: "W", lead: "x" }).success).toBe(false);
  });
});
