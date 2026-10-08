/**
 * The scratch patches (PLAN S3) the milestone uses: `second-org`, which adds
 * a bearer for Alice in a second organization, and the control
 * `org-scoped-workers`, which moves the worker collection to org scope.
 * The final run adds `unpartitioned`, `no-follow-up`, `no-delegate-check` and
 * `no-roster-check` here.
 *
 * Nothing here writes to the checkout under test, and nothing is committed:
 *
 * - A **profile patch** edits a copy of the DevTeam profile
 *   (`packages/shift-manager/teams/devteam/`), made beside the original so
 *   every package and relative import resolves as it does for the shipped
 *   install. The copy is deleted when the run ends.
 * - A **module patch** edits one source module as the served process loads
 *   it (`module-patch.mjs`), for a change inside a package the install imports.
 *
 * Each says exactly what it changes, as a diff printed in full in the report.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The DevTeam profile inside a checkout. */
export const profileOf = (root: string) => join(root, "packages", "shift-manager", "teams", "devteam");

/** One edit to a scratch copy of the DevTeam profile. */
export type ProfilePatch = { name: string; apply(profile: string): void };

/** A patched copy of the DevTeam profile, served by its own config. */
export interface ScratchProfile {
  /** The copy's `fsdev.config.mts`, for `--config`. */
  config: string;
  /** `diff -ruN` from the commit's profile to the copy. */
  diff: string;
  remove(): void;
}

/** Copy the profile of the checkout at `root`, apply `patches`, and say exactly what differs. */
export function scratchProfile(root: string, tag: string, patches: ProfilePatch[]): ScratchProfile {
  const original = profileOf(root);
  const copy = `${original}-${patches.map((p) => p.name).join("+")}-${tag}`;
  cpSync(original, copy, { recursive: true });
  const remove = () => rmSync(copy, { recursive: true, force: true });
  try {
    for (const patch of patches) patch.apply(copy);
    const diff = spawnSync("diff", ["-ruN", original, copy], { encoding: "utf8", maxBuffer: 1 << 24 }).stdout.replaceAll(root + "/", "");
    return { config: join(copy, "fsdev.config.mts"), diff, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

/** Alice's second organization, which the shipped DevTeam host has no principal for. */
export const SECOND_ORG = { orgId: "devforce-lab-second", bearer: "devforce-lab-verified-owner-second-org" } as const;

/**
 * `second-org`: one more verified bearer on the DevTeam host, naming the
 * Lab's owner (Alice) in {@link SECOND_ORG}. Added beside the host's own
 * bearers, so every other principal resolves as shipped ("Decided, not
 * asked": the install has no second-org principal of its own).
 */
export const secondOrg: ProfilePatch = {
  name: "second-org",
  apply(profile) {
    const host = join(profile, "host.mts");
    const text = readFileSync(host, "utf8");
    const anchor = "const resolveLabPrincipal: PrincipalResolver = async (context) => {";
    for (const needed of [anchor, "const labBearers = ", "createBearerSecretPrincipalResolver", "LAB_USER_ID"]) {
      if (!text.includes(needed)) throw new Error(`second-org: host.mts no longer has "${needed}", which this patch edits beside`);
    }
    const added = [
      "// Scratch patch `second-org` (the closure goal's milestone): the owner, in a second organization.",
      "labBearers.push(",
      "  createBearerSecretPrincipalResolver({",
      `    secret: ${JSON.stringify(SECOND_ORG.bearer)},`,
      `    principal: { userId: LAB_USER_ID, orgId: ${JSON.stringify(SECOND_ORG.orgId)} },`,
      "  }),",
      ");",
      "",
    ].join("\n");
    writeFileSync(host, text.replace(anchor, `${added}${anchor}`));
  },
};

/** A module patch: the environment that applies it to a served process, and what it changes. */
export interface ModulePatch {
  name: string;
  /** Add to the served process's environment. */
  env: Record<string, string>;
  /** `diff -u` from the module as committed to the module as served. */
  diff: string;
}

const MODULE_PATCH = fileURLToPath(new URL("./module-patch.mjs", import.meta.url));

/** Every `.ts` file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * `org-scoped-workers`: the user's worker collection (`workforce/workers/*`)
 * declared at org scope instead of user scope, so every member of the org
 * reads and resolves every member's workers. FIX-1788's name for the hole it
 * closes. Found by what declares the collection, not by a file name.
 *
 * @throws When no module, or more than one, declares the collection at user scope.
 */
export function orgScopedWorkers(root: string): ModulePatch {
  const from = 'scope:\\s*"user"';
  const declaring = sources(join(root, "packages", "workforce", "src")).filter((file) => {
    const text = readFileSync(file, "utf8");
    return /pattern:\s*WORKERS_PATTERN/.test(text) && (text.match(new RegExp(from, "g")) ?? []).length === 1;
  });
  if (declaring.length !== 1) {
    throw new Error(`org-scoped-workers: wanted one module declaring the worker collection (pattern: WORKERS_PATTERN, scope: "user"), found ${declaring.length}`);
  }
  const file = declaring[0]!;
  const before = readFileSync(file, "utf8");
  const to = 'scope: "org"';
  const scratch = mkdtempSync(join(tmpdir(), "org-scoped-workers-"));
  writeFileSync(join(scratch, "after.ts"), before.replace(new RegExp(from), to));
  const diff = spawnSync("diff", ["-u", file, join(scratch, "after.ts"), "--label", `a/${file.slice(root.length + 1)}`, "--label", `b/${file.slice(root.length + 1)}`], { encoding: "utf8" }).stdout;
  rmSync(scratch, { recursive: true, force: true });
  return {
    name: "org-scoped-workers",
    env: {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(MODULE_PATCH).href}`.trim(),
      GOAL_MODULE_PATCH: JSON.stringify({ file, from, to }),
    },
    diff,
  };
}

/**
 * Proof that a module patch reaches the code the served process runs: a
 * process started with the patch's environment imports the declaring module
 * from the checkout and reports the collection's scope. Run before the
 * control's boot, so a patch that silently doesn't load is a setup failure,
 * not a control that "passed" on unpatched code.
 */
export function probeOrgScopedWorkers(root: string, patch: ModulePatch, tsx: string, scratch: string): { scope: string | undefined; output: string } {
  const { file } = JSON.parse(patch.env.GOAL_MODULE_PATCH!) as { file: string };
  const probe = join(scratch, "probe-org-scoped-workers.mts");
  writeFileSync(
    probe,
    [
      `const m = await import(${JSON.stringify(pathToFileURL(file).href)});`,
      `const c = (m as any).defineWorkerCollection?.();`,
      `console.log("__PROBE__" + JSON.stringify({ scope: c?.scope ?? c?.config?.scope }));`,
    ].join("\n"),
  );
  const ran = spawnSync(tsx, [probe], { cwd: root, encoding: "utf8", env: { ...process.env, ...patch.env }, timeout: 120_000 });
  const output = `${ran.stdout}${ran.stderr}`;
  const line = output.split("\n").find((l) => l.startsWith("__PROBE__"));
  return { scope: line === undefined ? undefined : (JSON.parse(line.slice("__PROBE__".length)) as { scope?: string }).scope, output: output.slice(-1500) };
}
