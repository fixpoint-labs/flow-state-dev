// FIX-2624.
/**
 * Usage on the DevTeam Lab, read with no reader session: the harness rows
 * through the usage flow's view after a Re-check sent to the usage
 * collection, and each worker's spend through the roster flow's view.
 *
 * What matters: a read finds or makes no session, Re-check asks a harness at
 * most once a minute per user, and each user reads their own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessUsageReader } from "@flow-state-dev/core/harness";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { connect } from "../src/lib/connection";
import { readHarnessUsageView, readWorkerUsageView } from "../src/lib/usage";
import { LAB_USERS, openLab, type Lab } from "../teams/devteam/host.mts";
import { serveLab } from "./helpers/serve-lab";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function servedLab(usage?: Record<string, HarnessUsageReader>) {
  const root = mkdtempSync(join(tmpdir(), "sm-usage-views-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const lab: Lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    ...(usage === undefined ? {} : { usage }),
  });
  cleanups.push(() => lab.dispose());
  const served = await serveLab(lab.state);
  cleanups.push(() => served.handle.close());
  const runtime = await lab.state.getRuntime();
  const sessions = async () => (await runtime.stores.session.list({ parentage: "all" } as never)).map((s) => ({ id: s.id, userId: s.userId }));
  const clientOf = (user: { userId: string; bearer: string }) => connect({ userId: user.userId, baseUrl: served.baseUrl, bearerToken: user.bearer });
  return { sessions, clientOf };
}

describe("Usage on the DevTeam Lab, with no reader session", () => {
  it("re-checks and reads each user's own harness usage, once a minute, with only the server's write session made", async () => {
    let asking = "";
    const asked: string[] = [];
    const codex: HarnessUsageReader = async () => {
      asked.push(asking);
      return {
        status: "windows",
        accountId: `acct-${asking}`,
        plan: `plan-${asking}`,
        windows: [{ id: "codex:primary", label: null, minutes: 300, usedPercent: 42, level: null, resetsAt: Date.now() + 3_600_000 }],
      };
    };
    const { sessions, clientOf } = await servedLab({ codex });
    const before = await sessions();

    for (const user of [LAB_USERS.member, LAB_USERS.owner]) {
      asking = user.userId;
      const harnesses = await readHarnessUsageView(clientOf(user));
      expect(harnesses?.map((usage) => [usage.harness, usage.status, usage.plan])).toEqual([["codex", "windows", `plan-${user.userId}`]]);
    }
    // Reading again within the minute asks nobody, and still answers the stored rows.
    asking = LAB_USERS.member.userId;
    expect((await readHarnessUsageView(clientOf(LAB_USERS.member)))?.[0]?.plan).toBe(`plan-${LAB_USERS.member.userId}`);
    expect(asked).toEqual([LAB_USERS.member.userId, LAB_USERS.owner.userId]);

    // No reader or usage session: each user's one new session is the server's write session.
    const added = (await sessions()).filter((s) => !before.some((b) => b.id === s.id));
    expect(added.map((s) => s.userId).sort()).toEqual([LAB_USERS.owner.userId, LAB_USERS.member.userId].sort());
    for (const session of added) expect(session.id).toContain("fsd-write.");
  }, 60_000);

  it("reads each worker's spend through the roster flow's view and makes no session", async () => {
    const { sessions, clientOf } = await servedLab();
    const before = await sessions();
    expect(await readWorkerUsageView(clientOf(LAB_USERS.member), 7)).toEqual([]);
    expect(await sessions()).toEqual(before);
  }, 60_000);
});
