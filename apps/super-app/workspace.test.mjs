/**
 * `createWorkspaceRefresh` is what keeps a dev run on the latest of everything:
 * the install happens before apps start, the package build happens before each
 * page build, concurrent page builds share one package build, and a failing
 * step is reported without stopping the run.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKSPACE_STEPS, createWorkspaceRefresh } from "./workspace.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness({ code = 0, durationMs = 0 } = {}) {
  const ran = [];
  const warnings = [];
  const refresh = createWorkspaceRefresh({
    run: async (step) => {
      ran.push(step.label);
      await sleep(durationMs);
      return code;
    },
    warn: (line) => warnings.push(line),
  });
  return { refresh, ran, warnings };
}

describe("createWorkspaceRefresh", () => {
  it("installs frozen, so a dev run never rewrites the lockfile", () => {
    assert.ok(WORKSPACE_STEPS.install.args.includes("--frozen-lockfile"));
  });

  it("builds only the workspace packages, not the apps", () => {
    assert.ok(WORKSPACE_STEPS.packages.args.includes("--filter=./packages/*"));
  });

  it("leaves Shift Manager's page build to the page watcher", () => {
    assert.ok(WORKSPACE_STEPS.packages.args.includes("--filter=!@flow-state-dev/shift-manager"));
  });

  it("shares one package build between concurrent callers", async () => {
    const { refresh, ran } = harness({ durationMs: 20 });
    const results = await Promise.all([refresh.packages(), refresh.packages(), refresh.packages()]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(ran.length, 1);
  });

  it("builds again for a caller that arrives after the last one finished", async () => {
    const { refresh, ran } = harness();
    await refresh.packages();
    await refresh.packages();
    assert.equal(ran.length, 2);
  });

  it("reports a failing install and resolves false instead of throwing", async () => {
    const { refresh, warnings } = harness({ code: 1 });
    assert.equal(await refresh.install(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /install/);
  });

  it("builds packages again after a failed build, rather than caching the failure", async () => {
    const { refresh, ran, warnings } = harness({ code: 1 });
    assert.equal(await refresh.packages(), false);
    assert.equal(await refresh.packages(), false);
    assert.equal(ran.length, 2);
    assert.equal(warnings.length, 2);
  });
});
