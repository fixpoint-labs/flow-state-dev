// FIX-2624.
/**
 * DevTeam's projects flow serves harness readiness as harness-manager's view:
 * a person reads which harnesses can run here, and Re-checks, with no session
 * found or made for the read. Each signed-in person reads the machine's rows.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { HarnessReadiness } from "@flow-state-dev/core/harness";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessReadiness, harnessStub } from "@flow-state-dev/harness-manager";
import { harnessReadinessViewRef } from "@flow-state-dev/harness-manager/browser";
import { connect } from "../src/lib/connection";
import { LAB_USERS, openLab, PROJECTS_FLOW, type Lab } from "../teams/devteam/host.mts";
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

it("answers each person the machine's readiness rows from the projects flow, Re-checks on refresh, and makes no session", async () => {
  const answers: HarnessReadiness[] = [SIGNED_OUT, { ready: true }];
  let checks = 0;
  const readiness = harnessReadiness({
    codex: { label: "Codex", check: async () => answers[Math.min(checks++, answers.length - 1)]! },
  });
  root = mkdtempSync(join(tmpdir(), "sm-readiness-view-"));
  const stores = inMemoryStores();
  lab = await openLab({
    stores,
    harness: harnessStub({}).slot,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    readiness,
  });
  served = await serveLab(lab.state);
  const runtime = await lab.state.getRuntime();
  const sessionIds = async () => (await runtime.stores.session.list({ parentage: "all" } as never)).map((session) => session.id).sort();
  const before = await sessionIds();
  const ref = harnessReadinessViewRef(PROJECTS_FLOW);
  const clientOf = (who: { userId: string; bearer: string }) => connect({ userId: who.userId, baseUrl: served!.baseUrl, bearerToken: who.bearer });

  for (const who of [LAB_USERS.owner, LAB_USERS.member]) {
    const answer = await clientOf(who).view(ref, {});
    expect(answer.value.map((row) => ({ harness: row.harness, ready: row.ready, remedy: row.remedy }))).toEqual([
      { harness: "codex", ready: false, remedy: "Run `codex login`" },
    ]);
  }
  // Re-check from one person checks again; the next reader sees it.
  expect((await clientOf(LAB_USERS.member).view(ref, { refresh: true })).value[0]!.ready).toBe(true);
  expect((await clientOf(LAB_USERS.owner).view(ref, {})).value[0]!.ready).toBe(true);

  // No reader had a session found or made for the read.
  expect(await sessionIds()).toEqual(before);
}, 60_000);
