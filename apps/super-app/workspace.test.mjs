/**
 * `installWorkspace` is what makes a dev run start on the dependencies the
 * lockfile names: it runs a frozen install, and a failing install is reported
 * without stopping the run.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installWorkspace } from "./workspace.mjs";

function harness(code = 0) {
  const steps = [];
  const warnings = [];
  const done = installWorkspace({
    run: async (step) => {
      steps.push(step);
      return code;
    },
    warn: (line) => warnings.push(line),
  });
  return { done, steps, warnings };
}

describe("installWorkspace", () => {
  it("runs one pnpm install, frozen so a dev run never rewrites the lockfile", async () => {
    const { done, steps } = harness();
    await done;
    assert.equal(steps.length, 1);
    assert.equal(steps[0].cmd, "pnpm");
    assert.equal(steps[0].args[0], "install");
    assert.ok(steps[0].args.includes("--frozen-lockfile"));
  });

  it("says nothing when the install succeeds", async () => {
    const { done, warnings } = harness(0);
    await done;
    assert.deepEqual(warnings, []);
  });

  it("reports a failed install and resolves, so the apps still start", async () => {
    const { done, warnings } = harness(1);
    await done;
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /install/);
    assert.match(warnings[0], /by hand/);
  });
});
