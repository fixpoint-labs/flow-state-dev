/**
 * Goal check — `fsdev run` runs a seat in the app's own organization, so a
 * conversation started from the terminal is stored where the app's users can
 * see it.
 *
 * Real model, real path: `fsdev run support.general` in kitchen-sink over the
 * filesystem store, then a zero-model read of the same store. The store
 * decides, not the transcript. See goal.md for the contract.
 *
 * Needs kitchen-sink's host resolver (FIX-1500 PR-B). Before it, the run went
 * to the development organization — the FAIL this goal exists to turn.
 *
 * Run: pnpm tsx goals/cli-principal/runs-in-the-apps-organization/run.mts
 */
import { join } from "node:path";
import { createFilesystemStores } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { KITCHEN_SINK, goalTmpDir, loadFixture, readCapture, runFsdev, runGoal } from "../../lib/index.mts";

type Fixture = {
  seat: string;
  action: string;
  message: string;
  expect: { userId: string; orgId: string; from: string };
};

const fixture = loadFixture<Fixture>(import.meta.url);
// A fresh conversation per run: the filesystem store keeps earlier runs'.
const sessionId = `sess_goal_cli_${Date.now().toString(36)}`;
const CAPTURE = join(goalTmpDir("cli-principal"), "run.json");

await runGoal(async (failures) => {
  const exit = runFsdev({
    app: KITCHEN_SINK,
    flow: fixture.seat,
    action: fixture.action,
    input: { message: fixture.message },
    session: sessionId,
    capture: CAPTURE,
    env: { STORE_TYPE: "filesystem" },
  });

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
  const session = await stores.session.get(sessionId);
  if (session === undefined) {
    failures.push(`no conversation ${sessionId} in the store at all`);
  } else {
    if (session.flowId !== fixture.seat) {
      failures.push(`conversation ${sessionId} belongs to ${JSON.stringify(session.flowId)}, not ${fixture.seat}`);
    }
    if (session.orgId === DEFAULT_ORG_ID) {
      failures.push(`conversation ${sessionId} was stored under the development organization ${DEFAULT_ORG_ID}`);
    } else if (session.orgId !== fixture.expect.orgId) {
      failures.push(`conversation ${sessionId} was stored under ${JSON.stringify(session.orgId)}, not ${fixture.expect.orgId}`);
    }
  }

  return {
    failures,
    evidence:
      `principal ${JSON.stringify(principal)}; conversation ${sessionId} of ${session?.flowId ?? "nothing"} ` +
      `stored under ${session?.orgId ?? "nothing"} for ${session?.userId ?? "nobody"}; ` +
      `read from ${join(KITCHEN_SINK, ".fsdev", "data")} with no model`,
  };
});
