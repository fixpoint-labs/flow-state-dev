/**
 * The `fsd` profile (`teams/devteam/fsd.fsdev.config.mts`), opened the way the
 * `shift-manager` command opens it, on a temp store and the scripted coder
 * (V4; BR-1 to BR-3, BR-5, BR-14, BR-15). Where a mapped run works is
 * `fsd-checkout.test.ts`.
 *
 * What it holds is read from the Lab's own stores and routes after the open,
 * never from the profile's source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKOUTS } from "../teams/devteam/fsd-checkouts.mts";
import { FSD_DOCUMENTS, FSD_SKILLS } from "../teams/devteam/fsd-projects.mts";
import { LAB_ORG_ID, type Lab, type OpenLabOptions } from "../teams/devteam/host.mts";
import { connect } from "../src/lib/connection";
import { createLabReader } from "../src/lib/reads";
import { serveLab } from "./helpers/serve-lab";

const REMOTE = "https://github.com/fixpoint-labs/flow-state-dev.git";

let opened: Lab[] = [];
afterEach(async () => {
  for (const lab of opened) await lab.dispose();
  opened = [];
});

/** Run `body` with `vars` set in the environment, then put it back. */
async function withEnv<T>(vars: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await body();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A fresh open of one profile file on `store`, with the scripted coder. */
async function openProfile(file: "fsd.fsdev.config.mts" | "fsdev.config.mts", store: string, extra: Record<string, string> = {}): Promise<Lab> {
  const storeVar = file === "fsd.fsdev.config.mts" ? "FSD_STORE" : "DEVTEAM_STORE";
  return withEnv({ [storeVar]: store, DEVFORCE_LAB_HARNESS: "stub", DEVFORCE_LAB_STEP_MS: "0", ...extra }, async () => {
    vi.resetModules();
    const mod = (await import(`../teams/devteam/${file}`)) as { lab?: Lab; default: Lab["state"] };
    // DevTeam's config exports only its state; the fsd profile also exports its Lab, for in-process checks.
    const lab = mod.lab ?? ({ state: mod.default, dispose: () => mod.default.dispose() } as unknown as Lab);
    opened.push(lab);
    return lab;
  });
}

const tempStore = (name: string) => join(mkdtempSync(join(tmpdir(), `sm-fsd-${name}-`)), "store.sqlite");

/** The organization's project rows, by id. */
async function projectRows(lab: Lab): Promise<Record<string, Record<string, unknown>>> {
  const runtime = await lab.state.getRuntime();
  const rows = await runtime.stores.resourceState.getByPrefix("org", LAB_ORG_ID, "");
  return Object.fromEntries(
    Object.entries(rows)
      .filter(([key]) => /(^|\/)projects\/[^/]+$/.test(key))
      .map(([key, record]) => [key.slice(key.lastIndexOf("/") + 1), (record as { state: Record<string, unknown> }).state]),
  );
}

describe("the fsd profile", () => {
  it("BR-1: opens with exactly FSD and Shift Manager, shared, on this repository, each brief naming its focus", async () => {
    const lab = await openProfile("fsd.fsdev.config.mts", tempStore("br1"));
    const served = await serveLab(lab.state);
    try {
      const devtool = lab.state.meta.devtool;
      const client = connect({
        baseUrl: served.baseUrl,
        userId: devtool?.userId ?? "devuser",
        ...(devtool?.bearerToken === undefined ? {} : { bearerToken: devtool.bearerToken }),
      });
      const snapshot = await createLabReader(client).read();
      if (snapshot.refused !== undefined || snapshot.unreachable !== undefined) throw new Error("the Lab did not load");
      if (!snapshot.projects.ok) throw new Error(snapshot.projects.failure.message);
      const rows = snapshot.projects.value.rows;
      expect(rows.map((p) => [p.id, p.title, p.visibility, p.repository]).sort()).toEqual([
        ["fsd", "FSD", "shared", REMOTE],
        ["shift-manager", "Shift Manager", "shared", REMOTE],
      ]);
      expect(rows.find((p) => p.id === "fsd")!.brief).toMatch(/packages\//);
      expect(rows.find((p) => p.id === "shift-manager")!.brief).toMatch(/packages\/shift-manager/);
    } finally {
      await served.handle.close();
    }
  }, 120_000);

  it("BR-2: raises no ask and opens no workstream on a fresh store", async () => {
    const lab = await openProfile("fsd.fsdev.config.mts", tempStore("br2"));
    const runtime = await lab.state.getRuntime();
    expect(await runtime.stores.suspensions.list({ status: "pending" })).toEqual([]);
    const orgKeys = Object.keys(await lab.stored("org", ""));
    expect(orgKeys.filter((key) => /workstream/i.test(key))).toEqual([]);
    expect(lab.ask).toBeUndefined();
    expect(lab.workstreams).toBeUndefined();
  }, 120_000);

  it("BR-3: a second open on the kept store creates nothing and keeps an edited brief", async () => {
    const store = tempStore("br3");
    const first = await openProfile("fsd.fsdev.config.mts", store);
    expect(first.projects?.map((p) => p.created)).toEqual([true, true]);
    // A user's edit, as the stored row: the brief is what a second open must not reset.
    const key = Object.keys(await first.stored("org", "")).find((k) => /(^|\/)projects\/fsd$/.test(k))!;
    const runtime = await first.state.getRuntime();
    const row = (await runtime.stores.resourceState.get("org", LAB_ORG_ID, key))!;
    await runtime.stores.resourceState.set("org", LAB_ORG_ID, key, { ...row.state, brief: "edited by a user" }, row.version);
    await first.dispose();
    opened = opened.filter((lab) => lab !== first);

    const second = await openProfile("fsd.fsdev.config.mts", store);
    expect(second.projects?.map((p) => p.created)).toEqual([false, false]);
    const rows = await projectRows(second);
    expect(Object.keys(rows).sort()).toEqual(["fsd", "shift-manager"]);
    expect(rows.fsd!.brief).toBe("edited by a user");
  }, 120_000);

  it("BR-5: never reads DevTeam's store, and DevTeam never reads its", async () => {
    const devteamStore = tempStore("br5-devteam");
    const devteam = await openProfile("fsdev.config.mts", devteamStore);
    expect(Object.keys(await projectRows(devteam)).sort()).toEqual(["platform", "sandbox", "storefront"]);
    // DEVTEAM_STORE still points at DevTeam's store while fsd opens: fsd must not read it.
    const fsd = await openProfile("fsd.fsdev.config.mts", tempStore("br5-fsd"), { DEVTEAM_STORE: devteamStore });
    expect(Object.keys(await projectRows(fsd)).sort()).toEqual(["fsd", "shift-manager"]);
    expect(Object.keys(await projectRows(devteam)).sort()).toEqual(["platform", "sandbox", "storefront"]);
  }, 120_000);

  it("hands openLab its checkout mapping and its own coder brief and commit style, and allows no remote", async () => {
    // What the profile handed `openLab`, read by wrapping it: the mapping's
    // own shape and where its runs work is fsd-checkout.test.ts.
    let handed: OpenLabOptions | undefined;
    vi.doMock("../teams/devteam/host.mts", async (original) => {
      const host = (await original()) as typeof import("../teams/devteam/host.mts");
      return { ...host, openLab: (options: OpenLabOptions) => host.openLab((handed = options)) };
    });
    try {
      await openProfile("fsd.fsdev.config.mts", tempStore("handed"));
    } finally {
      vi.doUnmock("../teams/devteam/host.mts");
    }
    const workspace = handed?.workspace as { remotes?: unknown; checkouts?: unknown } | undefined;
    expect({ remotes: workspace?.remotes, checkouts: workspace?.checkouts }).toEqual({ remotes: { allow: [] }, checkouts: CHECKOUTS });
    // What a run on these documents and skills is handed is fsd-checkout.test.ts.
    expect(handed?.documents).toEqual(FSD_DOCUMENTS);
    expect(handed?.skills).toEqual(FSD_SKILLS);
  }, 120_000);

  it.each(["fsd.fsdev.config.mts", "fsdev.config.mts"] as const)("%s holds a coding run that committed for the user's review", async (file) => {
    // openLab leaves review off by default; both profiles ask for it (FIX-2380 D3).
    let handed: OpenLabOptions | undefined;
    vi.doMock("../teams/devteam/host.mts", async (original) => {
      const host = (await original()) as typeof import("../teams/devteam/host.mts");
      return { ...host, openLab: (options: OpenLabOptions) => host.openLab((handed = options)) };
    });
    try {
      await openProfile(file, tempStore(`review-${file}`));
    } finally {
      vi.doUnmock("../teams/devteam/host.mts");
    }
    expect(handed?.reviewChanges).toBe(true);
  }, 120_000);

  // The profile maps only its two shared projects to this checkout, and
  // allows no remote: a run the mapping misses is refused by name, with no
  // worktree of this checkout, and nothing is cloned from GitHub (D3).
  it.each([
    ["BR-14: a shared project a user made on this repository's remote", { id: "mine", title: "Mine", repository: REMOTE }, "shared"],
    ["BR-15: a private project with id fsd on this repository's remote", { id: "fsd", title: "My FSD", repository: REMOTE, visibility: "private" }, "private"],
  ] as const)("%s is refused by its remote, with no worktree and nothing cloned", async (_, project, visibility) => {
    const store = tempStore(`unmapped-${project.id}-${visibility}`);
    const gatewayKey = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const checkout = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8" }).trim();
    const worktrees = () => execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: checkout, encoding: "utf8" });
    try {
      const lab = await openProfile("fsd.fsdev.config.mts", store);
      const made = await lab.projectAct!("createProject", project);
      expect(made.error).toBeUndefined();
      const before = worktrees();
      const issue = `refused-${project.id}-${visibility}`;
      const filed = await lab.file("eng.em", { issue, goal: "Add a line to the README.", maxAttempts: 1, project: { visibility, id: project.id } });
      expect(filed.error).toBeUndefined();
      let row = await lab.featureRow(issue);
      for (let i = 0; i < 50 && (row === undefined || row.status === "pending" || row.status === "in_progress"); i += 1) {
        await lab.drain("eng.em");
        row = await lab.featureRow(issue);
      }
      expect(row?.status).toBe("errored");
      const said = JSON.stringify(row);
      expect(said).toContain("remote-not-allowed");
      expect(said).toContain("github.com");
      expect(said).toContain("/fixpoint-labs/flow-state-dev");
      expect(worktrees()).toBe(before);
      const clones = join(store, "..", "fsd-runs", ".clones");
      expect(existsSync(clones) ? readdirSync(clones) : []).toEqual([]);
    } finally {
      if (gatewayKey !== undefined) process.env.AI_GATEWAY_API_KEY = gatewayKey;
    }
  }, 120_000);
});
