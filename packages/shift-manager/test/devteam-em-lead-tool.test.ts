/**
 * The EM is offered the lead's `updateWorkstream` only on a session that leads
 * a workstream. Its file names the tool, but on any other session the write
 * refuses (`not-a-workstream-session`): offered there, the model calls it and
 * the trace shows a refused call for nothing. The refusal stays as the safety
 * check; the turn just isn't handed the tool.
 *
 * Alice opens a workstream with the EM as its lead and sends it a line, then
 * sends one to an EM session that leads none. The EM's scripted model records
 * the tools each turn was offered and answers without calling any.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import type { Client } from "@flow-state-dev/client";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { runAction } from "./helpers/run-action";
import { connect } from "../src/lib/connection";
import { readProject, type ProjectAddress } from "../src/lib/projects";
import { createLabReader } from "../src/lib/reads";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";
import { EM_FLOW, EM_TURN } from "../teams/devteam/workforce/flows/workers/em.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const STOREFRONT: ProjectAddress = { visibility: "shared", id: "storefront" };
const ALICE = LAB_USERS.owner;
const EM = "eng.em";

/** A model that notes the tools each call is offered and answers with text. */
function noting(modelId: string, offered: string[][]): GeneratorModel {
  return {
    modelId,
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep(options: { tools?: Record<string, unknown> | Array<{ name?: string }> }) {
      const tools = options.tools ?? {};
      offered.push(Array.isArray(tools) ? tools.map((t) => String(t.name)) : Object.keys(tools));
      return { text: "Noted.", finishReason: "stop" };
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

describe("the EM's updateWorkstream", () => {
  it("is offered on the workstream session it leads, and left out on one that leads none", async () => {
    const offered: string[][] = [];
    const em = noting("test/em", offered);
    const helper = noting("test/helper", []);
    const resolver = Object.assign((_id: string, block?: string) => (block === EM_TURN ? em : helper), {
      resolveId: (id: string) => id,
    }) as unknown as ModelResolver;
    const remote = createBareRemote("em-lead-tool", { seed: { "README.md": "storefront\n" } });
    root = mkdtempSync(join(tmpdir(), "sm-em-lead-tool-"));
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

    const opener = `projects-${ALICE.userId}`;
    await runAction(client, "projects", opener, "openWorkstream", { project: STOREFRONT, id: "feature", title: "Feature", lead: EM });
    const workstream = (await readProject(client, STOREFRONT))!.entries.find((e) => e.owner === ALICE.userId && e.id === "feature")!.sessionId!;
    await runAction(client, EM_FLOW, workstream, "respond", { message: "How is it going?" });
    expect(offered.at(-1), "on the workstream session").toContain("updateWorkstream");

    const plain = (await client.flow(EM_FLOW).createSession({ state: { workerId: EM } } as never)).id;
    await runAction(client, EM_FLOW, plain, "respond", { message: "How is it going?" });
    const onPlain = offered.at(-1)!;
    expect(onPlain, "on a session that leads no workstream").not.toContain("updateWorkstream");
    // The rest of its file's tools are still there.
    expect(onPlain).toContain("listRoutines");
  }, 60_000);
});
