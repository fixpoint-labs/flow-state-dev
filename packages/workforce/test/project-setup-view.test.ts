/**
 * The project setup view `defineProjectBlocks` serves: which worker each
 * user's project coordinator runs as, read with no session found or made.
 *
 * What it answers is the host's configuration, the same for every caller the
 * flow signs in, so a second user and a second org read the same setup and
 * the answer names no user or org topic: nothing one caller reads can carry
 * another's data. A host that names no coordinator still serves the view, so
 * every projects flow built from the blocks answers it.
 *
 * Real engine, real HTTP router, through the typed ref on `/browser`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, createInProcessFetch, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { defineProjectBlocks, PROJECTS_FLOW, type ProjectBlocksOptions } from "../src/index";
import { projectSetupView } from "../src/browser";

const states: FlowState[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
});

/** A host serving a projects flow built from the blocks with `options`; a client per user and org. */
async function host(options: ProjectBlocksOptions) {
  const projects = defineProjectBlocks(options);
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: [defineFlow({ kind: PROJECTS_FLOW, actions: { ...projects.actions }, views: { ...projects.views } } as never)],
    stores: { default: { primary: stores } },
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org");
      return user == null || org == null ? null : { userId: user, orgId: org };
    }
  } as never);
  states.push(state);
  await state.ready();
  const inProcess = createInProcessFetch(state);
  const clientOf = (userId: string, orgId: string) =>
    createClient({
      userId,
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", userId);
        headers.set("x-org", orgId);
        return inProcess(input, { ...init, headers });
      }
    });
  const sessions = async () => (await state.getRuntime()).stores.session.list({ parentage: "all" } as never);
  return { clientOf, sessions };
}

describe("the project setup view", () => {
  it("answers a second user and a second org the host's coordinator, and makes no session for any of them", async () => {
    let coordinator: string | null = "eng.project-coordinator";
    const h = await host({ projectCoordinator: () => coordinator });
    for (const [userId, orgId] of [["alice", "org-a"], ["bob", "org-a"], ["carol", "org-b"]] as const) {
      const answer = await h.clientOf(userId, orgId).view(projectSetupView, {});
      // The host's configuration, not a caller's data: no user or org topic.
      expect(answer.value).toEqual({ projectCoordinator: "eng.project-coordinator" });
      expect(answer.topics).toEqual([]);
    }
    // Asked on each read: an installation that changes its coordinator answers the new one.
    coordinator = null;
    expect((await h.clientOf("alice", "org-a").view(projectSetupView, {})).value).toEqual({ projectCoordinator: null });
    expect(await h.sessions()).toEqual([]);
  });

  it("is served by a host that names no coordinator, answering null", async () => {
    const h = await host({});
    expect((await h.clientOf("alice", "org-a").view(projectSetupView, {})).value).toEqual({ projectCoordinator: null });
  });
});
