// FIX-2624.
/**
 * The Lab's project setup is a view: Shift Manager reads which worker each
 * person's project coordinator runs as with no session found or made.
 *
 * What it answers is the Lab's configuration, the same for every caller the
 * flow signs in, so a second user and a second org read the same setup and
 * the answer names no user or org topic: nothing one caller reads can carry
 * another's data.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, viewRef } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, inMemoryStores } from "@flow-state-dev/engine";
import { createInMemoryStores } from "@flow-state-dev/engine/host";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { connect } from "../src/lib/connection";
import { PROJECT_SETUP_VIEW, readProjectSetup } from "../src/lib/projects";
import { LAB_USERS, openLab, PROJECTS_FLOW, projectSetupView, type Lab } from "../teams/devteam/host.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the project setup view", () => {
  const signIn = (context: { request?: Request }) => {
    const user = context.request?.headers.get("x-user");
    const org = context.request?.headers.get("x-org");
    return user == null || org == null ? null : { userId: user, orgId: org };
  };

  it("answers a second user and a second org the Lab's setup, and makes no session for any of them", async () => {
    const flow = defineFlow({
      kind: "lab-projects",
      views: { [PROJECT_SETUP_VIEW]: projectSetupView(() => "eng.project-coordinator") },
      authentication: { resolvePrincipal: signIn },
    } as never)();
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 });
    cleanups.push(() => disposeFlowApiRouter(router));
    const clientOf = (userId: string, orgId: string) =>
      createClient({
        userId,
        fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
          request.headers.set("x-user", userId);
          request.headers.set("x-org", orgId);
          const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/");
          return request.method === "GET" ? router.GET(request, { params: { path } }) : router.POST(request, { params: { path } });
        },
      });

    for (const [userId, orgId] of [["alice", "org-a"], ["bob", "org-a"], ["carol", "org-b"]] as const) {
      const answer = await clientOf(userId, orgId).view(viewRef("lab-projects", PROJECT_SETUP_VIEW), {});
      // The Lab's configuration, not a caller's data: no user or org topic.
      expect(answer.value).toEqual({ projectCoordinator: "eng.project-coordinator" });
      expect(answer.topics).toEqual([]);
    }
    expect(await stores.session.list({})).toEqual([]);
  });
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
    const registry = await stores.resolve();
    const sessionIds = async () => (await registry.session.list({ parentage: "all" } as never)).map((session) => session.id).sort();
    const before = await sessionIds();

    const client = connect({ userId: LAB_USERS.member.userId, baseUrl: served.baseUrl, bearerToken: LAB_USERS.member.bearer });
    const setup = await readProjectSetup(client);
    expect(setup?.flow).toBe(PROJECTS_FLOW);
    expect(setup?.projectCoordinator).toEqual(expect.any(String));
    expect(await sessionIds()).toEqual(before);
  }, 60_000);
});
