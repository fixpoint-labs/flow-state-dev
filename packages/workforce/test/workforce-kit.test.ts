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
import { createFlowState, createInProcessFetch, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
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
function helperFlow(installation: WorkerInstallation, flowName = "helper") {
  const door = handler({
    name: "helper-door",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ reply: z.string() }),
    execute: () => ({ reply: "ok" }),
  });
  return defineFlow({
    kind: flowName,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { block: door, userMessage: (input: { message: string }) => input.message } },
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: flowName, hears: "task-sessions" }) } },
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

  it("serves the app's generated agent flow in place of the built-in one", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD, "flows/workers/agent.ts": "export {};" });
    // The generated module's `agent`: a flow of the app's own under the built-in's name.
    const generated = { workerFlows: { agent: workerFlow((installation) => helperFlow(installation, "agent")) } };
    const state = track(createFlowState({ kits: [workforce({ directory, generated })], stores }));
    await state.ready();
    const { registry } = await state.getRuntime();
    const agent = registry.get("agent") as unknown as { actions: Record<string, { block: { name: string } }> };
    expect(agent.actions.respond?.block.name).toBe("helper-door");
  });

  it("installs the generated resource modules: a resource a worker is granted, and a capability its flow uses", async () => {
    const directory = tree({
      "teams/core/workers/lead/WORKER.md":
        "---\nname: Lead\ndescription: Answers the user.\nresources:\n  - teams/core/notes\ncapabilities:\n  probe: []\n---\nYou are Lead.",
      "teams/core/resources/notes.ts": "export {};",
      "teams/core/resources/probe.ts": "export {};",
    });
    const notes = defineResource({ scope: "user", stateSchema: z.object({ text: z.string().default("") }) });
    const probe = defineCapability({
      name: "probe",
      resources: { probeCount: defineResource({ scope: "user", stateSchema: z.object({ n: z.number().default(0) }) }) },
    });
    const generated = { resourceModules: { "teams/core/notes": notes, "teams/core/probe": probe } };
    const state = track(createFlowState({ kits: [workforce({ directory, generated } as never)], stores }));
    await state.ready();
    const { registry } = await state.getRuntime();
    const agent = registry.get("agent") as unknown as { resources?: Record<string, unknown> };
    expect(Object.keys(agent.resources ?? {})).toEqual(expect.arrayContaining(["teams/core/notes", "probeCount"]));
  });

  it("refuses a generated module with a map it doesn't know, at construction", () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD });
    // `workerFlow` for `workerFlows`: a misspelled map would otherwise be dropped in silence.
    expect(() => workforce({ directory, generated: { workerFlow: {} } as never })).toThrow(/generated/);
    expect(() => workforce({ directory, generated: { blocks: "nope" } as never })).toThrow(/generated/);
  });
  it("declares the app's session fields on the agent and coordinator sessions: written on the server, read by the client, never seeded", async () => {
    const directory = tree({
      "teams/core/workers/lead/WORKER.md": LEAD,
      "teams/core/workers/desk/WORKER.md": "---\nname: Desk\ndescription: Routes.\nflow: coordinator\ndelegates: [core.lead]\n---\nYou route.",
    });
    const state = track(
      createFlowState({
        kits: [workforce({ directory, coordinator: { routeModel: "openai/gpt-6-luna" }, sessionFields: { repositoryId: z.string().min(1).optional() } })],
        stores,
        resolvePrincipal: (context: any) => {
          const user = context.request?.headers.get("x-user");
          return typeof user === "string" ? { userId: user, orgId: "org" } : null;
        },
      } as never),
    );
    await state.ready();
    const inProcess = createInProcessFetch(state);
    const alice = createClient({
      userId: "alice",
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", "alice");
        return inProcess(input, { ...init, headers });
      },
    });
    for (const [flow, workerId] of [["agent", "core.lead"], ["coordinator", "core.desk"]] as const) {
      // A caller can't name the field: the create is refused, naming it (BP-031).
      const seeded = await alice.flow(flow).createSession({ state: { workerId, repositoryId: "forged" } }).then(
        () => "created",
        (error: { status: number; body: unknown }) => ({ status: error.status, body: JSON.stringify(error.body) }),
      );
      expect(seeded).toMatchObject({ status: 400, body: expect.stringContaining("repositoryId") });
      // The server writes it, and the client reads it in the session's client data.
      const session = await alice.flow(flow).createSession({ state: { workerId } });
      const store = (await state.getRuntime()).stores.session;
      const stored = (await store.get(session.id))!;
      await store.set(session.id, { ...stored, version: stored.version + 1, state: { ...stored.state, repositoryId: "repo-1" } }, stored.version);
      expect((await alice.sessions.state(session.id)).clientData).toMatchObject({ session: { repositoryId: "repo-1" } });
    }
  });
  it("refuses a session field named like one workforce keeps on the session, naming it", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD });
    const state = track(createFlowState({ kits: [workforce({ directory, sessionFields: { workProjectId: z.string().optional() } })], stores }));
    await expect(state.ready()).rejects.toThrow(/session field "workProjectId" is one workforce keeps/);
  });
  it("refuses session fields declared on `agent` or `coordinator`: the kit's `sessionFields` is the one place, and would overwrite them", async () => {
    const directory = tree({ "teams/core/workers/lead/WORKER.md": LEAD });
    const nested = { sessionFields: { repositoryId: z.string().optional() } } as never;
    for (const config of [{ agent: nested }, { coordinator: { routeModel: "openai/gpt-6-luna", ...(nested as object) } as never }]) {
      const state = track(createFlowState({ kits: [workforce({ directory, ...config, sessionFields: { region: z.string().optional() } })], stores }));
      await expect(state.ready()).rejects.toThrow(/`(agent|coordinator)\.sessionFields` is not read.*`sessionFields`/);
    }
  });
});
