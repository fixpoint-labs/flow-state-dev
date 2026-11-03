/**
 * Everyone in the DevTeam's organization reads its workers, not just the
 * user whose boot wrote them.
 *
 * A user's only way to read the
 * organization's worker inventory is a session of their own whose flow
 * declares it: the roster flow every user reads their roster through. The
 * owner also holds the inventory writer's session from boot; the project member and
 * the outsider hold none, and without the roster's declaration every screen
 * that groups by the inventory (PROJECTS among them) fails for them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import { connect } from "../src/lib/connection";
import { createLabReader } from "../src/lib/reads";
import { harnessStub } from "@flow-state-dev/harness-manager";
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

it("the project member and the outsider read the organization's workers and projects through their own roster session", async () => {
  root = mkdtempSync(join(tmpdir(), "sm-project-inventory-"));
  lab = await openLab({
    stores: inMemoryStores(),
    harness: harnessStub({}).slot,
    workspace: { root, remotes: { allow: ["file"] } },
    coderWorkerId: "eng.coder",
    inventory: true,
    projects: [{ id: "storefront", title: "Storefront", members: [LAB_USERS.member.userId] }],
  });
  served = await serveLab(lab.state);

  const seen: Record<string, string[]> = {};
  for (const who of [LAB_USERS.owner, LAB_USERS.member, LAB_USERS.outsider]) {
    const snapshot = await createLabReader(
      connect({ userId: who.userId, baseUrl: served.baseUrl, bearerToken: who.bearer }),
    ).read();
    if (!("inventory" in snapshot)) throw new Error(`${who.userId}'s read was refused or unreachable: ${JSON.stringify(snapshot)}`);
    expect(snapshot.inventory, `${who.userId}'s inventory`).toMatchObject({ ok: true });
    expect(snapshot.projects, `${who.userId}'s projects`).toMatchObject({ ok: true });
    if (!snapshot.inventory.ok) continue;
    seen[who.userId] = snapshot.inventory.value.workers.map((s) => s.id).sort();
  }
  // One organization, one inventory: each user reads the same workers, the EM and the coder among them.
  const owner = seen[LAB_USERS.owner.userId]!;
  expect(owner).toEqual(expect.arrayContaining(["eng.coder", "eng.em"]));
  expect(seen[LAB_USERS.member.userId]).toEqual(owner);
  expect(seen[LAB_USERS.outsider.userId]).toEqual(owner);
}, 60_000);
