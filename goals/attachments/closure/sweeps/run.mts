/**
 * The closure's model-free sweeps (FIX-2565, epic FIX-2516), each a list of
 * findings. See ../goal.md, "Sweeps".
 *
 *   fix-824         FIX-824's goal check (the kill line), re-run unchanged.
 *   fix-2518        FIX-2518's goal check (the registry composer), re-run
 *                   unchanged with `GOAL_REGISTRY=copy` where the shadcn
 *                   registry can't be reached.
 *   kill-line-repo  The kill line's repo half, measured from before the epic
 *                   (the parent of FIX-824's merge), not from `origin/main`:
 *                   no store adapter changed, and no package gained a
 *                   dependency but FIX-2520's one PDF text library.
 *   er-1            Nothing but the contracts helper writes the `fsd-blob:`
 *                   scheme in code, and nothing but the engine's resolver
 *                   decodes a file's `data`, across apps/, labs/ and every
 *                   package's sources and registry.
 *   er-6            No `clipboardData`, `dataTransfer` or `onDrop` in apps/,
 *                   labs/ or packages/shift-manager outside the registry's
 *                   copies; and each host's copies of the composer pieces are
 *                   the registry's, byte for byte (a stale copy is a fork).
 *   ephemeral-disk  A host whose disk doesn't last (the Vercel adapter with
 *                   `VERCEL=1`) refuses an upload to the local blob store by
 *                   name; the same router off Vercel takes it.
 *   seam-task-files A task filed from a message keeps its files after the
 *                   message's session is deleted (`seams.mts`).
 *   seam-task-delete Deleting a task: its file's read is 404, a sibling's
 *                   files stay. **Blocked**: nothing deletes a task (no
 *                   Shift Manager control, no board action).
 *   seam-steer      A steer with a file becomes the next turn (`seams.mts`).
 *
 * Run:  pnpm tsx goals/attachments/closure/sweeps/run.mts
 *       GOAL_SWEEPS=er-1,er-6 (a subset) · PLAYWRIGHT_BROWSERS_PATH for fix-2518
 */
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/engine";
import { createInMemoryStores, createLocalBlobStore } from "@flow-state-dev/engine/host";
import { compareRegistryCopies, REGISTRY_SOURCE_DIR } from "../../../../packages/ui/scripts/registry-drift.ts";
import { createVercelHandler } from "../../../../packages/vercel/src/index.ts";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../../lib/index.mts";
import { wordPng } from "../../reach-the-model/png.mts";
import { walkSteerWithFile, walkTaskFiles } from "./seams.mts";

/** Before the epic: the parent of FIX-824's merge (FIX-2565 DECISIONS, "The control commit"). */
export const BEFORE_EPIC = "8e82e8ced^1";
/** The one dependency the kill line allows: FIX-2520's PDF text library (FIX-2565 SPEC, sweep 1). */
const ALLOWED_DEPENDENCIES = ["unpdf"];
const SCRATCH = goalTmpDir("attachments-closure-sweeps");

const ALL = ["fix-824", "fix-2518", "kill-line-repo", "er-1", "er-6", "ephemeral-disk", "seam-task-files", "seam-task-delete", "seam-steer"] as const;
type Sweep = (typeof ALL)[number];
const asked = (process.env.GOAL_SWEEPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknown = asked.filter((s) => !(ALL as readonly string[]).includes(s));
if (unknown.length > 0) {
  console.error(`unknown GOAL_SWEEPS ${unknown.join(", ")}; known: ${ALL.join(", ")}`);
  process.exit(2);
}
const selected: Sweep[] = asked.length === 0 ? [...ALL] : (asked as Sweep[]);

/**
 * Controls for the two seam walks, each a scratch patch applied as this
 * process loads the module (`goals/lib/module-patch`), never written to the
 * checkout. Run with `GOAL_SWEEPS=<the seam>`; each must FAIL its seam.
 */
const CONTROLS: Record<string, ModulePatch[]> = {
  // The filing files the turn's own references, as no copy were kept: must FAIL seam-task-files on `brief` and `kept`.
  "brief-shares-reference": [
    {
      module: "packages/orchestration/src/skills/task-tools-capability.ts",
      from: String.raw`const init = kept\.files\.length === 0 \? checked\.init : \{ \.\.\.checked\.init, attachments: kept\.files \};`,
      to: "const init = kept.files.length === 0 ? checked.init : { ...checked.init, attachments: [...(ctx.request?.attachments ?? [])] };",
    },
  ],
  // A line with files steers like any other: must FAIL seam-steer on `next-turn` and `not-steered`.
  "steer-files": [
    {
      module: "packages/react/src/hooks/useHarnessLines.ts",
      from: String.raw`if \(files\.attachments !== undefined\) return \{ taken: false, live: false \};`,
      to: "if (false) return { taken: false, live: false };",
    },
  ],
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(CONTROLS[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(CONTROLS[CONTROL]!, REPO_ROOT, mark) },
  });
  assertPatched(CONTROLS[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const say = (s: string) => console.error(`[closure sweeps ${new Date().toISOString().slice(11, 19)}] ${s}`);
const git = (...args: string[]) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" }).trim();

// ---------------------------------------------------------------------------
// The source a rule sweeps
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "test", "tests", "e2e", "__tests__", "coverage", ".fsdev", "storybook-static", "build"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const NOT_SOURCE = /\.(test|spec|stories)\.[a-z]+$/;

/** Every non-test source file under `dir`, by path from the repo root. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    if (!existsSync(at)) return;
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (SOURCE.test(name) && !NOT_SOURCE.test(name)) out.push(relative(REPO_ROOT, full));
    }
  };
  walk(join(REPO_ROOT, dir));
  return out;
}

/** A file's code lines, with their numbers: comment lines dropped. */
function codeLines(file: string): Array<{ n: number; line: string }> {
  return readFileSync(join(REPO_ROOT, file), "utf8")
    .split("\n")
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

/** apps/, labs/, every package's own sources and the UI registry: where a rule about shipped code reads. */
function shippedSources(): string[] {
  const packages = readdirSync(join(REPO_ROOT, "packages")).filter((p) => statSync(join(REPO_ROOT, "packages", p)).isDirectory());
  return [
    ...sourceFiles("apps"),
    ...sourceFiles("labs"),
    ...packages.flatMap((p) => [...sourceFiles(join("packages", p, "src")), ...sourceFiles(join("packages", p, "cli")), ...sourceFiles(join("packages", p, "teams"))]),
    ...sourceFiles(join("packages", "ui", "registry")),
  ];
}

// ---------------------------------------------------------------------------
// The sweeps
// ---------------------------------------------------------------------------

type Found = { failures: string[]; evidence: string };

/** Run a child goal check and read its verdict line. */
function rerun(label: string, script: string, env: Record<string, string> = {}): { status: number | null; verdict: string } {
  say(`${label}: pnpm tsx ${script}`);
  const run = spawnSync("pnpm", ["tsx", script], { cwd: REPO_ROOT, env: { ...process.env, ...env }, encoding: "utf8", timeout: 900_000 });
  const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const lines = out.split("\n");
  const at = lines.findIndex((line) => /^(PASS|FAIL|CAN'T TELL) —/.test(line));
  const verdict =
    // The verdict line and the bullets under it.
    (at >= 0 ? [lines[at], ...lines.slice(at + 1).filter((line) => line.startsWith("  - ")).map((line) => line.trim())].join(" ") : undefined) ??
    // A throw before a verdict: its first error line.
    `no verdict (exit ${run.status}): ${(out.split("\n").find((line) => /Error|error:/.test(line)) ?? out.slice(-400)).trim()}`;
  return { status: run.status, verdict: verdict.slice(0, 900) };
}

function fix824(): Found {
  const { status, verdict } = rerun("fix-824", "goals/attachments/survive-a-restart-by-reference/run.mts");
  return status === 0 ? { failures: [], evidence: verdict.slice(0, 200) } : { failures: [`FIX-824's check: ${verdict}`], evidence: "" };
}

function fix2518(): Found {
  const env: Record<string, string> = { GOAL_REGISTRY: process.env.GOAL_REGISTRY ?? "copy" };
  const { status, verdict } = rerun("fix-2518", "goals/attachments/composer-attaches-and-refuses/run.mts", env);
  return status === 0 ? { failures: [], evidence: verdict.slice(0, 200) } : { failures: [`FIX-2518's check: ${verdict}`], evidence: "" };
}

function killLineRepo(tell: { over<T>(name: string, values: readonly T[], o?: { emptyIs?: string }): T[] }): Found {
  const failures: string[] = [];
  const base = git("rev-parse", BEFORE_EPIC);
  const untouched = ["packages/store-sqlite", "packages/store-postgres", "packages/engine/src/stores/filesystem", "packages/engine/src/stores/memory"];
  const changed = git("diff", "--name-only", base, "HEAD", "--", ...untouched).split("\n").filter(Boolean);
  if (changed.length > 0) failures.push(`store adapters changed since ${base.slice(0, 9)}: ${changed.join(", ")}`);
  const manifests = tell.over("kill-line-repo · package manifests changed since the epic", git("diff", "--name-only", base, "HEAD", "--", "packages/*/package.json").split("\n").filter(Boolean), {
    emptyIs: "no manifest changed",
  });
  const added: string[] = [];
  for (const manifest of manifests) {
    const deps = (text: string): Record<string, string> => {
      try {
        return (JSON.parse(text) as { dependencies?: Record<string, string> }).dependencies ?? {};
      } catch {
        return {};
      }
    };
    let before: Record<string, string> = {};
    try {
      before = deps(git("show", `${base}:${manifest}`));
    } catch {
      // A package new since the epic: every dependency is new.
    }
    const now = deps(readFileSync(join(REPO_ROOT, manifest), "utf8"));
    for (const name of Object.keys(now)) if (!(name in before)) added.push(`${manifest}: ${name}`);
  }
  // A workspace package is this repo's own code, not a dependency an adopter installs: noted, not counted.
  const internal = added.filter((entry) => entry.includes(": @flow-state-dev/") || entry.includes(": @thought-fabric/"));
  const unexpected = added.filter((entry) => !internal.includes(entry) && !ALLOWED_DEPENDENCIES.some((dep) => entry.endsWith(`: ${dep}`)));
  for (const entry of unexpected) failures.push(`a dependency the kill line doesn't allow, added since the epic: ${entry}`);
  return {
    failures,
    evidence: `base ${base.slice(0, 9)}; ${manifests.length} manifests changed; added: ${added.filter((e) => !internal.includes(e)).join(", ") || "none"} (workspace packages noted: ${internal.join(", ") || "none"}); store adapters untouched`,
  };
}

function er1(tell: { over<T>(name: string, values: readonly T[], o?: { emptyIs?: string }): T[] }): Found {
  const helper = "packages/contracts/src/attachments.ts";
  const resolver = "packages/engine/src/blobs/attachments.ts";
  const files = tell.over("er-1 · source files read", shippedSources());
  const scheme: string[] = [];
  const decodes: string[] = [];
  const allDecodes: string[] = [];
  for (const file of files) {
    for (const { n, line } of codeLines(file)) {
      if (file !== helper && (/["'`]fsd-blob:/.test(line) || /\/[^/\n]*fsd-blob[^/\n]*\//.test(line))) scheme.push(`${file}:${n}: ${line.trim().slice(0, 120)}`);
      const decode = /\batob\s*\(|Buffer\.from\([^)]*["'`]base64(url)?["'`]|base64ToBytes|fromBase64\s*\(/.test(line);
      if (!decode) continue;
      allDecodes.push(`${file}:${n}`);
      // A decode of a file part's `data`: the argument names `.data` or `data` itself.
      if (file !== resolver && /\(\s*[\w.?!]*\bdata\b/.test(line)) decodes.push(`${file}:${n}: ${line.trim().slice(0, 120)}`);
    }
  }
  tell.over("er-1 · scheme literals outside the helper", scheme, { emptyIs: "the claim: only the helper writes the scheme" });
  tell.over("er-1 · decodes of `data` outside the resolver", decodes, { emptyIs: "the claim: only the resolver decodes a file's data" });
  const failures = [
    ...scheme.map((s) => `writes the fsd-blob: scheme outside the helper: ${s}`),
    ...decodes.map((d) => `decodes data outside the resolver: ${d}`),
  ];
  return { failures, evidence: `${files.length} source files; ${allDecodes.length} base64 decodes, none of a file's data outside the resolver; no scheme literal outside ${helper}` };
}

/** Each host's folder of registry copies. */
const COPY_DIRS = [
  "apps/kitchen-sink/components/flow-state",
  "packages/shift-manager/src/components/flow-state",
  "labs/claude-code-style/src/components/flow-state",
  "labs/teammates/src/components/flow-state",
];
/** The registry's composer pieces (FIX-2518): what ER-6 says no app writes its own of. */
const COMPOSER_PIECES = ["attachments.tsx", "prompt-input.tsx", "message.tsx"];

function er6(tell: { over<T>(name: string, values: readonly T[], o?: { emptyIs?: string }): T[] }): Found {
  const failures: string[] = [];
  // Handlers outside the copies: a file in a copy folder that has a registry source is the registry's.
  const isCopy = (file: string) => COPY_DIRS.some((dir) => file.startsWith(`${dir}/`) && existsSync(join(REGISTRY_SOURCE_DIR, file.slice(dir.length + 1))));
  const files = tell.over("er-6 · app source files read", [...sourceFiles("apps"), ...sourceFiles("labs"), ...sourceFiles("packages/shift-manager/src")]);
  const handlers: string[] = [];
  for (const file of files.filter((f) => !isCopy(f))) {
    for (const { n, line } of codeLines(file)) {
      if (/\bclipboardData\b|\bdataTransfer\b|\bonDrop\b/.test(line)) handlers.push(`${file}:${n}: ${line.trim().slice(0, 120)}`);
    }
  }
  tell.over("er-6 · paste/drop handlers outside the copies", handlers, { emptyIs: "the claim: no app writes its own paste or drop" });
  for (const h of handlers) failures.push(`an app's own paste/drop handler: ${h}`);
  // The copies themselves: the composer pieces each host holds are the registry's.
  const compared: string[] = [];
  for (const dir of COPY_DIRS) {
    const holds = COMPOSER_PIECES.filter((piece) => existsSync(join(REPO_ROOT, dir, piece)));
    const drift = compareRegistryCopies({ targetDir: join(REPO_ROOT, dir), notInstalled: (file) => !holds.includes(file) });
    compared.push(...drift.compared.map((f) => `${dir}/${f}`));
    for (const piece of drift.mismatches) failures.push(`${dir}/${piece} is not the registry's copy (stale or forked): run the host's registry refresh`);
  }
  tell.over("er-6 · composer pieces compared", compared);
  return { failures, evidence: `${files.length} app files, no own paste/drop handler; ${compared.length} composer copies byte-identical to the registry` };
}

async function ephemeralDisk(): Promise<Found> {
  const failures: string[] = [];
  const upload = () =>
    new Request("http://localhost/api/flows/blobs?userId=closure", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(wordPng("DISK")) });
  const router = () =>
    createFlowApiRouter({
      registry: createFlowRegistry(),
      stores: { ...createInMemoryStores(), blobs: createLocalBlobStore({ rootDir: join(SCRATCH, `blobs-${Date.now()}`) }) },
    } as never);
  const params = () => ({ params: Promise.resolve({ path: ["blobs"] }) });
  const was = process.env.VERCEL;
  try {
    process.env.VERCEL = "";
    const local = await createVercelHandler(router()).POST(upload(), params());
    if (local.status !== 201) failures.push(`off Vercel, a local upload answered ${local.status}, not 201: the refusal below proves nothing`);
    process.env.VERCEL = "1";
    const refused = await createVercelHandler(router()).POST(upload(), params());
    const body = (await refused.json().catch(() => ({}))) as { error?: string; message?: string };
    if (refused.status !== 501 || body.error !== "attachments_unavailable") failures.push(`on Vercel, a local upload answered ${refused.status} ${JSON.stringify(body)}, not 501 attachments_unavailable`);
    if (!/disk/i.test(body.message ?? "")) failures.push(`the refusal doesn't say why by name: ${JSON.stringify(body.message)}`);
    return { failures, evidence: `off Vercel ${local.status}; on Vercel ${refused.status} ${body.error}: "${(body.message ?? "").slice(0, 90)}"` };
  } finally {
    if (was === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = was;
  }
}

/** The one seam the code can't walk: nothing deletes a task. Read off the code, so the day a delete lands this goes red and is written. */
function taskDelete(): Found {
  const where = ["packages/orchestration/src", "packages/shift-manager/src", "packages/workforce/src"];
  const deletes = where.flatMap((dir) => sourceFiles(dir)).filter((file) => codeLines(file).some(({ line }) => /\bdeleteTask\b|\bremoveTask\b|"Delete task"/.test(line)));
  return deletes.length === 0
    ? { failures: ["blocked: nothing deletes a task (no deleteTask on the board, no Delete in Shift Manager), so \"deletes it: the file's read is 404\" and \"a sibling's files stay\" can't be walked; filed as a follow-up"], evidence: "" }
    : { failures: [`a task delete now exists (${deletes.join(", ")}): write this walk`], evidence: "" };
}

// ---------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const steps: Record<Sweep, () => Found | Promise<Found>> = {
    "fix-824": fix824,
    "fix-2518": fix2518,
    "kill-line-repo": () => killLineRepo(tell),
    "er-1": () => er1(tell),
    "er-6": () => er6(tell),
    "ephemeral-disk": ephemeralDisk,
    "seam-task-files": () => walkTaskFiles(join(SCRATCH, `task-files-${Date.now()}`)),
    "seam-task-delete": taskDelete,
    "seam-steer": () => walkSteerWithFile(join(SCRATCH, `steer-${Date.now()}`)),
  };
  for (const sweep of selected) {
    say(sweep);
    try {
      const found = await steps[sweep]();
      for (const f of found.failures) failures.push(`[${sweep}] ${f}`);
      if (found.failures.length === 0) evidence.push(`${sweep}: ${found.evidence}`);
      say(`${sweep}: ${found.failures.length === 0 ? "pass" : `${found.failures.length} finding(s)`}`);
    } catch (error) {
      failures.push(`[${sweep}] threw: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 3).join(" | ") : String(error)}`);
    }
  }
  return { failures, evidence: evidence.join(" · ") };
});
