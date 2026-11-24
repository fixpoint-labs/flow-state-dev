// FIX-2624.
/**
 * A client writes a project by its address: a send to the projects
 * collection runs the named action on the flow its `runBy` names, the
 * projects flow the host registers (`PROJECTS_FLOW`), in the writer's own
 * write session. A host that serves the projects but registers no projects
 * flow refuses the write by name.
 *
 * Real engine and router, in process; the caller a verified user; the checks
 * are on the stores and the answer, not the helper's return.
 */
import { describe, expect, it } from "vitest";
import { createClient, ClientHttpError } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import { defineProjectBlocks, PROJECTS_FLOW, PROJECTS_PATTERN } from "../src/index";

const ORG = "acme";

function host(options: { projectsFlow: boolean }) {
  const blocks = defineProjectBlocks();
  // The projects flow, or another flow that serves the same collections with no project writes.
  const flow = options.projectsFlow
    ? defineFlow({ kind: PROJECTS_FLOW, actions: { ...blocks.actions } } as never)
    : defineFlow({ kind: "lab", actions: { listProjects: blocks.actions.listProjects } } as never);
  const primary = inMemoryStores();
  const state = createFlowState({
    flows: [flow()],
    stores: { default: { primary } },
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const inProcess = createInProcessFetch(state);
  const client = (user: string) =>
    createClient({
      userId: user,
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-verified-user", user);
        return inProcess(input, { ...init, headers });
      }
    });
  return { state, client };
}

describe("a project write from a client", () => {
  it("is a send to the projects collection, run by the projects flow in the writer's write session", async () => {
    const h = host({ projectsFlow: true });
    const alice = h.client("alice");
    const created = await alice
      .resource({ scope: "user", pattern: PROJECTS_PATTERN })
      .send<{ created: boolean; project: { id: string } }>("createProject", { id: "notes", title: "Notes", visibility: "private" });
    expect(created).toMatchObject({ created: true, project: { id: "notes" } });

    const runtime = await h.state.getRuntime();
    const requests = (await runtime.stores.request.list({})).filter((record) => record.actionName === "createProject");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ flowKind: PROJECTS_FLOW, status: "completed" });
    expect(requests[0]!.sessionId?.startsWith("fsd-write.")).toBe(true);
    // The row is hers, read back by scope with no session.
    expect((await alice.resource({ scope: "user", pattern: PROJECTS_PATTERN }).entry("projects/notes").read()).value).toMatchObject({
      id: "notes",
      ownerUserId: "alice"
    });
  });

  it("is refused by name on a host that serves the projects but registers no projects flow", async () => {
    const h = host({ projectsFlow: false });
    const sent = h
      .client("alice")
      .resource({ scope: "user", pattern: PROJECTS_PATTERN })
      .send("createProject", { id: "notes", title: "Notes", visibility: "private" });
    await expect(sent).rejects.toBeInstanceOf(ClientHttpError);
    await expect(sent).rejects.toMatchObject({ status: 409, body: { error: "runby_flow_missing" } });
  });
});
