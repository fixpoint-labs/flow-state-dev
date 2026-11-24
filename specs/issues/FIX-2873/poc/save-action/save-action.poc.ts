/**
 * FIX-2873 spec POC (throwaway; retained here, not discovered by any suite): over Shift
 * Manager's real HTTP door, does the raw `setGitHubReviewers` save action rewrite the
 * trusted-reviewer list?
 *
 * Run: copy to packages/shift-manager/test/zz-poc.test.ts, then
 * `pnpm --filter @flow-state-dev/shift-manager exec vitest run test/zz-poc.test.ts`.
 *
 * Result on main bb1c09790 (2026-11-22): the member's bearer leaves the list "(never saved)";
 * the owner's bearer, a constant in host.mts (LAB_PRINCIPAL_SECRET), rewrites it to "- mallory".
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { GITHUB_REVIEWERS_DOC, GITHUB_REVIEWERS_FLOW, LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { createBareRemote } from "../teams/devteam/scratch-repo.mts";

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
});

const noModel = Object.assign(() => { throw new Error("no model"); }, { resolveId: (id: string) => id }) as unknown as ModelResolver;

async function listed(lab: Lab): Promise<string> {
  const runtime = await lab.state.getRuntime();
  return String((await (runtime.stores as any).content.get("org", LAB_ORG_ID, GITHUB_REVIEWERS_DOC)) ?? "(never saved)");
}

async function post(lab: Lab, as: keyof typeof LAB_USERS) {
  const sessionId = `poc-${as}-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", `${GITHUB_REVIEWERS_FLOW}/sessions`, { body: { userId: LAB_USERS[as].userId, sessionId }, as });
  const sent = await lab.door("POST", `${GITHUB_REVIEWERS_FLOW}/${sessionId}/actions/setGitHubReviewers`, {
    body: { userId: LAB_USERS[as].userId, input: { logins: ["mallory"] } },
    as,
  });
  return { created: created.status, sent: sent.status };
}

it("FIX-2873 POC: the save action over HTTP", async () => {
  const remote = createBareRemote("fix2873-poc", { seed: { "README.md": "x\n" } });
  opened = await openLab({
    modelResolver: noModel,
    stores: inMemoryStores(),
    harness: harnessStub({ finalMessage: "done" }).slot,
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "fix2873-poc-")), remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    withoutJudge: true,
    projects: [{ id: "storefront", title: "Storefront", repository: remote.url }],
  });
  const before = await listed(opened);
  const member = await post(opened, "member");
  await new Promise((r) => setTimeout(r, 300));
  const afterMember = await listed(opened);
  const owner = await post(opened, "owner");
  await new Promise((r) => setTimeout(r, 300));
  const afterOwner = await listed(opened);
  console.log(JSON.stringify({ before, member, afterMember, owner, afterOwner }, null, 1));
  expect(afterMember).toBe(before);
});
