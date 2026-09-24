/**
 * Goal check — `fsdev run` runs a seat in the app's own organization, so a
 * hire made from the terminal lands where the app's users can see it.
 *
 * Real model, real path: `fsdev run support.mara` in kitchen-sink over the
 * filesystem store, then a zero-model read of the same store. The store
 * decides, not the transcript. See goal.md for the contract.
 *
 * Needs kitchen-sink's host resolver (FIX-1500 PR-B). Before it, the run ends
 * refused in the development organization — the FAIL this goal exists to turn.
 *
 * Run: pnpm tsx goals/cli-principal/runs-in-the-apps-organization/run.mts
 */
import { join } from "node:path";
import { createFilesystemStores } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { KITCHEN_SINK, goalTmpDir, loadFixture, readCapture, runFsdev, runGoal } from "../../lib/index.mts";

type Fixture = {
  manager: string;
  action: string;
  seatPrefix: string;
  message: string;
  expect: { userId: string; orgId: string; from: string };
};

const fixture = loadFixture<Fixture>(import.meta.url);
// A fresh seat per run: the filesystem store keeps earlier runs' hires.
const seat = `${fixture.seatPrefix}${Date.now().toString(36)}`;
const CAPTURE = join(goalTmpDir("cli-principal"), "run.json");
const ROSTER = "workforce/roster/";

await runGoal(async () => {
  const exit = runFsdev({
    app: KITCHEN_SINK,
    flow: fixture.manager,
    action: fixture.action,
    input: { message: fixture.message.replace("{seat}", seat) },
    capture: CAPTURE,
    env: { STORE_TYPE: "filesystem" },
  });

  const failures: string[] = [];
  if (exit !== 0) failures.push(`fsdev run exited ${exit}`);

  // 1. Who the run was, as the CLI recorded it.
  const capture = readCapture(CAPTURE);
  const principal = (capture.raw.command as { principal?: unknown } | undefined)?.principal;
  if (JSON.stringify(principal) !== JSON.stringify(fixture.expect)) {
    failures.push(`command.principal is ${JSON.stringify(principal)}, wanted ${JSON.stringify(fixture.expect)}`);
  }
  if (capture.result.success !== true) {
    failures.push(`the run did not complete: ${JSON.stringify(capture.result.error ?? "unknown")}`);
  }

  // 2. The store decides. The same filesystem store kitchen-sink wrote through.
  const stores = createFilesystemStores({
    rootDir: join(KITCHEN_SINK, ".fsdev", "data"),
    developmentOnly: true,
  });
  const inApp = Object.keys(await stores.resourceState.getByPrefix("org", fixture.expect.orgId, ROSTER));
  const inPlaceholder = Object.keys(await stores.resourceState.getByPrefix("org", DEFAULT_ORG_ID, ROSTER));
  const key = `${ROSTER}${seat}`;
  if (!inApp.includes(key)) {
    failures.push(`no roster row ${key} under ${fixture.expect.orgId} (found ${JSON.stringify(inApp)})`);
  }
  if (inPlaceholder.includes(key)) {
    failures.push(`roster row ${key} landed under the development organization ${DEFAULT_ORG_ID}`);
  }

  return {
    failures,
    evidence:
      `principal ${JSON.stringify(principal)}; roster row ${key} under ${fixture.expect.orgId}, ` +
      `none under ${DEFAULT_ORG_ID}; read from ${join(KITCHEN_SINK, ".fsdev", "data")} with no model`,
  };
});
