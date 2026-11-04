/**
 * Build one app's goal page, in its own process (several Vite builds in one
 * process run out of heap). Called by `run.mts` with one JSON argument:
 *
 *   { repo, root, outDir, control, aliases }
 *
 * `root` is the app's scratch copy, already holding the goal's pages at
 * `src/goal/`. The build is the app's own Vite config plus one plugin that:
 *
 * - swaps each `src/lib/<name>.ts(x)` that has a `src/goal/shift-manager/fakes/<name>.ts`
 *   for it, except where the fake itself imports the real module;
 * - under a control, serves `useJumpToLatest` patched (see `run.mts` → CONTROLS).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { repo: REPO, root, outDir, control, aliases } = JSON.parse(process.argv[2]!) as {
  repo: string;
  root: string;
  outDir: string;
  control: string;
  aliases: Record<string, string>;
};
const HOOK = join(REPO, "packages", "react", "src", "hooks", "useJumpToLatest.ts");
/** The commit before this change: what "today's main" is for the `main-rule` control. */
export const BEFORE = "581142fb";

/** `useJumpToLatest` as a control serves it, or `undefined` for the tree's own. */
function patchedHook(): string | undefined {
  if (control === "main-rule") {
    const source = execFileSync("git", ["show", `${BEFORE}:packages/react/src/hooks/useJumpToLatest.ts`], { cwd: REPO, encoding: "utf8" });
    const from = "return { ref: setNode, atEnd, jump, sent };";
    if (!source.includes(from)) throw new Error(`main-rule: ${BEFORE}'s hook has no "${from}"`);
    // The old rule, with the mark the apps now spread: an attribute it never reads.
    return source.replace(from, 'return { ref: setNode, atEnd, jump, sent, mine: (key: string) => ({ "data-sent-line": key }) };');
  }
  if (control === "no-reserve") {
    const source = readFileSync(HOOK, "utf8");
    const from = "if (anchor === undefined) return;";
    if (!source.includes(from)) throw new Error(`no-reserve: the hook has no "${from}"`);
    return source.replace(from, "return;");
  }
  return undefined;
}

const hook = patchedHook();
const fakes = join(root, "src", "goal", "shift-manager", "fakes");
const swaps = new Map<string, string>();
if (existsSync(fakes)) {
  for (const name of readdirSync(fakes)) {
    const stem = name.replace(/\.tsx?$/, "");
    const real = [".ts", ".tsx"].map((ext) => join(root, "src", "lib", stem + ext)).find((path) => existsSync(path));
    if (real === undefined) throw new Error(`fake ${name} has no src/lib/${stem}.ts(x) to stand in for`);
    swaps.set(real, join(fakes, name));
  }
}
let served = false;

const vite = (await import(pathToFileURL(createRequire(join(root, "package.json")).resolve("vite")).href)) as {
  build(config: Record<string, unknown>): Promise<unknown>;
};
await vite.build({
  root,
  configFile: join(root, "vite.config.ts"),
  logLevel: "error",
  resolve: { alias: Object.entries(aliases).map(([find, replacement]) => ({ find, replacement })) },
  plugins: [
    {
      name: "goal-swaps",
      enforce: "pre",
      async resolveId(this: { resolve: (s: string, i: string, o: object) => Promise<{ id: string } | null> }, source: string, importer: string | undefined, options: object) {
        if (importer === undefined || swaps.size === 0) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        const swap = resolved === null ? undefined : swaps.get(resolved.id);
        return swap !== undefined && importer !== swap ? swap : null;
      },
      load(id: string) {
        if (hook === undefined || id !== HOOK) return null;
        served = true;
        return hook;
      },
    },
  ],
  build: { outDir, emptyOutDir: true },
});
if (hook !== undefined && !served) throw new Error(`${control}: the build never loaded ${HOOK}, so the control never reached the page`);
