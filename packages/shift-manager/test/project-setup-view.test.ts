// FIX-2624.
/**
 * The Lab's project setup is a view: Shift Manager reads which worker each
 * user's project coordinator runs as with no session found or made. The view
 * is workforce's, served by the project blocks the DevTeam Lab builds its
 * projects flow from; its own behaviour, a second user and a second org
 * included, is `packages/workforce/test/project-setup-view.test.ts`'s.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { connect } from "../src/lib/connection";
import { readProjectSetup } from "../src/lib/projects";
import { inMemoryStores } from "@flow-state-dev/engine";
import { LAB_USERS, openLab, PROJECTS_FLOW, type Lab } from "../teams/devteam/host.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("readProjectSetup on the DevTeam Lab", () => {
  it("names the projects flow and its project coordinator, read with no session", async () => {
    const root = mkdtempSync(join(tmpdir(), "sm-project-setup-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const stores = inMemoryStores();
    const lab: Lab = await openLab({ stores, harness: harnessStub({}).slot, workspace: { root, remotes: { allow: ["file"] } }, coderWorkerId: "eng.coder" });
    cleanups.push(() => lab.dispose());
    const served: ServedLab = await serveLab(lab.state);
    cleanups.push(() => served.handle.close());
    const runtime = await lab.state.getRuntime();
    const sessionIds = async () => (await runtime.stores.session.list({ parentage: "all" } as never)).map((session) => session.id).sort();
    const before = await sessionIds();

    const client = connect({ userId: LAB_USERS.member.userId, baseUrl: served.baseUrl, bearerToken: LAB_USERS.member.bearer });
    const setup = await readProjectSetup(client);
    expect(setup?.flow).toBe(PROJECTS_FLOW);
    expect(setup?.projectCoordinator).toEqual(expect.any(String));
    expect(await sessionIds()).toEqual(before);
  }, 60_000);
});
