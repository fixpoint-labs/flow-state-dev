/**
 * DevTeam boots over a store written before mailboxes were renamed.
 *
 * Nothing reads the old names, so a store from before holds sessions and rows
 * this version cannot open. DevTeam's store is a lab's dev store, rebuilt from
 * its files at boot, so the old file is moved aside (never deleted), the boot
 * says where and why, and DevTeam starts fresh.
 *
 * Two stores, because the marks differ: one holds a session on the old
 * built-in kind; the other holds only an inventory row under the old key, which
 * is all a custom-kind mailbox leaves behind (its kind kept its name).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFsdevConfig } from "@flow-state-dev/fsdev";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { MAILBOX_KIND, PRE_RENAME_NAMES } from "@flow-state-dev/workforce";
import { LAB_ORG_ID, LAB_USER_ID } from "../../../goals/devforce-lab/lab/host.mts";
import { serveLab, type ServedLab } from "./helpers/serve-lab";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = "labs/shift-manager/teams/devteam/fsdev.config.mts";

type Seed = (old: ReturnType<typeof createSQLiteStores>) => Promise<void>;

/** Seed a store, boot DevTeam over it, and keep what the boot logged. */
function bootOver(seed: Seed) {
  const run: { lab?: ServedLab; error?: unknown; dir: string; store: string; logged: string[] } = {
    dir: "",
    store: "",
    logged: [],
  };
  beforeAll(async () => {
    run.dir = mkdtempSync(join(tmpdir(), "sm-pre-rename-"));
    run.store = join(run.dir, "devteam.sqlite");
    const old = createSQLiteStores({ filename: run.store });
    await seed(old);
    old.close();

    const error = console.error;
    console.error = (...args: unknown[]) => {
      run.logged.push(args.map(String).join(" "));
      error(...args);
    };
    process.env.DEVTEAM_STORE = run.store;
    try {
      const loaded = await loadFsdevConfig({ cwd: repo, configPath: CONFIG });
      if (loaded === undefined) throw new Error(`no config at ${CONFIG}`);
      run.lab = await serveLab(loaded.flowState);
    } catch (caught) {
      run.error = caught;
    } finally {
      delete process.env.DEVTEAM_STORE;
      console.error = error;
    }
  }, 120_000);
  afterAll(async () => run.lab?.handle.close());
  return run;
}

/** The checks both stores answer the same way. */
function setsAsideAndStartsFresh(run: ReturnType<typeof bootOver>, mark: string) {
  it("boots", () => {
    expect(run.error).toBeUndefined();
    expect(run.lab).toBeDefined();
  });

  it("moves the old store aside, keeping it, and says where and why", () => {
    const aside = readdirSync(run.dir).filter((name) => name.startsWith("devteam.sqlite.") && name.includes("pre-mailboxes"));
    expect(aside).toHaveLength(1);
    const log = run.logged.join("\n");
    expect(log).toContain(aside[0]);
    expect(log).toMatch(/were renamed to mailboxes/);
    expect(log).toContain(mark);
  });

  it("starts fresh: the feature mailbox is open on the mailbox kind, and nothing old is left", async () => {
    expect(existsSync(run.store)).toBe(true);
    const reread = createSQLiteStores({ filename: run.store });
    const mailbox = await reread.session.get("eng.feature");
    const oldSessions = await reread.session.list({ flowKind: PRE_RENAME_NAMES.kind });
    const oldRows = await reread.resourceState.getByPrefix("org", LAB_ORG_ID, PRE_RENAME_NAMES.inventoryPrefix);
    reread.close();
    expect(mailbox?.flowKind).toBe(MAILBOX_KIND);
    expect(oldSessions).toEqual([]);
    expect(Object.keys(oldRows)).toEqual([]);
  });
}

describe("DevTeam over a store holding a session on the old built-in kind (BR-15)", () => {
  const run = bootOver(async (old) => {
    const now = Date.now();
    await old.session.set(
      "eng.feature",
      {
        id: "eng.feature",
        flowKind: PRE_RENAME_NAMES.kind,
        flowId: PRE_RENAME_NAMES.kind,
        userId: LAB_USER_ID,
        orgId: LAB_ORG_ID,
        state: { members: ["eng.em"], instructions: "old" },
        lineageId: "lin_eng.feature",
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
      } as never,
      "absent",
    );
  });
  setsAsideAndStartsFresh(run, `mailbox "eng.feature"`);
});

describe("DevTeam over a store whose only mark is an old inventory row (BR-17)", () => {
  const run = bootOver(async (old) => {
    await old.resourceState.set(
      "org",
      LAB_ORG_ID,
      `${PRE_RENAME_NAMES.inventoryPrefix}eng.feature`,
      { id: "eng.feature", kind: "digest" } as never,
      "any" as never,
    );
  });
  setsAsideAndStartsFresh(run, `organization "${LAB_ORG_ID}"`);
});
