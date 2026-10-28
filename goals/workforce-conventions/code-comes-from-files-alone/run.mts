/**
 * Goal check — a workforce's code comes from files alone.
 *
 * Three legs. Leg a builds kitchen-sink with one planted block; legs d and e
 * run a fixture host that carries a custom worker kind and reaches it through
 * a `workforce.gen.ts` that `fsdev gen` wrote, and through nothing else.
 *
 *   a  the APP'S BUILD. A block file named with a fresh token is planted in
 *      kitchen-sink's `workforce/blocks/`; the app's own `fsdev gen`, the
 *      workspace packages' build and `next build` run, and the token must be
 *      in compiled chunks under `.next`, beside the hand-wired flows as the
 *      probe's positive control. The plant and `workforce.gen.ts` are restored
 *      when the leg ends.
 *
 *   d  the KIND, on the fixture host. Two workers sit on ONE custom kind,
 *      `desk-clerk`, and differ only in the `desk:` their own `WORKER.md`
 *      declares. The fixture's generated module agrees with its tree
 *      (`fsdev gen --check`), the workers are hired from that module's `workerFlows`
 *      map, and each one's `answer` names the desk ITS OWN FILE declared, read
 *      from that file here rather than written into the check. An
 *      implementation that hired both onto one shared configuration gives both
 *      the same answer and fails; the two are also required to differ.
 *
 *   e  the BUNDLE. `bundled-host.mts` reaches the same kind only through the
 *      generated module; it is bundled and minified with esbuild, written to an
 *      empty folder outside the repository and run there with plain node. Each
 *      worker must still answer with its own file's desk, which it can only do
 *      if the generated module's static imports were carried into the bundle.
 *
 * Legs b and c ran on kitchen-sink's `escalate` tool block, which was removed
 * with the escalation feature (FIX-1792); with no workforce code in the app
 * they have nothing to grade. The letters stay so the verdict log reads
 * straight.
 *
 * Model-free. See goal.md for the contract.
 *
 * Run:      pnpm tsx goals/workforce-conventions/code-comes-from-files-alone/run.mts
 * Controls: GOAL_CONTROL=shared-settings (this runner hires both fixture workers on the first worker's settings: must FAIL at d, and nothing else)
 *           GOAL_CONTROL=stripped-import (the planted block's import is removed from kitchen-sink's generated module before next build: must FAIL at a, and nothing else)
 *           GOAL_CONTROL=runtime-scan (the bundle's host finds kinds by scanning flows/workers/ at run time: must FAIL at e, and nothing else)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, loadFixture, runGoal } from "../../lib/index.mts";
import { answerSeats } from "./bundled-host.mts";

interface Fixture {
  host: {
    userId: string;
    note: string;
    seats: string[];
    kind: string;
  };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/**
 * The named assertions each control must fail. A control may fail other
 * assertions of the same leg (a kind that never bundled also answers nothing),
 * but no assertion of any other leg.
 */
const EXPECTED: Record<string, string[]> = {
  // Read by this runner: both fixture workers are hired on the first worker's settings.
  "shared-settings": ["d:answers", "d:differ"],
  // Read by this runner: the bundle's host finds its kinds by scanning a folder at run time
  // instead of through the generated module's static imports.
  "runtime-scan": ["e:bundled", "e:answers"],
  // Read by this runner: after `fsdev gen` writes the planted block onto kitchen-sink's generated
  // module, its import and entry are stripped before `next build` runs.
  "stripped-import": ["a:chunks"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const TREE_KIND_MODULE = join(TREE, "flows", "workers", `${fixture.host.kind}.ts`);
const CLI = join(REPO_ROOT, "packages", "cli", "src", "bin.ts");
const HERE = dirname(fileURLToPath(import.meta.url));
/** A name only the kind's own module carries: its answer block's. Present in the bundle means the kind was bundled. */
const KIND_MARK = "desk-clerk-answer";

/** Swap the generated module for a run-time scan of `flows/workers/` beside the bundle. */
const runtimeScan: Plugin = {
  name: "runtime-scan",
  setup(b) {
    b.onResolve({ filter: /workforce\.gen\.ts$/ }, (args) => ({ path: args.path, namespace: "runtime-scan" }));
    b.onLoad({ filter: /.*/, namespace: "runtime-scan" }, () => ({
      loader: "js",
      contents: [
        `import { readdirSync } from "node:fs";`,
        `import { dirname, join } from "node:path";`,
        `import { fileURLToPath, pathToFileURL } from "node:url";`,
        `const dir = join(dirname(fileURLToPath(import.meta.url)), "flows", "workers");`,
        `let files = [];`,
        `try { files = readdirSync(dir); } catch {}`,
        `export const workerFlows = {};`,
        `for (const f of files) workerFlows[f.replace(/\\.[^.]+$/, "")] = (await import(pathToFileURL(join(dir, f)).href)).default;`,
      ].join("\n"),
    }));
  },
};

/**
 * Whether `source` (the text of `file`) pulls in the module at `target`.
 *
 * Importing a kind's module binds it to an identifier, which a hand wiring can
 * register with no quoted name anywhere. Covers `from "x"`, a bare
 * `import "x"`, `import("x")` and `require("x")`. Relative specifiers are
 * resolved against the file; a bare package name is skipped, since nothing
 * publishes the fixture's kind. Extensions are dropped on both sides.
 */
function importsModule(file: string, source: string, target: string): boolean {
  const bare = (path: string) => path.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
  for (const [, specifier] of source.matchAll(
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g
  )) {
    const resolved = specifier.startsWith(".") ? resolve(dirname(file), specifier) : undefined;
    if (resolved !== undefined && bare(resolved) === bare(target)) return true;
  }
  return false;
}

/** The `desk:` a fixture seat's own `WORKER.md` declares — the value its answer must carry. */
function declaredDesk(seatId: string): string {
  const [team, worker] = seatId.split(".");
  const path = join(TREE, "teams", team ?? "", "workers", worker ?? "", "WORKER.md");
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  const desk = /^desk:\s*(.+)$/m.exec(front)?.[1]?.trim();
  if (desk === undefined) throw new Error(`${seatId}: its WORKER.md declares no desk: — ${path}`);
  return desk;
}


// ---- the app, for leg (a) ----------------------------------------------------
const KITCHEN_SINK = join(REPO_ROOT, "apps", "kitchen-sink");
const NEXT_DIR = join(KITCHEN_SINK, ".next");
const APP_GEN = join(KITCHEN_SINK, "workforce", "workforce.gen.ts");
const APP_BLOCKS = join(KITCHEN_SINK, "workforce", "blocks");
/** Flows kitchen-sink wires by hand: the probe must find these, or a 0 for the block means nothing. */
const HAND_WIRED = ["chat-agent", "rich-text-component", "weekly-digest"];

/** Every file under `dir`, skipping the trees named by `skip`. */
function walk(dir: string, skip: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skip(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, skip, out);
    else out.push(path);
  }
  return out;
}

/**
 * How many COMPILED chunks under `.next` name `token`.
 *
 * `.js` only, and that exclusion is the leg: `.next` also holds `*.nft.json`
 * file-trace manifests, which list the SOURCE `.ts` files a deployment must
 * carry. A module that is merely typechecked appears in those while appearing
 * in no bundled code, so counting them would score the failure this leg exists
 * to catch as a pass.
 */
function chunksNaming(token: string): number {
  return walk(NEXT_DIR, (name) => name === "node_modules" || name === "cache")
    .filter((path) => path.endsWith(".js"))
    .filter((path) => readFileSync(path, "utf8").includes(token)).length;
}

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- (a) the app's own production build -----------------------------------
  // A block file is dropped into kitchen-sink's `workforce/blocks/` and the
  // app's own build runs: `fsdev gen` puts it on the generated module, and
  // `next build` bundles the app from its real entry points. The block's
  // fresh name must then be in compiled chunks, which it can only be if the
  // app's entry points reach `workforce.gen.ts` and its imports were bundled.
  // Everything the leg writes is restored when it ends, pass or fail.
  const token = `code-from-files-probe-${randomBytes(4).toString("hex")}`;
  // The file, the map key and the block's own name must agree (the tool catalog refuses otherwise).
  const plant = join(APP_BLOCKS, `${token}.ts`);
  const hadBlocksDir = existsSync(APP_BLOCKS);
  const savedGen = readFileSync(APP_GEN);
  const restoreApp = () => {
    rmSync(plant, { force: true });
    if (!hadBlocksDir) rmSync(APP_BLOCKS, { recursive: true, force: true });
    writeFileSync(APP_GEN, savedGen);
  };
  process.once("SIGINT", () => {
    restoreApp();
    process.exit(130);
  });
  try {
    mkdirSync(APP_BLOCKS, { recursive: true });
    writeFileSync(
      plant,
      [
        `// Planted by the code-comes-from-files-alone goal check for one build; removed when it ends.`,
        `import { handler } from "@flow-state-dev/core";`,
        `import { z } from "zod";`,
        ``,
        `export default handler({`,
        `  name: ${JSON.stringify(token)},`,
        `  inputSchema: z.object({}),`,
        `  outputSchema: z.object({ probe: z.string() }),`,
        `  execute: () => ({ probe: ${JSON.stringify(token)} }),`,
        `});`,
        ``,
      ].join("\n"),
    );
    execFileSync("pnpm", ["fsdev", "gen"], { cwd: KITCHEN_SINK, stdio: "pipe" });
    if (!readFileSync(APP_GEN, "utf8").includes(`./blocks/${token}`)) {
      fail("a:gen", `fsdev gen did not put the planted block on kitchen-sink's workforce.gen.ts`);
    }
    if (CONTROL === "stripped-import") {
      const gen = readFileSync(APP_GEN, "utf8")
        .split("\n")
        .filter((line) => !line.includes(token) && !line.includes(token.replaceAll("-", "_")))
        .join("\n");
      writeFileSync(APP_GEN, gen);
    }
    // The packages first, as the app's own deploy build and CI do. Next's
    // TypeScript pass reads each package's types from its `dist`, and where a
    // `dist` is missing it falls through to the package's source and checks it
    // under the app's stricter config, which fails in code this leg never
    // touched. Turbo's cache makes this a no-op when the builds are current.
    execFileSync("pnpm", ["packages:build"], { cwd: REPO_ROOT, stdio: "pipe" });
    // Built here rather than assumed, so the leg cannot pass against a `.next`
    // left by an earlier build.
    execFileSync("pnpm", ["exec", "next", "build"], { cwd: KITCHEN_SINK, stdio: "pipe" });
    const control = HAND_WIRED.map((flow) => [flow, chunksNaming(flow)] as const);
    const blind = control.filter(([, count]) => count === 0).map(([flow]) => flow);
    if (blind.length > 0) {
      fail("a:probe", `the build-output probe is blind: the hand-wired ${blind.join(", ")} appear in 0 compiled chunks, so a 0 for the block would not mean it was left out`);
    } else {
      const count = chunksNaming(token);
      if (count === 0) {
        fail("a:chunks", `the planted block's name "${token}" appears in 0 compiled chunks under .next: the generated module's imports never reached the app's bundle`);
      }
      evidence.push(`kitchen-sink's own build, compiled chunks naming each: ${[...control, ["planted block", count] as const].map(([name, n]) => `${name}=${n}`).join(", ")}`);
    }
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    // Both streams, and enough of them to carry the failing file's path: Next
    // prints it above the code frame, and turbo prints its errors on stdout.
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || String(e.message ?? err);
    fail("a:build", `the app's build did not complete: ${output.slice(-2000)}`);
  } finally {
    restoreApp();
  }

  // ---- (d) the kind, on the fixture host ------------------------------------
  // The generated module is the command's output for this tree, not a file
  // written to pass: `--check` fails when the two disagree. Run from this
  // folder, so the generator resolves from the goals package's dependencies,
  // as an app's would from its own.
  try {
    execFileSync("pnpm", ["-s", "tsx", CLI, "gen", "--check", "--root", TREE], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    fail("d:check", `fsdev gen --check says the fixture's workforce.gen.ts is not what its tree generates: ${String(e.stderr ?? e.stdout ?? "")}`);
  }
  // This runner reaches the kind through the generated module alone.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  if (importsModule(fileURLToPath(import.meta.url), self, TREE_KIND_MODULE)) {
    fail("d:self-import", `this runner imports the fixture's kind module directly, bypassing the generated module`);
  }

  const generated = (await import(pathToFileURL(join(TREE, "workforce.gen.ts")).href)) as {
    workerFlows: Record<string, unknown>;
  };
  const roster = await readWorkforce(TREE);
  if (roster.errors.length > 0) {
    fail("d:tree", `the fixture tree did not load: ${roster.errors.map((e) => e.path).join(", ")}`);
  }
  let workers = roster.workers;
  if (CONTROL === "shared-settings") {
    // One configuration for every seat: the first seat's declared keys, each
    // seat keeping only its own id.
    const first = workers[0]!.declared;
    workers = workers.map((worker) => ({ ...worker, declared: { ...first } }));
  }
  const hired = await answerSeats({
    kinds: generated.workerFlows,
    workers,
    userId: fixture.host.userId,
    note: fixture.host.note,
    kind: fixture.host.kind,
    seats: fixture.host.seats,
  });
  const seen: Record<string, string> = {};
  if (!hired.found) fail("d:registered", `no copy of the tree's custom flow "${fixture.host.kind}" was registered (registered: ${hired.registered.join(", ")})`);
  for (const workerId of fixture.host.seats) {
    const row = hired.answers[workerId];
    if (row === undefined) continue;
    if (row.declaredFlow !== fixture.host.kind) {
      fail("d:flow", `${workerId} runs on "${String(row.declaredFlow)}", not the tree's custom flow "${fixture.host.kind}"`);
    }
    if (row.status !== 201) {
      fail("d:session", `${workerId}: its session was not created (${row.status}): ${String(row.error ?? "")}`);
      continue;
    }
    const said = row.said;
    seen[workerId] = said;
    const desk = declaredDesk(workerId);
    if (said === "") {
      fail("d:answers", `${workerId}: answered nothing${row.error === undefined ? "" : `: ${String(row.error)}`}`);
    } else if (!said.includes(`[${desk} desk]`)) {
      fail("d:answers", `${workerId}: its WORKER.md declares desk "${desk}", but it answered ${JSON.stringify(said)}`);
    }
  }
  // Two seats, one kind. Equal answers would pass every check above while
  // meaning the configuration came from somewhere other than their files.
  const answers = fixture.host.seats.map((workerId) => seen[workerId] ?? "");
  if (answers.length > 1 && new Set(answers).size === 1) {
    fail(
      "d:differ",
      `both seats answered ${JSON.stringify(answers[0])} — they sit on one kind, so an identical answer means ` +
        `they are running one shared configuration rather than their own files`
    );
  }
  evidence.push(
    `on the fixture host, hired from its generated module: ` +
      fixture.host.seats.map((workerId) => `${workerId} said ${JSON.stringify(seen[workerId] ?? "")}`).join(", ")
  );

  // ---- (e) the kind, through a production bundle ----------------------------
  const out = mkdtempSync(join(tmpdir(), "goal-code-from-files-"));
  try {
    const bundle = join(out, "host.mjs");
    const built = await build({
      entryPoints: [join(HERE, "bundled-host.mts")],
      bundle: true,
      minify: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
      plugins: CONTROL === "runtime-scan" ? [runtimeScan] : [],
      // Some dependencies are CommonJS and call require; an ESM bundle has none.
      banner: { js: `import { createRequire as __goalRequire } from "node:module"; const require = __goalRequire(import.meta.url);` },
    });
    if (built.errors.length > 0) fail("e:build", `the bundle did not build: ${built.errors.map((e) => e.text).join("; ")}`);
    const text = readFileSync(bundle, "utf8");
    if (!text.includes(KIND_MARK)) fail("e:bundled", `the bundle carries no "${KIND_MARK}", so the kind's module was not bundled`);
    const input = join(out, "workers.json");
    writeFileSync(input, JSON.stringify({ ...fixture.host, workers: roster.workers }));
    let printed = "";
    try {
      printed = execFileSync(process.execPath, [bundle, input], { cwd: out, stdio: "pipe", env: { PATH: process.env.PATH ?? "" } }).toString();
    } catch (err) {
      const e = err as { stderr?: Buffer };
      const lines = String(e.stderr ?? "").split("\n");
      // The bundle is minified, so the stack's first lines are code; the error's own line names the cause.
      const cause = lines.find((l) => /^\w*Error\b/.test(l)) ?? lines[0] ?? "";
      fail("e:exit", `the bundled host exited non-zero: ${cause.slice(0, 300)}`);
    }
    const line = printed.trim().split("\n").pop() ?? "";
    let result: { kinds: string[]; answers: Record<string, string> } = { kinds: [], answers: {} };
    if (printed !== "") {
      try {
        result = JSON.parse(line) as typeof result;
      } catch {
        fail("e:output", `the bundled host's last line is not JSON: ${JSON.stringify(line.slice(0, 200))}`);
      }
    }
    for (const seatId of fixture.host.seats) {
      const said = result.answers[seatId] ?? "";
      const desk = declaredDesk(seatId);
      if (!said.includes(`[${desk} desk]`)) {
        fail("e:answers", `${seatId}, run from the bundle: its WORKER.md declares desk "${desk}", but it answered ${JSON.stringify(said)}`);
      }
    }
    // The same anti-game as (d): one kind, two workers, so equal answers mean one shared configuration.
    const bundled = fixture.host.seats.map((seatId) => result.answers[seatId] ?? "");
    if (bundled.length > 1 && bundled[0] !== "" && new Set(bundled).size === 1) {
      fail("e:differ", `both workers answered ${JSON.stringify(bundled[0])} from the bundle, so they ran one shared configuration rather than their own files`);
    }
    evidence.push(
      `from a ${Math.round(text.length / 1024)} KB minified bundle run outside the repository (kinds: ${result.kinds.join(", ") || "none"}): ` +
        fixture.host.seats.map((seatId) => `${seatId} said ${JSON.stringify(result.answers[seatId] ?? "")}`).join(", ")
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }

  // A control must fail each assertion it names, and nothing outside that leg.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const wantLegs = new Set(want.map((id) => id.split(":")[0]));
    const failed = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const id of want) {
      if (!failed.has(id)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left ${id} green, so that assertion cannot fail`);
    }
    for (const id of failed) {
      if (id !== "control" && !wantLegs.has(id.split(":")[0]!)) failures.push(`[control] GOAL_CONTROL=${CONTROL} also failed ${id}`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
