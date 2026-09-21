/**
 * Goal check — a worker kind's code comes from files alone, and survives a
 * production build.
 *
 * Three legs, in the order a failure is cheapest to read:
 *
 *   a  the BUILD. `pnpm build` (`fsdev gen && next build`) runs for real, and
 *      the compiled chunks under `.next` are counted for each kind. The three
 *      kinds wired into `createFlowState({ flows })` by hand are the positive
 *      control on the same probe: if they came back zero the grep proves
 *      nothing, so their count is asserted before the workforce's is. This is
 *      the leg that grades the decision — a design that scanned the tree while
 *      the app runs would leave the generated module unreachable from every
 *      entry point and score zero here while still passing on plain Node.
 *
 *   b  the ANSWER, over the real HTTP route against the app `next start`
 *      serves from that build. Two seats sit on ONE kind and differ only in
 *      the `desk:` their own `WORKER.md` declares, and each expectation is
 *      READ FROM THAT FILE rather than written here — so an implementation
 *      that hired both onto one shared configuration, or onto the built-in
 *      `agent` kind (which has no `desk` at all), gives both the same answer
 *      and fails. The two are also required to differ from each other, which
 *      is what makes "keyed by seat" distinguishable from "keyed by kind".
 *
 *   c  the INVERSE probe. A scan of `apps/kitchen-sink/**` finds nothing
 *      reaching the kind outside the generated module — neither its name as a
 *      literal nor an import of its module, because a hand wiring can take
 *      either route and only the second survives a grep for the token.
 *      Without this leg, (a) and (b) are equally consistent with somebody
 *      having written the kind into the app by hand — which is the thing
 *      "from files alone" denies.
 *
 * Real path, real build, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-conventions/code-comes-from-files-alone/run.mts
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { KITCHEN_SINK, loadFixture, runGoal } from "../../lib/index.mts";

interface Fixture {
  userId: string;
  note: string;
  port: number;
  seats: string[];
  kind: string;
  block: string;
  controlKinds: string[];
}

const fixture = loadFixture<Fixture>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const NEXT_DIR = join(KITCHEN_SINK, ".next");
const GEN_MODULE = join(KITCHEN_SINK, "workforce", "workforce.gen.ts");
const KIND_MODULE = join(KITCHEN_SINK, "workforce", "flows", "workers", `${fixture.kind}.ts`);

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
 * wiring would actually take: importing the kind module binds it to an
 * identifier, and `{ [deskClerk.kind]: deskClerk }` registers it without the
 * quoted name ever appearing. The specifier `"./flows/workers/desk-clerk"`
 * does not contain the substring `"desk-clerk"` — the quote characters are in
 * the wrong places — so a grep for the token walks straight past it.
 *
 * Covers `from "x"`, a bare `import "x"`, `import("x")` and `require("x")`.
 * Relative and `@/`-aliased specifiers are resolved against the app; a bare
 * package name is skipped, since nothing publishes this kind. Extensions are
 * dropped on both sides because the app's imports are written without them.
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

/** The `desk:` a seat's own `WORKER.md` declares — the value the answer must carry. */
function declaredDesk(seatId: string): string {
  const [team, worker] = seatId.split(".");
  const path = join(KITCHEN_SINK, "workforce", "teams", team ?? "", "workers", worker ?? "", "WORKER.md");
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  const desk = /^desk:\s*(.+)$/m.exec(front)?.[1]?.trim();
  if (desk === undefined) throw new Error(`${seatId}: its WORKER.md declares no desk: — ${path}`);
  return desk;
}

/**
 * The flow index's status, or `undefined` when nothing answered at all.
 *
 * The two callers below want different things from this and must not share a
 * predicate. Refusing to start wants ANY answer — something holding the port
 * is a reason to stop whatever it is replying. Readiness wants a 200
 * specifically: a process that answers 4xx/5xx is listening but not serving,
 * and treating that as ready is how a run grades a server it did not build —
 * the exact false pass the refusal below exists to prevent, in a weaker form.
 */
async function flowIndexStatus(): Promise<number | undefined> {
  try {
    return (await fetch(`${ORIGIN}/api/flows`)).status;
  } catch {
    return undefined;
  }
}

/** Whether anything is already answering on the goal's port. */
async function portInUse(): Promise<boolean> {
  return (await flowIndexStatus()) !== undefined;
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

/**
 * Run a seat's `answer` action over the public HTTP route and return the text
 * it put on the wire.
 *
 * Read off the inline SSE stream the action route returns for an
 * `Accept: text/event-stream` POST — the same stream a browser client reads,
 * so nothing here is a back channel the app does not otherwise expose.
 */
async function answerOf(seatId: string): Promise<string> {
  const created = await fetch(`${ORIGIN}/api/flows/${seatId}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: fixture.userId }),
  });
  if (!created.ok) throw new Error(`${seatId}: creating a session returned ${created.status}`);
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;

  const res = await fetch(`${ORIGIN}/api/flows/${seatId}/${sessionId}/actions/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ userId: fixture.userId, input: { note: fixture.note } }),
  });
  if (!res.ok) throw new Error(`${seatId}: its answer action returned ${res.status}`);

  let said = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6)) as {
      type: string;
      item?: { type: string; content?: { text?: string }[] };
    };
    if (event.type !== "item.done" || event.item?.type !== "message") continue;
    said = event.item.content?.map((part) => part.text ?? "").join("") ?? "";
  }
  return said;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- (a) the generated module's imports survive a production build -------
  //
  // Built here rather than assumed, so the goal cannot pass against a `.next`
  // left by a previous branch.
  execFileSync("pnpm", ["build"], { cwd: KITCHEN_SINK, stdio: "inherit" });

  const control = fixture.controlKinds.map((kind) => [kind, chunksNaming(kind)] as const);
  const blind = control.filter(([, count]) => count === 0).map(([kind]) => kind);
  if (blind.length > 0) {
    // The probe found nothing where code is known to be. Every count below is
    // then meaningless, so this is reported instead of the workforce's zeros.
    failures.push(
      `the build-output probe is blind: the hand-wired ${blind.join(", ")} appear in 0 compiled chunks, ` +
        `so a 0 for the workforce would not mean it was left out`
    );
  } else {
    for (const token of [fixture.kind, fixture.block]) {
      const count = chunksNaming(token);
      if (count === 0) {
        failures.push(
          `"${token}" appears in 0 compiled chunks under .next — the generated module's imports never reached ` +
            `the bundle, so nothing in the built app can serve it`
        );
      }
    }
    evidence.push(
      `compiled chunks naming each kind: ` +
        [...control, [fixture.kind, chunksNaming(fixture.kind)] as const, [fixture.block, chunksNaming(fixture.block)] as const]
          .map(([kind, count]) => `${kind}=${count}`)
          .join(", ")
    );
  }

  // ---- (b) each seat answers with the desk its OWN file declared -----------
  let server: ChildProcess | undefined;
  try {
    // Refuse to start beside something already listening. `next start` would
    // fail to bind and this check would then grade whatever IS answering —
    // most reachably a server a previous run left behind, built from a
    // different tree. That is a pass with no relationship to the build above.
    if (await portInUse()) {
      throw new Error(
        `something is already answering on ${ORIGIN}; stop it first, or this check would grade it ` +
          `instead of the build it just made`
      );
    }
    // Detached, so the kill below reaches the whole process group. `pnpm start`
    // is a shim that execs `next start` as a child: signalling only the shim
    // leaves the server running and the next run grading a stale artifact.
    server = spawn("pnpm", ["start"], {
      cwd: KITCHEN_SINK,
      env: { ...process.env, PORT: String(fixture.port) },
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    await waitForServer();

    const seen: Record<string, string> = {};
    for (const seatId of fixture.seats) {
      const desk = declaredDesk(seatId);
      const said = await answerOf(seatId);
      seen[seatId] = said;
      if (said === "") {
        failures.push(`${seatId}: answered nothing over the HTTP route`);
      } else if (!said.includes(desk)) {
        failures.push(`${seatId}: its WORKER.md declares desk "${desk}", but it answered ${JSON.stringify(said)}`);
      }
    }

    // Two seats, one kind. Equal answers would pass every check above while
    // meaning the configuration came from somewhere other than their files.
    const answers = fixture.seats.map((seatId) => seen[seatId] ?? "");
    if (answers.length > 1 && new Set(answers).size === 1) {
      failures.push(
        `both seats answered ${JSON.stringify(answers[0])} — they sit on one kind, so an identical answer means ` +
          `they are running one shared configuration rather than their own files`
      );
    }
    evidence.push(
      `over ${ORIGIN} against the built app: ` +
        fixture.seats.map((seatId) => `${seatId} said ${JSON.stringify(seen[seatId] ?? "")}`).join(", ")
    );
  } finally {
    if (server?.pid !== undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  // ---- (c) nothing in the app registers the kind by hand -------------------
  //
  // The generated module is excluded because it IS the sanctioned route, and
  // the kind's own module because `kind: "desk-clerk"` there is the flow naming
  // itself — neither is a second place the app had to be edited.
  const sources = walk(
    KITCHEN_SINK,
    (name) => name === "node_modules" || name === ".next" || name === ".fsdev"
  ).filter((path) => /\.(ts|tsx|mts|mjs|js|jsx)$/.test(path));
  const registrars = sources
    .filter((path) => path !== GEN_MODULE && path !== KIND_MODULE)
    .map((path) => {
      const text = readFileSync(path, "utf8");
      const routes: string[] = [];
      if (text.includes(`"${fixture.kind}"`)) routes.push("names it");
      if (importsModule(path, text, KIND_MODULE)) routes.push("imports its module");
      return routes.length > 0 ? `${relative(KITCHEN_SINK, path)} (${routes.join(", ")})` : undefined;
    })
    .filter((found): found is string => found !== undefined);
  if (registrars.length > 0) {
    failures.push(
      `the kind is reached outside the generated module, so it does not come from files alone: ` +
        registrars.join(", ")
    );
  }
  evidence.push(
    `${sources.length} source files scanned under apps/kitchen-sink for both routes to the kind — the ` +
      `literal "${fixture.kind}" and an import of its module — and the only file taking either is ` +
      `workforce.gen.ts (the kind's own module is itself)`
  );

  return { failures, evidence: evidence.join("; ") };
});
