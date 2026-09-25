/**
 * Goal check — a package in a worker's folder reaches that worker, and no
 * sibling of the same kind.
 *
 * Three seats of the built-in agent kind, differing only in their folders:
 * `iris` holds a package (a PACKAGE.md and one block), `otto` holds nothing,
 * and `tess` holds the same package but writes `tools: []`. Each is asked the
 * same question on a real model.
 *
 * Three legs:
 *
 *   0  fixture integrity — the tree, the generated module and input.json
 *      agree, before any model call is spent
 *   a  the loader and the hire — each seat holds what its folder holds, and
 *      the generated module carries the package blocks the command found
 *   b  the model's side — the holder says the package's token and calls its
 *      tool; the sibling does neither; the `tools: []` holder says the token
 *      and calls nothing
 *
 * The harness owns the real path and reports raw observations; this file owns
 * every assertion. See goal.md for the contract and the anti-game.
 *
 * Run: pnpm tsx goals/workforce-packages/a-held-package-reaches-one-worker/run.mts
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KITCHEN_SINK,
  REPO_ROOT,
  RUN_STAMP,
  fixturePath,
  gatewayModel,
  goalAttempts,
  goalModel,
  loadFixture,
  runGoal,
  runHarness,
} from "../../lib/index.mts";

// The harness builds its own gateway-bound resolver, so the id names the gateway.
const MODEL = goalModel(gatewayModel());
const ATTEMPTS = goalAttempts(3);

/**
 * Which perturbation to run, if any. Each must FAIL; see goal.md → Controls.
 *
 *   move-to-sibling  moves the holder's package folder into the sibling's
 *                    folder in a scratch copy of the tree and re-runs the real
 *                    `fsdev gen` on it. The legs should swap.
 *   drop-tools-line  the harness deletes the `tools: []` holder's `tools` key
 *                    before hiring, the shape of a kind that ignored the line.
 *                    That seat should then call.
 */
const CONTROL = process.env.GOAL_CONTROL ?? "";

interface Seat {
  id: string;
  holds: boolean;
  canCall: boolean;
}
interface Fixture {
  userId: string;
  question: string;
  packagePath: string;
  movedTo: string;
  instructionToken: string;
  receiptToken: string;
  seats: Seat[];
}

interface Turn {
  reply: string;
  calls: number;
}
interface Observation {
  ok: boolean;
  model: string;
  loadErrors: unknown[];
  packageErrors: unknown[];
  held: Record<string, string[]>;
  generatedPackages: Record<string, string[]>;
  seatIds: string[];
  attempts: Array<Record<string, Turn>>;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const TREE = fixturePath(import.meta.url, "workforce");
const CLI = join(REPO_ROOT, "packages", "cli", "src", "bin.ts");

/** Case- and separator-insensitive: `MARIGOLD-4417`, `marigold 4417`. */
function carries(reply: string, token: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(reply).includes(norm(token));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** The `key: value` lines between a WORKER.md's first two `---` fences. */
function frontmatter(text: string): string {
  return text.split(/^---$/m)[1] ?? "";
}

/**
 * Leg 0 — the tree and input.json, in THIS process, before a model call.
 *
 * Each clause is a way leg (b) could go green for the wrong reason: a token
 * written somewhere other than the package, a question that already carries
 * it, a seat whose own file grants or withholds tools other than input.json
 * says, or a generated module older than the tree.
 */
function fixtureDrift(): string[] {
  const failures: string[] = [];
  const files = filesUnder(TREE).filter((path) => !path.endsWith("workforce.gen.ts"));

  const tokenHomes: Array<[string, RegExp]> = [
    [fixture.instructionToken, /\/packages\/[^/]+\/PACKAGE\.md$/],
    [fixture.receiptToken, /\/packages\/[^/]+\/blocks\/[^/]+\.ts$/],
  ];
  for (const [token, home] of tokenHomes) {
    for (const path of files) {
      const count = readFileSync(path, "utf8").split(token).length - 1;
      const rel = relative(TREE, path);
      if (home.test(path) ? count !== 1 : count !== 0) {
        failures.push(`${token} appears ${count} times in ${rel}`);
      }
    }
    if (carries(fixture.question, token)) {
      failures.push(`the question already carries ${token}, so every seat could echo it`);
    }
  }

  for (const seat of fixture.seats) {
    const [team, name] = seat.id.split(".");
    const folder = join(TREE, "teams", team!, "workers", name!);
    const declared = frontmatter(readFileSync(join(folder, "WORKER.md"), "utf8"));
    const hasPackage = existsSync(join(folder, "packages"));
    if (hasPackage !== seat.holds) {
      failures.push(`${seat.id}: input.json says holds=${seat.holds}, its folder says ${hasPackage}`);
    }
    // A holder that can call is one with NO tools line; a holder that cannot
    // is one whose line is `tools: []`. Any other line would change what is
    // being tested.
    const toolsLine = /^tools:\s*(.*)$/m.exec(declared)?.[1]?.trim();
    const expectedLine = seat.holds && !seat.canCall ? "[]" : undefined;
    if (toolsLine !== expectedLine) {
      failures.push(
        `${seat.id}: its WORKER.md writes tools: ${toolsLine ?? "(no line)"}, wanted ${expectedLine ?? "(no line)"}`,
      );
    }
    if (/^packages:/m.test(declared)) {
      failures.push(`${seat.id}: its WORKER.md names packages, but this goal is about the folder alone`);
    }
  }

  try {
    execFileSync("pnpm", ["-s", "tsx", CLI, "gen", "--root", TREE, "--check"], { stdio: "pipe" });
  } catch (error) {
    failures.push(`the committed workforce.gen.ts is not what \`fsdev gen\` renders from the tree: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  return failures;
}

/** Copy the tree beside this file, move the package to the sibling, and regenerate. */
function movedTree(): { root: string; cleanup: () => void } {
  // Inside goals/, not /tmp: the block files import `@flow-state-dev/core`,
  // which only resolves from under the workspace.
  const scratch = join(dirname(fileURLToPath(import.meta.url)), `.control-${RUN_STAMP}`);
  const root = join(scratch, "workforce");
  mkdirSync(scratch, { recursive: true });
  cpSync(TREE, root, { recursive: true });
  mkdirSync(dirname(join(root, fixture.movedTo)), { recursive: true });
  renameSync(join(root, fixture.packagePath), join(root, fixture.movedTo));
  rmSync(join(root, dirname(fixture.packagePath)), { recursive: true, force: true });
  execFileSync("pnpm", ["-s", "tsx", CLI, "gen", "--root", root], { stdio: "pipe" });
  return { root, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

await runGoal(() => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- leg 0 -------------------------------------------------------------
  failures.push(...fixtureDrift());
  if (failures.length > 0) {
    return { failures, evidence: "stopped at leg 0: no model call was spent" };
  }
  evidence.push("leg 0: the tree, input.json and the generated module agree");

  const tree = CONTROL === "move-to-sibling" ? movedTree() : { root: TREE, cleanup: () => {} };
  let o: Observation;
  try {
    const token = fixture.instructionToken;
    o = runHarness<Observation>({
      app: KITCHEN_SINK,
      harness: new URL("./harness.mts", import.meta.url),
      env: {
        FSD_ENV: "dev",
        GOAL_MODEL: MODEL,
        GOAL_ATTEMPTS: String(ATTEMPTS),
        GOAL_USER_ID: fixture.userId,
        GOAL_QUESTION: fixture.question,
        GOAL_WORKFORCE_DIR: tree.root,
        GOAL_GEN_MODULE: join(tree.root, "workforce.gen.ts"),
        GOAL_TOKEN: token,
        GOAL_CONTROL: CONTROL,
        // The harness's stopping rule only; every verdict is reached below.
        GOAL_EXPECT: JSON.stringify(
          Object.fromEntries(fixture.seats.map((s) => [s.id, [s.holds, s.holds && s.canCall]])),
        ),
      },
    });
  } finally {
    tree.cleanup();
  }

  if (o.ok !== true) return { failures: ["the harness did not complete"], evidence: "" };
  if (o.loadErrors.length > 0 || o.packageErrors.length > 0) {
    failures.push(`the loader reported errors: ${JSON.stringify({ errors: o.loadErrors, packageErrors: o.packageErrors })}`);
  }

  // ---- leg (a): each seat holds what its folder holds ---------------------
  {
    const before = failures.length;
    const expected = fixture.seats.map((s) => s.id).sort();
    if (JSON.stringify([...o.seatIds].sort()) !== JSON.stringify(expected)) {
      failures.push(`hired ${JSON.stringify(o.seatIds)}, wanted ${JSON.stringify(expected)}`);
    }
    for (const seat of fixture.seats) {
      const held = o.held[seat.id] ?? [];
      if (held.length > 0 !== seat.holds) {
        failures.push(`leg (a): ${seat.id} reached the hire holding ${JSON.stringify(held)}, input.json says holds=${seat.holds}`);
      }
      for (const address of held) {
        if (!(o.generatedPackages[address] ?? []).includes("stamp-ticket")) {
          failures.push(`leg (a): the generated module carries no stamp-ticket block for ${address}`);
        }
      }
    }
    if (failures.length === before) {
      evidence.push(`leg (a): held ${JSON.stringify(o.held)}; the generated module carries ${Object.keys(o.generatedPackages).length} package address(es)`);
    }
  }

  // ---- leg (b): what each seat said and called ---------------------------
  {
    // Graded as a SET. One shared kind and one shared question is always right
    // for somebody; the holder's call means something only beside a sibling
    // of the same kind that makes none, and a `tools: []` holder that has the
    // text and still makes none.
    const graded = o.attempts.map((turns) => {
      const problems: string[] = [];
      for (const seat of fixture.seats) {
        const turn = turns[seat.id];
        if (turn === undefined || turn.reply.trim() === "") {
          problems.push(`${seat.id} produced no reply`);
          continue;
        }
        const said = carries(turn.reply, fixture.instructionToken);
        const shouldCall = seat.holds && seat.canCall;
        const quote = JSON.stringify(turn.reply.slice(0, 160));
        if (said !== seat.holds) {
          problems.push(
            seat.holds
              ? `${seat.id} holds the package and did not follow its instruction (no ${fixture.instructionToken}): ${quote}`
              : `${seat.id} holds nothing and said ${fixture.instructionToken}: ${quote}`,
          );
        }
        if (turn.calls > 0 !== shouldCall) {
          problems.push(
            shouldCall
              ? `${seat.id} holds the package and made no stamp-ticket call: ${quote}`
              : `${seat.id} made ${turn.calls} stamp-ticket call(s) and should make none`,
          );
        }
        // The receipt only the tool returns. A holder that called and did not
        // pass it on followed half the instruction; anyone else carrying it
        // got it by a route other than a call.
        if (carries(turn.reply, fixture.receiptToken) !== shouldCall) {
          problems.push(
            shouldCall
              ? `${seat.id} did not give the receipt ${fixture.receiptToken} only a call returns: ${quote}`
              : `${seat.id} gave the receipt ${fixture.receiptToken} without being able to call: ${quote}`,
          );
        }
      }
      return problems;
    });

    const passing = graded.findIndex((p) => p.length === 0);
    if (passing === -1) {
      failures.push(
        `leg (b): no attempt had every seat acting on its own folder. ` +
          graded.map((p, i) => `attempt ${i + 1}: ${p.join("; ")}`).join(" | "),
      );
    } else {
      const turns = o.attempts[passing]!;
      evidence.push(
        `leg (b): on attempt ${passing + 1} of ${o.attempts.length}, ` +
          fixture.seats
            .map((s) => `${s.id} made ${turns[s.id]!.calls} call(s) and said ${JSON.stringify(turns[s.id]!.reply.slice(0, 100))}`)
            .join("; "),
      );
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
