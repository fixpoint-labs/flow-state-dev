/**
 * `openLab` with no model resolver of its own, and `FSDEV_DEFAULT_MODEL` cleared
 * so a developer shell cannot stand in for the Lab's default (FIX-2008).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { LAB_DEFAULT_MODEL, openLab, type Lab } from "../teams/devteam/host.mts";
import { harnessStub } from "@flow-state-dev/harness-manager";

let lab: Lab | undefined;
afterEach(async () => {
  await lab?.dispose();
  lab = undefined;
  vi.unstubAllEnvs();
});

it("resolves a worker that names no model to the Lab's default, not to a setup error", async () => {
  vi.stubEnv("FSDEV_DEFAULT_MODEL", undefined);
  lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root: mkdtempSync(join(tmpdir(), "devteam-default-model-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
  });
  const resolver = (await lab.state.getRuntime()).runtimeConfig.modelResolver!;

  expect(resolver.resolveId("intent/chat")).toBe(LAB_DEFAULT_MODEL);
  // A missing provider key may still throw. The setup error must not.
  expect(() => resolver("intent/chat")).not.toThrow(/no model is configured/i);
});
