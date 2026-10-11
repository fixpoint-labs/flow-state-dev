/**
 * Goal check — a workforce's code comes from files alone.
 *
 * One leg, on a fixture host that carries a custom worker kind. The host
 * reaches the kind through a `workforce.gen.ts` that `fsdev gen` wrote, and
 * through nothing else.
 *
 *   d  the KIND, on the fixture host. Two workers sit on ONE custom kind,
 *      `desk-clerk`, and differ only in the `desk:` their own `WORKER.md`
 *      declares. The fixture's generated module agrees with its tree
 *      (`fsdev gen --check`), the workers are hired from that module's `kinds`
 *      map, and each one's `answer` names the desk ITS OWN FILE declared, read
 *      from that file here rather than written into the check. An
 *      implementation that hired both onto one shared configuration gives both
 *      the same answer and fails; the two are also required to differ.
 *
 * Legs a to c ran on kitchen-sink's one piece of workforce code, the
 * `escalate` tool block. The escalation feature was removed (FIX-1792), the
 * app carries no workforce code now, and the three legs went with it; goal.md
 * says what that leaves unproved. The leg keeps its letter so the verdict log
 * reads straight.
 *
 * Model-free. See goal.md for the contract.
 *
 * Run:      pnpm tsx goals/workforce-conventions/code-comes-from-files-alone/run.mts
 * Controls: GOAL_CONTROL=shared-settings (this runner hires both fixture workers on the first worker's settings: must FAIL at d, and nothing else)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createWorkerInstallation, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, loadFixture, runGoal } from "../../lib/index.mts";

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

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // Read by this runner: both fixture workers are hired on the first worker's settings.
  "shared-settings": ["d"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const TREE_KIND_MODULE = join(TREE, "flows", "workers", `${fixture.host.kind}.ts`);
const CLI = join(REPO_ROOT, "packages", "cli", "src", "bin.ts");

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

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

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
    fail("d", `fsdev gen --check says the fixture's workforce.gen.ts is not what its tree generates: ${String(e.stderr ?? e.stdout ?? "")}`);
  }
  // This runner reaches the kind through the generated module alone.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  if (importsModule(fileURLToPath(import.meta.url), self, TREE_KIND_MODULE)) {
    fail("d", `this runner imports the fixture's kind module directly, bypassing the generated module`);
  }

  const generated = (await import(pathToFileURL(join(TREE, "workforce.gen.ts")).href)) as {
    kinds: Record<string, unknown>;
  };
  const roster = await readWorkforce(TREE);
  if (roster.errors.length > 0) {
    fail("d", `the fixture tree did not load: ${roster.errors.map((e) => e.path).join(", ")}`);
  }
  let workers: WorkerManifest[] = roster.workers;
  if (CONTROL === "shared-settings") {
    // One configuration for every seat: the first seat's declared keys, each
    // seat keeping only its own id.
    const first = workers[0]!.declared;
    workers = workers.map((worker) => ({ ...worker, declared: { ...first } }));
  }
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: generated.kinds as never });
  const copies = hireWorkforce(installation);
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  try {
    const runtime = await state.getRuntime();
    const router = await state.getRouter();
    const seen: Record<string, string> = {};
    const copy = copies.find((c) => c.kind === fixture.host.kind);
    if (copy === undefined) fail("d", `no copy of the tree's custom flow "${fixture.host.kind}" was registered (registered: ${copies.map((c) => c.id).join(", ")})`);
    for (const seatId of fixture.host.seats) {
      if (copy === undefined) break;
      const declaredFlow = installation.standardWorker(seatId)?.declared.flow;
      if (declaredFlow !== fixture.host.kind) {
        fail("d", `${seatId} runs on "${String(declaredFlow)}", not the tree's custom flow "${fixture.host.kind}"`);
      }
      // A session on the one copy, created naming the worker.
      const sessionPath = [copy.id, "sessions"];
      const created = await router.POST(
        new Request(`http://goal/api/flows/${sessionPath.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: fixture.host.userId, sessionId: `s_${seatId}`, state: { workerId: seatId } }),
        }),
        { params: { path: sessionPath } },
      );
      if (created.status !== 201) {
        fail("d", `${seatId}: its session was not created (${created.status}): ${await created.text()}`);
        continue;
      }
      const ran = (await runAction({
        flow: copy,
        actionName: "answer",
        input: { note: fixture.host.note },
        userId: fixture.host.userId,
        // A fixture host with one organization: the development default.
        orgId: DEFAULT_ORG_ID,
        sessionId: `s_${seatId}`,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: { said?: string }; error?: unknown };
      const said = ran.output?.said ?? "";
      seen[seatId] = said;
      const desk = declaredDesk(seatId);
      if (said === "") {
        fail("d", `${seatId}: answered nothing${ran.error === undefined ? "" : `: ${String(ran.error)}`}`);
      } else if (!said.includes(`[${desk} desk]`)) {
        fail("d", `${seatId}: its WORKER.md declares desk "${desk}", but it answered ${JSON.stringify(said)}`);
      }
    }
    // Two seats, one kind. Equal answers would pass every check above while
    // meaning the configuration came from somewhere other than their files.
    const answers = fixture.host.seats.map((seatId) => seen[seatId] ?? "");
    if (answers.length > 1 && new Set(answers).size === 1) {
      fail(
        "d",
        `both seats answered ${JSON.stringify(answers[0])} — they sit on one kind, so an identical answer means ` +
          `they are running one shared configuration rather than their own files`
      );
    }
    evidence.push(
      `on the fixture host, hired from its generated module: ` +
        fixture.host.seats.map((seatId) => `${seatId} said ${JSON.stringify(seen[seatId] ?? "")}`).join(", ")
    );
  } finally {
    await state.dispose();
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
