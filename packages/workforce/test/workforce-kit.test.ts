/**
 * Workforce as a kit: an app lists `workforce({ … })` in `kits` and gets every
 * worker its folder declares, the roster flow and the built-in agent flow,
 * with no host wiring. Every file in the folder is used or refused: a file
 * workforce doesn't read stops the app starting, named.
 *
 * Graded on what the running app serves (its flow keys, the roster view's
 * answer), never on what the kit's install returns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineCapability, defineFlow, defineKit, defineResource, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { z } from "zod";
import { messageReceivedEntry, workerMessagesResources } from "../src/messages";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { workforce } from "../src/kit";
import { workerFlow } from "../src/workers/worker-flow";

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stores = { default: { primary: inMemoryStores() } };

/** A workforce folder holding `files`, by path relative to it. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fsd-workforce-kit-"));
  dirs.push(dir);
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

const LEAD = "---\nname: Lead\ndescription: Answers the user.\n---\nYou are Lead.";

/** The least a worker flow is: a door, the worker's configuration, the installation's session, and an ear for messages. */
function helperFlow(installation: WorkerInstallation) {
  const door = handler({
    name: "helper-door",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ reply: z.string() }),
    execute: () => ({ reply: "ok" }),
  });
  return defineFlow({
    kind: "helper",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { block: door, userMessage: (input: { message: string }) => input.message } },
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "helper", hears: "task-sessions" }) } },
  } as never);
}

function track(state: FlowState): FlowState {
  states.push(state);
  return state;
}

describe("workforce as a kit", () => {
  it("serves the agent and roster flows for the workers its folder declares", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD });
    const state = track(createFlowState({ kits: [workforce({ directory })], stores }));
    await state.ready();
    expect([...state.meta.flowKeys].sort()).toEqual(["agent", "workforce-roster"]);
  });

  it("refuses to start beside a file workforce doesn't read, naming each", async () => {
    const directory = tree({
      "teams/core/workers/lead/WORKER.md": LEAD,
      "notes.txt": "a note",
      // A worker flow is read, so the folder beside it is walked and the helper named on its own.
      "flows/workers/coder.mts": "export {};",
      "flows/helper.mts": "export {};",
      "teams/core/notes.md": "a note",
      "flows/workers/nested/deep.ts": "export {};",
    });
    const state = track(createFlowState({ kits: [workforce({ directory })], stores }));
    const refused = await state.ready().then(
      () => "started",
      (error: Error) => error.message,
    );
    for (const stray of ["notes.txt", "flows/helper.mts", "teams/core/notes.md", "flows/workers/nested"]) {
      expect(refused).toContain(`"${stray}"`);
    }
    expect(refused).not.toContain("WORKER.md");
    expect(refused).not.toContain("coder.mts");
  });

  it("refuses to start when a worker file doesn't load, naming it", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": "---\nname: [unclosed\n---\nYou are Lead." });
    const state = track(createFlowState({ kits: [workforce({ directory })], stores }));
    const refused = await state.ready().then(
      () => "started",
      (error: Error) => error.message,
    );
    expect(refused).toContain("teams/core/workers/lead");
  });

  it("serves a worker flow another kit puts in its workerFlows slot, built on the installation", async () => {
    const directory = tree({
      "teams/core/workers/lead/WORKER.md": LEAD,
      "teams/core/workers/helper/WORKER.md": "---\nname: Helper\ndescription: Helps.\nflow: helper\n---\nYou help.",
    });
    const probe = defineCapability({
      name: "probe",
      resources: { probe: defineResource({ scope: "user", stateSchema: z.object({ n: z.number().default(0) }) }) },
    });
    const helping = defineKit({
      name: "helping",
      requires: [workforce],
      contributes: () => ({
        [workforce.slots.workerFlows]: {
          helper: workerFlow(helperFlow),
        },
        [workforce.slots.uses]: [probe],
      }),
      install: () => ({ flows: [] }),
    });
    const state = track(createFlowState({ kits: [helping(), workforce({ directory })], stores }));
    await state.ready();
    expect([...state.meta.flowKeys].sort()).toEqual(["agent", "helper", "workforce-roster"]);
    const { registry } = await state.getRuntime();
    const agent = registry.get("agent") as unknown as { resources?: Record<string, unknown> };
    expect(Object.keys(agent.resources ?? {})).toContain("probe");
  });

  it("serves the flows an app builds on the installation through its flows slot", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD });
    let seen: WorkerInstallation | undefined;
    const state = track(
      createFlowState({
        kits: [workforce({ directory })],
        fill: {
          [workforce.slots.flows]: {
            // A flow that isn't a worker flow, built on the installation: its resources are the installation's.
            projects: (installation: WorkerInstallation) => {
              seen = installation;
              return [defineFlow({ kind: "projects", resources: { ...installation.resources }, actions: {} } as never)() as never];
            },
          },
        },
        stores,
      }),
    );
    await state.ready();
    expect([...state.meta.flowKeys].sort()).toEqual(["agent", "projects", "workforce-roster"]);
    // The builder got the installation the kit hired: the one whose standard worker is Lead.
    expect(seen?.standardWorkers().map((worker) => worker.id)).toEqual(["core.lead"]);
  });
});
