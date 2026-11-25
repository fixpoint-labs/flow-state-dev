/**
 * The Shift Coordinator's rename-only tools are the Workforce blocks themselves,
 * shown to the model under the names its `tools:` line spells. The model must
 * read the same name and description it always has; what changed is that no
 * wrapper sits between the tool and the write.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  defineProjectBlocks,
  defineWorkstreamBlocks,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";
import { shiftCoordinatorProjectTools } from "../teams/devteam/host.mts";

/** The installation the workforce kit hires over a folder with no workers, read through its `flows` slot. */
async function emptyInstallation(): Promise<WorkerInstallation> {
  let installation: WorkerInstallation | undefined;
  const state = createFlowState({
    kits: [workforce({ directory: mkdtempSync(join(tmpdir(), "no-workers-")) })],
    // Builds no flow: the entry only keeps the installation the kit hands it.
    fill: { [workforce.slots.flows]: { read: (on: WorkerInstallation) => ((installation = on), []) } },
    stores: { test: { primary: inMemoryStores() } },
  });
  await state.ready();
  await state.dispose();
  return installation!;
}

/** The project tools over an installation with no workers, and one lead flow. */
async function projectTools() {
  const installation = await emptyInstallation();
  const blocks = defineProjectBlocks();
  const lead = { kind: "agent", internal: { actions: { onWorkstreamOpened: {} } } };
  const workstreams = defineWorkstreamBlocks({ installation, leadFlows: [lead] });
  return { blocks, workstreams, tools: shiftCoordinatorProjectTools(blocks, workstreams) };
}

describe("Shift Coordinator tools presented with .as()", () => {
  it("the project tools are createProject, setRepository, setBrief, openWorkstream and listProjects: none lists workstreams on a project entry", async () => {
    // A project's workstreams are the entries `openWorkstream` writes; there is
    // no tool that writes a list of ids onto a project entry.
    expect(Object.keys((await projectTools()).tools).sort()).toEqual(["createProject", "listProjects", "openWorkstream", "setBrief", "setRepository"]);
  });

  it("the tools that wait for an approval keep their sequencer", async () => {
    const project = (await projectTools()).tools;
    expect(project.createProject.kind).toBe("sequencer");
    expect(project.setRepository.kind).toBe("sequencer");
  });

  it("openWorkstream runs Workforce's open, by the project's address", async () => {
    const { tools } = await projectTools();
    const tool = tools.openWorkstream;
    expect(tool.name).toBe("openWorkstream");
    expect(tool.description).toMatch(/by the project's address \(`visibility` and `id`\)/);
    // A sequencer over the one open step, with the open's own input: the tool adds no rule of its own.
    expect(tool.kind).toBe("sequencer");
    expect(tool.inputSchema.safeParse({ project: { visibility: "private", id: "notes" }, id: "w", title: "W", lead: "x" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ project: "notes", id: "w", title: "W", lead: "x" }).success).toBe(false);
  });
});
