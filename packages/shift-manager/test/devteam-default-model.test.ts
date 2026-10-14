/**
 * The Lab serves a default model (FIX-2008).
 *
 * A worker the chief of staff hires on `agent` names no `model:` (its brief
 * says such a worker "needs no settings"), so its turns run on the agent
 * flow's stock `intent/chat`. The Lab declares no intents, so that intent
 * resolves only through a default model. Without one, every turn of a hired
 * worker failed, its first task and every message after it alike, with the
 * resolver's setup error. The Lab now ships one.
 *
 * The check reads the Lab's own resolver, as `openLab` builds it with no model
 * resolver given (what `shift-manager` and `fsdev dev` serve), with the
 * developer's `FSDEV_DEFAULT_MODEL` cleared so it can't stand in for the Lab's.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { LAB_DEFAULT_MODEL, openLab, type Lab } from "../teams/devteam/host.mts";
import { harnessStub } from "../teams/devteam/harness-stub.mts";

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

  // The id a turn on `intent/chat` runs on: the Lab's default.
  expect(resolver.resolveId("intent/chat")).toBe(LAB_DEFAULT_MODEL);
  // And resolving it is not the setup error (a missing provider key, if any, is another matter).
  let failure = "";
  try {
    resolver("intent/chat");
  } catch (error) {
    failure = (error as Error).message;
  }
  expect(failure).not.toMatch(/no model is configured/i);
});
