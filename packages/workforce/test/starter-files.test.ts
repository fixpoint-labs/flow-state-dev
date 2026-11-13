/**
 * Workforce's starter files: the registry item an app copies in with
 * `fsdev ui add workforce-starter` (FIX-2626's copy-in) is one team with one
 * worker on the built-in agent flow, and nothing else: no flow file (D1).
 *
 * Graded on the app those files make: copied into an empty app, the kit
 * starts on them, every file claimed, and the roster view lists the worker
 * on `agent` for a user with no session.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowState, createInProcessFetch, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { workforce } from "../src/kit";
import { rosterView } from "../src/browser";

const uiPackage = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");

type RegistryItem = { name: string; type: string; files?: { type: string; path: string; target: string }[] };

const states: FlowState[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const state of states.splice(0)) await state.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The starter item as the registry carries it. */
function starterItem(): RegistryItem {
  const registry = JSON.parse(readFileSync(join(uiPackage, "registry.json"), "utf8")) as { items: RegistryItem[] };
  const item = registry.items.find((entry) => entry.name === "workforce-starter");
  if (item === undefined) throw new Error('the registry has no "workforce-starter" item');
  return item;
}

describe("workforce's starter files", () => {
  it("copied into an empty app, start the kit with one worker on the agent flow, every file claimed", async () => {
    const item = starterItem();
    const files = item.files ?? [];
    expect(files.map((file) => file.target).sort()).toEqual(["workforce/teams/team/TEAM.md", "workforce/teams/team/workers/assistant/WORKER.md"]);
    // The copy-in: each file to its target under the app.
    const app = mkdtempSync(join(tmpdir(), "fsd-workforce-starter-"));
    dirs.push(app);
    for (const file of files) {
      mkdirSync(join(app, dirname(file.target)), { recursive: true });
      writeFileSync(join(app, file.target), readFileSync(join(uiPackage, file.path)));
    }
    const state = createFlowState({
      kits: [workforce({ directory: join(app, "workforce") })],
      stores: { default: { primary: inMemoryStores() } },
      resolvePrincipal: (context: any) => {
        const user = context.request?.headers.get("x-user");
        return typeof user === "string" ? { userId: user, orgId: "org" } : null;
      },
    } as never);
    states.push(state);
    await state.ready();
    const inProcess = createInProcessFetch(state);
    const client = createClient({
      userId: "ada",
      fetcher: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-user", "ada");
        return inProcess(input, { ...init, headers });
      },
    });
    const { value: roster } = await client.view(rosterView);
    expect(roster.map((entry) => ({ id: entry.id, flow: entry.flow, standard: entry.standard }))).toEqual([
      { id: "team.assistant", flow: "agent", standard: true },
    ]);
  });
});
