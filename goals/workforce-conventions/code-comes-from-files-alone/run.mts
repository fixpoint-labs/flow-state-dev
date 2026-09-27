/**
 * Goal check — a workforce's code comes from files alone, and survives a
 * production build.
 *
 * Four legs, on two subjects. The first three run against kitchen-sink, whose
 * one piece of workforce code is the `escalate` tool block; the fourth runs on
 * a fixture host that carries a custom worker kind, which the app no longer
 * does. Both reach their code through a `workforce.gen.ts` that `fsdev gen`
 * wrote, and through nothing else.
 *
 *   a  the BUILD. `pnpm build` (`fsdev gen && next build`) runs for real, and
 *      the compiled chunks under `.next` are counted for a name only the block's
 *      module carries. The three flows wired into `createFlowState({ flows })`
 *      by hand are the positive control on the same probe: if they came back
 *      zero the grep proves nothing, so their count is asserted first. This is
 *      the leg that grades the decision — a design that scanned the tree while
 *      the app runs would leave the generated module unreachable from every
 *      entry point and score zero here while still passing on plain Node.
 *
 *   b  the FILING, over the real HTTP route against the app `next start`
 *      serves from that build. A person's post routed to `support.devices`
 *      asks for a person; the seat calls `escalate`, and a row carrying the
 *      post's token lands on `support.help`'s `escalations` board, read back
 *      over the same route the team panel reads. Only the block the generated
 *      module carries can put it there.
 *
 *   c  the INVERSE probe. A scan of `apps/kitchen-sink/**` finds nothing
 *      reaching the block outside the generated module — neither its name as a
 *      literal nor an import of its module, because a hand wiring can take
 *      either route and only the second survives a grep for the name. Without
 *      this leg, (a) and (b) are equally consistent with somebody having
 *      written the block into the app by hand — which is the thing "from files
 *      alone" denies. The scan covers the places the block could be
 *      REGISTERED; what it skips, and why, is listed at the scan.
 *
 *   d  the KIND, on the fixture host. Two seats sit on ONE custom kind,
 *      `desk-clerk`, and differ only in the `desk:` their own `WORKER.md`
 *      declares. The fixture's generated module agrees with its tree
 *      (`fsdev gen --check`), the seats are hired from that module's `kinds`
 *      map, and each one's `answer` names the desk ITS OWN FILE declared, read
 *      from that file here rather than written into the check. An
 *      implementation that hired both onto one shared configuration gives both
 *      the same answer and fails; the two are also required to differ.
 *
 * Real path, real build. The app runs on kitchen-sink's scripted model
 * (keyless), which calls the tool; leg (d) is model-free. See goal.md for the
 * contract.
 *
 * Run:      pnpm tsx goals/workforce-conventions/code-comes-from-files-alone/run.mts
 * Controls: GOAL_CONTROL=no-filing       (the app swaps `escalate` for a stand-in that files nothing: must FAIL at b, and nothing else)
 *           GOAL_CONTROL=shared-settings (this runner hires both fixture seats on the first seat's settings: must FAIL at d, and nothing else)
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { KITCHEN_SINK, REPO_ROOT, loadFixture, runGoal } from "../../lib/index.mts";

interface Fixture {
  port: number;
  app: {
    channel: string;
    board: string;
    seat: string;
    block: string;
    /** A name only the block's own module carries: the build probe greps for it. */
    blockToken: string;
    marker: string;
    controlKinds: string[];
  };
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
  // Read by the app, in test mode: `escalate` becomes a stand-in that says it
  // filed and files nothing.
  "no-filing": ["b"],
  // Read by this runner: both fixture seats are hired on the first seat's settings.
  "shared-settings": ["d"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const NEXT_DIR = join(KITCHEN_SINK, ".next");
const GEN_MODULE = join(KITCHEN_SINK, "workforce", "workforce.gen.ts");
const BLOCK_MODULE = join(KITCHEN_SINK, "workforce", "blocks", `${fixture.app.block}.ts`);
const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const TREE_KIND_MODULE = join(TREE, "flows", "workers", `${fixture.host.kind}.ts`);

/** Every file under `dir`, skipping the trees that are not the app's source. */
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
 * How many COMPILED chunks name `token`.
 *
 * `.js` only, and that exclusion is the leg: `.next` also holds `*.nft.json`
 * file-trace manifests, which list the SOURCE `.ts` files a deployment must
 * carry. A module that is merely typechecked appears in those and in
 * `.tsbuildinfo` while appearing in no bundled code at all, so counting them
 * would score the exact failure this goal exists to catch as a pass.
 */
function chunksNaming(token: string): number {
  return walk(NEXT_DIR, (name) => name === "node_modules" || name === "cache")
    .filter((path) => path.endsWith(".js"))
    .filter((path) => readFileSync(path, "utf8").includes(token)).length;
}

/**
 * Whether `source` (the text of `file`) pulls in the module at `target`.
 *
 * The literal scan below cannot see this route, and it is the route a hand
 * wiring would actually take: importing the block's module binds it to an
 * identifier, and `{ escalate: escalateBlock }` registers it with no quoted
 * name anywhere. Covers `from "x"`, a bare `import "x"`, `import("x")` and
 * `require("x")`. Relative and `@/`-aliased specifiers are resolved against
 * the app; a bare package name is skipped, since nothing publishes this block.
 * Extensions are dropped on both sides because the app's imports are written
 * without them.
 */
function importsModule(file: string, source: string, target: string): boolean {
  const bare = (path: string) => path.replace(/\.(ts|tsx|mts|mjs|js|jsx)$/, "");
  for (const [, specifier] of source.matchAll(
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g
  )) {
    const resolved = specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : specifier.startsWith("@/")
        ? join(KITCHEN_SINK, specifier.slice(2))
        : undefined;
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

/**
 * The flow index's status, or `undefined` when nothing answered at all.
 *
 * Refusing to start wants ANY answer — something holding the port is a reason
 * to stop. Readiness wants a 200 specifically: a process that answers 4xx/5xx
 * is listening but not serving, and treating that as ready is how a run grades
 * a server it did not build.
 */
async function flowIndexStatus(): Promise<number | undefined> {
  try {
    return (await fetch(`${ORIGIN}/api/flows`)).status;
  } catch {
    return undefined;
  }
}

async function waitForServer(): Promise<void> {
  let last: number | undefined;
  for (let i = 0; i < 120; i += 1) {
    last = await flowIndexStatus();
    if (last === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `the built app never served ${ORIGIN}/api/flows — ` +
      (last === undefined ? "nothing answered" : `the last answer was ${last}`)
  );
}

/** Post a person's line to the channel over the route the page's composer uses. */
async function postToChannel(body: string): Promise<void> {
  const res = await fetch(`${ORIGIN}/api/flows/channel/actions/post`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ userId: "devuser", sessionId: fixture.app.channel, input: { body } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`posting to ${fixture.app.channel} returned ${res.status}: ${text.slice(0, 400)}`);
}

/** The board as the team panel reads it, over the public route. */
async function boardText(): Promise<string> {
  const ref = `${fixture.app.channel}.${fixture.app.board}`;
  const res = await fetch(`${ORIGIN}/api/flows/sessions/${fixture.app.channel}/resources/${ref}`);
  return await res.text();
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- (a) the generated module's imports survive a production build -------
  //
  // Built here rather than assumed, so the goal cannot pass against a `.next`
  // left by a previous branch.
  execFileSync("pnpm", ["build"], { cwd: KITCHEN_SINK, stdio: "inherit" });

  const control = fixture.app.controlKinds.map((kind) => [kind, chunksNaming(kind)] as const);
  const blind = control.filter(([, count]) => count === 0).map(([kind]) => kind);
  if (blind.length > 0) {
    // The probe found nothing where code is known to be. The count below is
    // then meaningless, so this is reported instead of the block's zero.
    fail(
      "a",
      `the build-output probe is blind: the hand-wired ${blind.join(", ")} appear in 0 compiled chunks, ` +
        `so a 0 for the block would not mean it was left out`
    );
  } else {
    const count = chunksNaming(fixture.app.blockToken);
    if (count === 0) {
      fail(
        "a",
        `"${fixture.app.blockToken}" (only ${relative(KITCHEN_SINK, BLOCK_MODULE)} names it) appears in 0 compiled ` +
          `chunks under .next — the generated module's imports never reached the bundle`
      );
    }
    evidence.push(
      `compiled chunks naming each: ` +
        [...control, [fixture.app.blockToken, count] as const].map(([name, n]) => `${name}=${n}`).join(", ")
    );
  }

  // ---- (b) a seat files through the block, over HTTP, on the built app ------
  let server: ChildProcess | undefined;
  try {
    // Refuse to start beside something already listening: `next start` would
    // fail to bind and this check would grade whatever IS answering.
    if ((await flowIndexStatus()) !== undefined) {
      throw new Error(
        `something is already answering on ${ORIGIN}; stop it first, or this check would grade it ` +
          `instead of the build it just made`
      );
    }
    // Detached, so the kill below reaches the whole process group: `pnpm start`
    // execs `next start` as a child.
    server = spawn("pnpm", ["start"], {
      cwd: KITCHEN_SINK,
      // The seat's answer calls a model: the scripted one, keyless, which calls
      // the tool. `GOAL_CONTROL` rides along in `process.env`; the app honours
      // it only in test mode.
      env: { ...process.env, PORT: String(fixture.port), KITCHEN_SINK_TEST_MODE: "1", AI_GATEWAY_API_KEY: "" },
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    await waitForServer();

    const token = `case-token-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await postToChannel(`[route:${fixture.app.seat}] ${fixture.app.marker} ${token} the charger caught fire`);
    let board = "";
    for (let i = 0; i < 40 && !board.includes(token); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      board = await boardText();
    }
    if (!board.includes(token)) {
      fail(
        "b",
        `after 20s, ${fixture.app.channel}'s ${fixture.app.board} board holds no row carrying ${token}: the ` +
          `seat's ${fixture.app.block} call filed nothing in the built app`
      );
    } else {
      evidence.push(
        `over ${ORIGIN} against the built app: a post routed to ${fixture.app.seat} left a row carrying ${token} ` +
          `on ${fixture.app.channel}'s ${fixture.app.board} board`
      );
    }
  } finally {
    if (server?.pid !== undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  // ---- (c) nothing in the app registers the block by hand ------------------
  //
  // The generated module is excluded because it IS the sanctioned route, and
  // the block's own module because it names itself — neither is a second place
  // the app had to be edited.
  const sources = walk(
    KITCHEN_SINK,
    (name) => name === "node_modules" || name === ".next" || name === ".fsdev"
  ).filter((path) => /\.(ts|tsx|mts|mjs|js|jsx)$/.test(path));
  // Registration routes only. None of these is served as a flow or reaches
  // the tool catalog as the block:
  //   - `test/` and `e2e/` name the tool to drive it;
  //   - the scripted model (`lib/e2e-mock-script.ts`) names it to call it, as
  //     any model's tool call does;
  //   - the `no-filing` control (`lib/escalate-control.ts`) imports the block's
  //     input schema and description to build a stand-in that files nothing,
  //     swapped in under test mode only, which `test/goal-control.test.ts`
  //     holds it to.
  // A hand registration anywhere else still fails this leg.
  const notRegistration = (path: string) =>
    path === join(KITCHEN_SINK, "lib", "e2e-mock-script.ts") ||
    path === join(KITCHEN_SINK, "lib", "escalate-control.ts") ||
    path.startsWith(join(KITCHEN_SINK, "test") + "/") ||
    path.startsWith(join(KITCHEN_SINK, "e2e") + "/");
  const registrars = sources
    .filter((path) => path !== GEN_MODULE && path !== BLOCK_MODULE && !notRegistration(path))
    .map((path) => {
      const text = readFileSync(path, "utf8");
      const routes: string[] = [];
      if (text.includes(`"${fixture.app.block}"`)) routes.push("names it");
      if (importsModule(path, text, BLOCK_MODULE)) routes.push("imports its module");
      return routes.length > 0 ? `${relative(KITCHEN_SINK, path)} (${routes.join(", ")})` : undefined;
    })
    .filter((found): found is string => found !== undefined);
  if (registrars.length > 0) {
    fail("c", `the block is reached outside the generated module, so it does not come from files alone: ${registrars.join(", ")}`);
  }
  evidence.push(
    `${sources.filter((path) => !notRegistration(path)).length} of ${sources.length} source files under ` +
      `apps/kitchen-sink scanned as registration routes for both routes to the block — the ` +
      `literal "${fixture.app.block}" and an import of its module — and the only file taking either is ` +
      `workforce.gen.ts (the block's own module is itself)`
  );

  // ---- (d) the kind, on the fixture host ------------------------------------
  // The generated module is the command's output for this tree, not a file
  // written to pass: `--check` fails when the two disagree.
  try {
    execFileSync("pnpm", ["fsdev", "gen", "--check", "--root", TREE], { cwd: REPO_ROOT, stdio: "pipe" });
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
  const seats = hireWorkforce(workers, { kinds: generated.kinds as never });
  const state = createFlowState({
    flows: Object.fromEntries(seats.map((seat) => [seat.id, seat])),
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  try {
    const runtime = await state.getRuntime();
    const seen: Record<string, string> = {};
    for (const seatId of fixture.host.seats) {
      const seat = seats.find((s) => s.id === seatId);
      if (seat === undefined) {
        fail("d", `${seatId} was not hired from the fixture tree (hired: ${seats.map((s) => s.id).join(", ")})`);
        continue;
      }
      if (seat.kind !== fixture.host.kind) {
        fail("d", `${seatId} was hired on "${seat.kind}", not the tree's custom kind "${fixture.host.kind}"`);
      }
      const ran = (await runAction({
        flow: seat,
        actionName: "answer",
        input: { note: fixture.host.note },
        userId: fixture.host.userId,
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
