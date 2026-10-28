/**
 * DevTeam, served for this goal: the DevForce lab's tree and `openLab`, with a
 * Codex usage reader whose setup the check changes between legs.
 *
 * What it adds over `packages/shift-manager/teams/devteam/fsdev.config.mts`:
 *
 * - **The reader.** `readCodexUsage`, as DevTeam registers it, with the
 *   environment and program the setup file (`USAGE_GOAL_SETUP`) names when it
 *   is called: the real Codex CLI over a `CODEX_HOME` the check made (legs b
 *   and c), or `scripted-app-server.mjs` beside this file (the rest).
 * - **Seeded rows** (`USAGE_GOAL_SEEDS`): a stored reading for a named person,
 *   written into the store before the Lab serves, for the legs that need one
 *   already there (an old reading, a fresher one, one a failed refresh keeps).
 * - **The store**, a SQLite file at `USAGE_GOAL_STORE`.
 *
 * Nothing about the query, the writer or the view is set here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCodexUsage } from "@flow-state-dev/codex";
import { harnessEnv } from "@flow-state-dev/core";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { startHarness } from "../../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_TREE, openLab } from "../../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { EM_FLOW } from "../../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";

const STORE = process.env.USAGE_GOAL_STORE;
const SETUP = process.env.USAGE_GOAL_SETUP;
if (!STORE || !SETUP) throw new Error("USAGE_GOAL_STORE and USAGE_GOAL_SETUP name the store and the reader's setup");
const SCRIPTED = fileURLToPath(new URL("./scripted-app-server.mjs", import.meta.url));

/** What the reader runs over, as the check last wrote it. */
type Setup = { codexHome: string; scripted: boolean };

const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
const coderWorkerId = ((em?.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error("the DevTeam tree names no coder");

const harness = await startHarness("stub");
const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: harness.slot,
  runTimeoutMs: harness.runTimeoutMs,
  workspace: { root: join(STORE, "..", "runs"), remotes: { allow: ["file"] } },
  coderWorkerId,
  inventory: true,
  devtool: true,
  usage: {
    codex: ({ signal } = {}) => {
      const setup = JSON.parse(readFileSync(SETUP, "utf8")) as Setup;
      return readCodexUsage({
        env: { ...harnessEnv({ pass: ["PATH", "HOME"] }), CODEX_HOME: setup.codexHome, USAGE_GOAL_SETUP: SETUP },
        ...(setup.scripted ? { program: { path: SCRIPTED, pathDirs: [] } } : {}),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  },
});

// Each seed is one person's stored reading, written where the query reads it.
const seeds = JSON.parse(process.env.USAGE_GOAL_SEEDS ?? "[]") as Array<{ userId: string; state: Record<string, unknown> }>;
const runtime = (await lab.state.getRuntime()) as unknown as {
  stores: { resourceState: { set(scope: string, id: string, key: string, state: object, version: "any"): Promise<unknown> } };
};
for (const seed of seeds) {
  const cell = resolveUserStorageKey(seed.userId, LAB_ORG_ID, { id: "", isolateUserState: false });
  await runtime.stores.resourceState.set("user", cell, "harness-usage/codex", seed.state, "any");
}

export default lab.state;
