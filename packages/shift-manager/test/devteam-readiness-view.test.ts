// FIX-2624.
/**
 * DevTeam's harness readiness is the harness kit's view: the Lab installs the
 * kit with its coder off, and a user reads which harnesses can run here, and
 * Re-checks, with no session found or made for the read. Each signed-in user reads the machine's entries.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { HarnessReadiness } from "@flow-state-dev/core/harness";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub, type Harness } from "@flow-state-dev/harness-manager";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { connect } from "../src/lib/connection";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

let lab: Lab | undefined;
let served: ServedLab | undefined;
let root: string | undefined;

afterEach(async () => {
  await served?.handle.close();
  await lab?.dispose();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  lab = undefined;
  served = undefined;
  root = undefined;
});

const SIGNED_OUT: HarnessReadiness = { ready: false, reason: "Codex is signed out", remedy: "Run `codex login`" };

it("answers each user the machine's readiness entries from the harness kit's flow, Re-checks on refresh, and makes no session", async () => {
  const answers: HarnessReadiness[] = [SIGNED_OUT, { ready: true }];
  let checks = 0;
  // A harness value the Lab fills the harness kit's slot with; its coder stays the Lab's own.
  const codex: Harness = {
    id: "codex",
    label: "Codex",
    agent: harnessStub({}).slot,
    readiness: async () => answers[Math.min(checks++, answers.length - 1)]!,
    pass: [],
  };
  root = mkdtempSync(join(tmpdir(), "sm-readiness-view-"));
  const stores = inMemoryStores();
  lab = await openLab({
    stores,
    harness: harnessStub({}).slot,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    harnessValues: [codex],
  });
  served = await serveLab(lab.state);
  const runtime = await lab.state.getRuntime();
  const sessionIds = async () => (await runtime.stores.session.list({ parentage: "all" } as never)).map((session) => session.id).sort();
  const before = await sessionIds();
  const ref = harnessReadinessViewRef("harnesses");
  const clientOf = (who: { userId: string; bearer: string }) => connect({ userId: who.userId, baseUrl: served!.baseUrl, bearerToken: who.bearer });

  for (const who of [LAB_USERS.owner, LAB_USERS.member]) {
    const answer = await clientOf(who).view(ref, {});
    expect(answer.value.map((harness) => ({ harness: harness.harness, ready: harness.ready, remedy: harness.remedy }))).toEqual([
      { harness: "codex", ready: false, remedy: "Run `codex login`" },
    ]);
  }
  // Re-check from one user checks again; the next reader sees it.
  expect((await clientOf(LAB_USERS.member).view(ref, { refresh: true })).value[0]!.ready).toBe(true);
  expect((await clientOf(LAB_USERS.owner).view(ref, {})).value[0]!.ready).toBe(true);

  // No reader had a session found or made for the read.
  expect(await sessionIds()).toEqual(before);
}, 60_000);
