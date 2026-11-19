/**
 * The four collection definitions on `/browser`: an app reads the worker
 * inventory, the shared and private projects and the message log by them,
 * typed by their client data, instead of naming a pattern and a scope as
 * bare strings.
 *
 * Each reaches the rows the server's own declaration keeps, at the scope it
 * keeps them: the organization's inventory and shared projects, and the
 * caller's own private projects and messages, never another user's.
 *
 * Real engine, real HTTP router, the caller a verified user.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, createInProcessFetch, inMemoryStores, resolveUserStorageKey, type FlowState } from "@flow-state-dev/engine";
import { defineProjectBlocks, defineWorkerInventoryCollection, PROJECTS_FLOW } from "../src/index";
import { workerMessagesCollection } from "../src/messages/message-log";
import { privateProjectsResource, projectsResource, workerInventoryResource, workerMessagesResource } from "../src/browser";

const ORG = "acme";
const states: FlowState[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose();
});

const project = (id: string, owner: string) => ({
  id,
  title: id,
  brief: null,
  status: "active",
  ownerUserId: owner,
  members: [owner],
  repository: null,
  mcpServers: [],
  checks: []
});
const worker = (id: string) => ({ id, kind: "agent", door: "respond", doorTakesTask: false, rules: false, name: id, teamName: null, hired: false, incarnation: null });
const message = (id: string) => ({ id, from: "eng.em", to: "eng.coder", text: `hello ${id}`, exchange: id, sentAt: "2026-11-19T00:00:00.000Z" });

/** A host declaring each collection the way workforce's flows do, with rows for alice and bob. */
async function host() {
  const projects = defineProjectBlocks();
  const state = createFlowState({
    flows: [
      defineFlow({ kind: PROJECTS_FLOW, actions: { ...projects.actions } } as never),
      defineFlow({
        kind: "directory",
        resources: { workers: defineWorkerInventoryCollection(), messages: workerMessagesCollection },
        actions: {}
      } as never)
    ],
    stores: { default: { primary: inMemoryStores() } },
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);
  states.push(state);
  await state.ready();
  const { resourceState } = (await state.getRuntime()).stores;
  const cellOf = (user: string) => resolveUserStorageKey(user, ORG, { id: "", isolateUserState: false });
  await resourceState.set("org", ORG, "projects/apollo", project("apollo", "alice"), "any");
  await resourceState.set("org", ORG, "inventory/workers/eng.coder", worker("eng.coder"), "any");
  for (const user of ["alice", "bob"]) {
    await resourceState.set("user", cellOf(user), `projects/${user}-notes`, project(`${user}-notes`, user), "any");
    await resourceState.set("user", cellOf(user), `workforce/messages/${user}-1`, message(`${user}-1`), "any");
  }
  const inProcess = createInProcessFetch(state);
  return (userId: string) =>
    createClient({
      userId,
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", userId);
        return inProcess(input, { ...init, headers });
      }
    });
}

describe("the collection definitions on /browser", () => {
  it("read the organization's inventory and shared projects, and only the caller's own private projects and messages", async () => {
    const alice = (await host())("alice");
    const workers = await alice.resource(workerInventoryResource).listAll();
    expect(workers.map((entry) => entry.value.id)).toEqual(["eng.coder"]);
    const shared = await alice.resource(projectsResource).listAll();
    expect(shared.map((entry) => entry.value.ownerUserId)).toEqual(["alice"]);
    expect(shared.map((entry) => entry.value.id)).toEqual(["apollo"]);
    const mine = await alice.resource(privateProjectsResource).listAll();
    expect(mine.map((entry) => entry.value.id)).toEqual(["alice-notes"]);
    const messages = await alice.resource(workerMessagesResource).listAll();
    expect(messages.map((entry) => entry.value.text)).toEqual(["hello alice-1"]);
  });
});
