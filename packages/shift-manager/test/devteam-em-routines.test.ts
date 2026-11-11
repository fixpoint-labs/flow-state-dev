/**
 * The DevTeam's EM is a worker you talk to, so its turn offers the routine
 * tools its file names, as every other conversation worker's does.
 *
 * Alice opens a workstream with the EM as its lead and sends it a line. The
 * EM's scripted model records the tools its turn was offered, then saves a
 * clock routine with one of them; the routine is stored as the EM's.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import type { Client } from "@flow-state-dev/client";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { LIST_ROUTINES_ACTION, ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import { runAction } from "../src/lib/action";
import { connect } from "../src/lib/connection";
import { readProject, type ProjectAddress } from "../src/lib/projects";
import { createLabReader, readerSessionId } from "../src/lib/reads";
import { toRoutines } from "../src/lib/routines";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { EM_FLOW, EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const STOREFRONT: ProjectAddress = { visibility: "shared", id: "storefront" };
const ALICE = LAB_USERS.owner;
const EM = "eng.em";
const ROUTINE_TOOLS = ["listRoutines", "saveRoutine", "pauseRoutine", "deleteRoutine"];

/** The EM: notes the tools it is offered, saves one clock routine, then closes. */
function emModel(offered: string[][]): GeneratorModel {
  let step = 0;
  return {
    modelId: "test/em",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { tools?: Record<string, unknown> | Array<{ name?: string }> }) {
      const tools = options.tools ?? {};
      offered.push(Array.isArray(tools) ? tools.map((t) => String(t.name)) : Object.keys(tools));
      step += 1;
      if (step > 1) return { text: "Saved.", finishReason: "stop" };
      return {
        toolCalls: [{
          toolCallId: "em-1",
          toolName: "saveRoutine",
          args: { name: "pr-sweep", trigger: { clock: { cron: "0 9 * * 1", timezone: "UTC" } }, task: { goal: "Check the open pull requests.", assignee: EM } },
        }],
        finishReason: "tool-calls",
      };
    },
  };
}

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;

afterEach(async () => {
  await served?.handle.close();
  await lab?.dispose();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  lab = undefined;
  served = undefined;
  root = undefined;
});

describe("the EM manages its routines", () => {
  it("is offered the routine tools its file names, and a routine it saves is stored as its own", async () => {
    const offered: string[][] = [];
    const em = emModel(offered);
    const helper: GeneratorModel = {
      modelId: "test/helper",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      async generateStep() {
        return { text: "On it.", finishReason: "stop" };
      },
    };
    const resolver = Object.assign((_id: string, block?: string) => (block === EM_TURN ? em : helper), {
      resolveId: (id: string) => id,
    }) as unknown as ModelResolver;
    const remote = createBareRemote("em-routines", { seed: { "README.md": "storefront\n" } });
    root = mkdtempSync(join(tmpdir(), "sm-em-routines-"));
    lab = await openLab({
      modelResolver: resolver,
      stores: inMemoryStores(),
      harness: harnessStub({ finalMessage: "Done." }).slot,
      workspace: { root, remotes: { allow: ["file"] } },
      coderWorkerId: "eng.coder",
      inventory: true,
      projects: [{ id: STOREFRONT.id, title: "Storefront", repository: remote.url, members: [LAB_USERS.member.userId] }],
    });
    served = await serveLab(lab.state);
    const client: Client = connect({ userId: ALICE.userId, baseUrl: served.baseUrl, bearerToken: ALICE.bearer });
    await createLabReader(client).read();
    const reader = readerSessionId(ALICE.userId, "projects");
    await runAction(client, "projects", reader, "openWorkstream", { project: STOREFRONT, id: "feature", title: "Feature", lead: EM });
    const workstream = (await readProject(client, reader, STOREFRONT))!.entries.find((e) => e.owner === ALICE.userId && e.id === "feature")!.sessionId!;

    await runAction(client, EM_FLOW, workstream, "respond", { message: "Every Monday at 9, check the open pull requests." });

    expect(offered[0], "the tools the EM's turn was offered").toEqual(expect.arrayContaining(ROUTINE_TOOLS));
    // Alice's routines, as her roster lists them: the EM's clock routine, made by the EM.
    const roster = (await client.flow(ROSTER_FLOW).createSession({})).id;
    const listed = toRoutines((await runAction(client, ROSTER_FLOW, roster, LIST_ROUTINES_ACTION, {})).output);
    expect(listed.find((r) => r.name === "pr-sweep")?.madeBy).toEqual({ by: "worker", worker: EM });
  }, 60_000);
});
