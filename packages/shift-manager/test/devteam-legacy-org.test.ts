/**
 * DevTeam boots over a store an earlier version left under the old org id.
 *
 * The lab's org id was `org_devforce_lab`; it is `devforce-lab` now, because a
 * hired seat's address starts with the org and an address segment is
 * lowercase and hyphenated. A default store from before the change still holds
 * the mailbox's session, the ask's session and the org's rows under the old
 * id, and a boot that reuses them fails on the org binding. The store is a
 * lab's dev store, and the old id never had a hired seat (no address could be
 * built for one), so boot sets the old file aside, says so, and starts fresh.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFsdevConfig } from "@flow-state-dev/fsdev";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { LAB_ORG_ID, LAB_USER_ID } from "../../../goals/devforce-lab/lab/host.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = "packages/shift-manager/teams/devteam/fsdev.config.mts";
const OLD_ORG = "org_devforce_lab";

describe("DevTeam over a store written under the old org id", () => {
  let lab: ServedLab | undefined;
  let dir: string;
  let store: string;
  let booted: { error?: unknown } = {};
  const logged: string[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sm-legacy-org-"));
    store = join(dir, "devteam.sqlite");
    const old = createSQLiteStores({ filename: store });
    const now = Date.now();
    // What the earlier version opened: the feature mailbox's session, bound to the old org.
    await old.session.set(
      "eng.feature",
      {
        id: "eng.feature",
        flowKind: "mailbox",
        flowId: "mailbox",
        userId: LAB_USER_ID,
        orgId: OLD_ORG,
        state: { members: ["eng.em"], instructions: "old" },
        lineageId: "lin_eng.feature",
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
      } as never,
      "absent",
    );
    await old.resourceState.set("org", OLD_ORG, "inventory/seats/eng.em", { id: "eng.em", kind: "em", hired: false } as never, "any" as never);
    old.close();

    const error = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
      error(...args);
    };
    process.env.DEVTEAM_STORE = store;
    try {
      const loaded = await loadFsdevConfig({ cwd: repo, configPath: CONFIG });
      if (loaded === undefined) throw new Error(`no config at ${CONFIG}`);
      lab = await serveLab(loaded.flowState);
    } catch (caught) {
      booted = { error: caught };
    } finally {
      delete process.env.DEVTEAM_STORE;
      console.error = error;
    }
  }, 120_000);
  afterAll(async () => lab?.handle.close());

  it("boots", () => {
    expect(booted.error).toBeUndefined();
    expect(lab).toBeDefined();
  });

  it("sets the old store aside, keeping it, and says so by name", () => {
    const aside = readdirSync(dir).filter((name) => name.startsWith("devteam.sqlite.") && name.includes(OLD_ORG));
    expect(aside).toHaveLength(1);
    expect(logged.join("\n")).toContain(OLD_ORG);
    expect(logged.join("\n")).toContain(aside[0]);
  });

  it("starts fresh under the new org: nothing is left under the old id", async () => {
    expect(existsSync(store)).toBe(true);
    const reread = createSQLiteStores({ filename: store });
    const stale = (await reread.session.list()).filter((s) => (s as { orgId?: string }).orgId === OLD_ORG);
    const rows = await reread.resourceState.getByPrefix("org", OLD_ORG, "");
    const mailbox = await reread.session.get("eng.feature");
    reread.close();
    expect(stale).toEqual([]);
    expect(Object.keys(rows)).toEqual([]);
    expect((mailbox as { orgId?: string } | undefined)?.orgId).toBe(LAB_ORG_ID);
  });
});
