/**
 * Goal check — a worker file alone hires the built-in kind, and it answers.
 *
 * The epic's promise is that describing a worker in Markdown gives you a
 * working worker. The unit specs prove the body ARRIVES as a setting; a mocked
 * generator cannot prove the model ever saw it, because the mock supplies the
 * answer the assertion wants. This is the only place that claim is made.
 *
 * Four legs, mapping to the worker-kind contract's acceptance criteria 1-3
 * (`docs/architecture/workforce-default-worker-flow.md`):
 *
 *   0  fixture integrity — the tree and input.json agree, before any model call
 *   a  C1: two worker files hire onto the built-in, from an installation given no worker flow
 *   b  C2: each seat's reply is steered by ITS OWN body, not its neighbour's
 *   c  C3: a mixed roster with one unregistered kind refuses, and nothing hires
 *
 * The harness owns the real path and reports raw observations; this file owns
 * every assertion. See goal.md for the contract and the anti-game.
 *
 * Run: pnpm tsx goals/workforce-workers/the-built-in-kind-answers-from-a-file-alone/run.mts
 */
import { readFileSync } from "node:fs";
import { ROSTER_FLOW } from "@flow-state-dev/workforce/browser";
import {
  KITCHEN_SINK,
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

/** Which harness perturbation to run, if any. Empty means the real check. */
const CONTROL = process.env.GOAL_CONTROL ?? "";

interface Fixture {
  userId: string;
  question: string;
  workers: Array<{ id: string; description: string; token: string; body: string }>;
  mixedRoster: { validId: string; invalidId: string; invalidKind: string; builtInKind: string };
}

interface Observation {
  ok: boolean;
  control: string | null;
  model: string;
  rosterIds: string[];
  rosterBodies: Record<string, string>;
  /** Each worker the installation holds, and the flow it runs on. */
  seats: Array<{ id: string; kind: string }>;
  /** The copies the workforce kit registered, by id. */
  registered: string[];
  attempts: Array<Record<string, string>>;
  mixedRosterIds: string[];
  refusal: { threw: boolean; message: string; returnedCopyIds: string[] | null };
  validWorkerStatusAfterRefusal: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);

/** The `key: value` lines between a WORKER.md's first two `---` fences. */
function frontmatter(text: string): Record<string, string> {
  const block = text.split(/^---$/m)[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * Leg 0, half one — the fixture tree against input.json, whole values.
 *
 * Runs in THIS process, before the harness spends a model call, so a drifted
 * fixture is caught for free. Compared whole rather than by `includes`: a
 * drifted value often contains the expected one as a prefix.
 */
function fixtureDrift(): string[] {
  const failures: string[] = [];
  for (const worker of fixture.workers) {
    const [team, name] = worker.id.split(".");
    const path = fixturePath(
      import.meta.url,
      `workforce/teams/${team}/workers/${name}/WORKER.md`,
    );
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      failures.push(`${worker.id}: no WORKER.md at ${path}`);
      continue;
    }
    const body = text.split(/^---$/m).slice(2).join("---").trim();
    if (body !== worker.body.trim()) {
      failures.push(
        `${worker.id}: its WORKER.md body and input.json have drifted.\n` +
          `  file:       ${JSON.stringify(body)}\n` +
          `  input.json: ${JSON.stringify(worker.body.trim())}`,
      );
    }
    const declared = frontmatter(text).description;
    if (declared !== worker.description) {
      failures.push(
        `${worker.id}: its WORKER.md description and input.json have drifted.\n` +
          `  file:       ${JSON.stringify(declared ?? null)}\n` +
          `  input.json: ${JSON.stringify(worker.description)}`,
      );
    }
    // The token must be reachable ONLY through this worker's own file, or
    // leg (b) grades something the fixture handed to both seats — whether by
    // a sibling's file or by the question every seat is asked.
    if (carriesToken(fixture.question, worker.token)) {
      failures.push(
        `${worker.id}: the question already carries its token ${worker.token}, so every seat would echo it`,
      );
    }
    for (const other of fixture.workers) {
      if (other.id !== worker.id && text.includes(other.token)) {
        failures.push(`${worker.id}: its WORKER.md also carries ${other.id}'s token ${other.token}`);
      }
    }
  }
  return failures;
}

/**
 * Leg 0, half one-and-a-half — the mixed-roster tree leg (c) refuses over.
 *
 * Leg (c) only tests all-or-nothing admission if the roster really is mixed:
 * one worker naming a kind nobody registered, beside one that hires on the
 * built-in. Neither property survives into the refusal message, so a tree
 * edited to name only registered kinds would turn leg (c) green having
 * refused for some other reason — or not refused at all.
 */
function mixedRosterDrift(): string[] {
  const { validId, invalidId, invalidKind, builtInKind } = fixture.mixedRoster;
  const wanted: Array<[string, string]> = [
    [validId, builtInKind],
    [invalidId, invalidKind],
  ];
  const failures: string[] = [];
  for (const [id, wantKind] of wanted) {
    const [team, name] = id.split(".");
    const path = fixturePath(
      import.meta.url,
      `mixed-roster/teams/${team}/workers/${name}/WORKER.md`,
    );
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      failures.push(`mixed roster: no WORKER.md for ${id} at ${path}`);
      continue;
    }
    // No `flow` key means the built-in kind — which is exactly what the valid
    // worker in this roster relies on. Write it out so both rows compare alike.
    const declared = frontmatter(text).flow ?? builtInKind;
    if (declared !== wantKind) {
      failures.push(
        `mixed roster: ${id} declares flow ${JSON.stringify(declared)}, wanted ` +
          `${JSON.stringify(wantKind)} — the roster leg (c) refuses over is no longer mixed`,
      );
    }
  }
  return failures;
}

/**
 * Leg 0, half two — the kit is handed the folder and nothing else: no worker
 * flow and no config.
 *
 * Read statically off the harness source, because a runtime report could only
 * say what the harness chose to say. A kit handed a worker flow would prove
 * nothing about the built-in, which is the whole subject.
 *
 * The install sits behind the harness's `installWorkers` wrapper, so the scan
 * reads inside it too: the kit's own call and every slot the harness fills.
 * Checking only the wrapper's call sites would miss a replacement `agent`
 * added inside it.
 */
function installationNamesNoFlows(source: string): string[] {
  const failures: string[] = [];
  const installs = callArguments(source, "installWorkers");
  if (installs.length === 0) {
    return ["the harness never installs the workforce kit — the check is not driving the subject"];
  }
  // The folder is the install's one argument: a second (worker flows) or a third (config) can carry a flow.
  const withArgs = installs.filter((args) => hasSecondArgument(args));
  if (withArgs.length > 0) {
    failures.push(`the harness hands the workforce kit more than its folder (${withArgs.join(" | ")}) — anything beyond the folder can carry a worker flow`);
  }
  // Inside the wrapper: the kit's config is the folder alone — `generated` can carry worker flows.
  const kits = callArguments(source, "workforce");
  if (kits.length === 0) {
    failures.push("the harness never calls the workforce kit — the check is not reading the install");
  }
  const configured = kits.filter((args) => args !== "{ directory }");
  if (configured.length > 0) {
    failures.push(`the workforce kit is configured beyond its folder (${configured.join(" | ")}) — its config can carry a worker flow`);
  }
  // And the only slot filled is `flows`, which reads the installation back: `workerFlows` replaces a kind.
  const slots = [...source.matchAll(/\bslots\.(\w+)/g)].map((m) => m[1]!).filter((name) => name !== "flows");
  if (slots.length > 0) {
    failures.push(`the harness fills the workforce kit's ${[...new Set(slots)].join(", ")} slot — a worker flow there replaces the built-in`);
  }
  return failures;
}

/**
 * The leg 0 scan, run against harness sources that hand the kit a replacement
 * `agent` by each route past the wrapper's call sites. Each must be refused;
 * one that passes means the scan stopped covering what it claims.
 */
function scanMissesReplacementAgents(source: string): string[] {
  const fill = "fill: { [workforce.slots.flows]";
  const kit = "workforce({ directory })";
  const routes: Array<[string, string]> = [
    ["a workerFlows fill inside the wrapper", source.replace(fill, "fill: { [workforce.slots.workerFlows]: { agent: replacement }, [workforce.slots.flows]")],
    ["a generated workerFlows config on the kit", source.replace(kit, "workforce({ directory, generated: { workerFlows: { agent: replacement } } })")],
  ];
  const failures: string[] = [];
  for (const [route, mutated] of routes) {
    if (mutated === source) failures.push(`leg 0 self-test: the harness no longer has the install shape to plant ${route} in — update the self-test`);
    else if (installationNamesNoFlows(mutated).length === 0) failures.push(`leg 0 self-test: the scan passed a harness with ${route}`);
  }
  return failures;
}

/** The source inside each `name(...)` call, up to its matching parenthesis, whitespace collapsed. */
function callArguments(source: string, name: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))) {
    const start = match.index! + match[0].length;
    let depth = 1;
    let at = start;
    for (; at < source.length && depth > 0; at += 1) {
      if ("([{".includes(source[at]!)) depth += 1;
      else if (")]}".includes(source[at]!)) depth -= 1;
    }
    found.push(source.slice(start, at - 1).replace(/\s+/g, " ").trim());
  }
  return found;
}

/** A comma outside every bracket in a captured argument list. */
function hasSecondArgument(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/** Case- and separator-insensitive: `HALYARD-6182`, `Halyard 6182`, `halyard6182`. */
function carriesToken(reply: string, token: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(reply).includes(norm(token));
}

await runGoal((failures) => {
  const evidence: string[] = [];

  // ---- leg 0 -------------------------------------------------------------
  const harnessSource = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
  failures.push(
    ...fixtureDrift(),
    ...mixedRosterDrift(),
    ...installationNamesNoFlows(harnessSource),
    ...scanMissesReplacementAgents(harnessSource),
  );
  if (failures.length > 0) {
    return { failures, evidence: "stopped at leg 0 — no model call was spent" };
  }
  evidence.push(
    "leg 0: both fixture trees match input.json, and the installation names no worker flow",
  );

  const o = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      FSD_ENV: "dev",
      GOAL_MODEL: MODEL,
      GOAL_ATTEMPTS: String(ATTEMPTS),
      GOAL_CONTROL: CONTROL,
      GOAL_USER_ID: fixture.userId,
      GOAL_QUESTION: fixture.question,
      // The harness stops asking once a pair comes back clean; it grades
      // nothing. Every verdict below is reached here, over every attempt.
      GOAL_TOKENS: JSON.stringify(Object.fromEntries(fixture.workers.map((w) => [w.id, w.token]))),
      GOAL_WORKFORCE_DIR: fixturePath(import.meta.url, "workforce"),
      GOAL_MIXED_DIR: fixturePath(import.meta.url, "mixed-roster"),
      GOAL_MIXED_VALID_ID: fixture.mixedRoster.validId,
    },
  });

  if (o.ok !== true) {
    return { failures: ["the harness did not complete"], evidence: "" };
  }

  const expected = fixture.workers.map((w) => w.id).sort();

  // ---- leg (a): C1 — hires from files alone, on the built-in --------------
  {
    const { builtInKind } = fixture.mixedRoster;
    const seats = o.seats.map((s) => s.id).sort();
    if (JSON.stringify(seats) !== JSON.stringify(expected)) {
      failures.push(`hired ${JSON.stringify(seats)}, wanted ${JSON.stringify(expected)}`);
    }
    for (const seat of o.seats) {
      if (seat.kind !== builtInKind) failures.push(`${seat.id} runs on "${seat.kind}", not the built-in "${builtInKind}"`);
    }
    // One copy of the built-in beside the roster flow: no worker flow of the harness's own was registered.
    const registered = [...o.registered].sort();
    const wanted = [builtInKind, ROSTER_FLOW].sort();
    if (JSON.stringify(registered) !== JSON.stringify(wanted)) {
      failures.push(`registered ${JSON.stringify(registered)}, wanted ${JSON.stringify(wanted)}`);
    }
    if (failures.length === 0) {
      evidence.push(`leg (a): ${seats.join(", ")} hired from files alone onto one registered copy of "${builtInKind}"`);
    }
  }

  // ---- leg (b): C2 — each reply steered by its OWN body ------------------
  {
    // Graded as a PAIR: one shared prompt is always right for somebody, so a
    // reply carrying its own token is only meaningful beside a sibling that
    // does not carry it.
    const attemptResults = o.attempts.map((replies) => {
      const problems: string[] = [];
      for (const worker of fixture.workers) {
        const reply = replies[worker.id] ?? "";
        if (reply.trim() === "") {
          problems.push(`${worker.id} produced no reply`);
          continue;
        }
        if (!carriesToken(reply, worker.token)) {
          problems.push(`${worker.id} did not carry its own token ${worker.token}: ${JSON.stringify(reply.slice(0, 200))}`);
        }
        for (const other of fixture.workers) {
          if (other.id !== worker.id && carriesToken(reply, other.token)) {
            problems.push(`${worker.id} carried ${other.id}'s token ${other.token}: ${JSON.stringify(reply.slice(0, 200))}`);
          }
        }
      }
      return problems;
    });

    const passing = attemptResults.findIndex((p) => p.length === 0);
    if (passing === -1) {
      failures.push(
        `leg (b): no attempt had both seats steered by their own body. ` +
          attemptResults.map((p, i) => `attempt ${i + 1}: ${p.join("; ")}`).join(" | "),
      );
    } else {
      const replies = o.attempts[passing];
      evidence.push(
        `leg (b): on attempt ${passing + 1} of ${o.attempts.length}, ` +
          fixture.workers
            .map((w) => `${w.id} answered with ${w.token} and not its sibling's`)
            .join("; ") +
          ` (${fixture.workers.map((w) => JSON.stringify((replies[w.id] ?? "").slice(0, 80))).join(" / ")})`,
      );
    }
  }

  // ---- leg (c): C3 — mixed roster refuses, and nothing hires -------------
  {
    const { validId, invalidId, invalidKind, builtInKind } = fixture.mixedRoster;

    if (!o.mixedRosterIds.includes(validId) || !o.mixedRosterIds.includes(invalidId)) {
      failures.push(
        `leg (c): the roster is not mixed — loaded ${JSON.stringify(o.mixedRosterIds)}, ` +
          `needs both ${validId} (valid) and ${invalidId} (invalid). ` +
          `A single-bad-record roster cannot show atomicity.`,
      );
    }

    // THE load-bearing assertion. A partial hire returns the copies the valid
    // worker runs on instead of throwing, and turns this red.
    if (!o.refusal.threw) {
      failures.push(
        `leg (c): the hire returned ${JSON.stringify(o.refusal.returnedCopyIds)} instead of refusing — ` +
          `a refusal after a partial hire is not a refusal`,
      );
    } else {
      for (const name of [invalidId, invalidKind, builtInKind]) {
        if (!o.refusal.message.includes(name)) {
          failures.push(`leg (c): the refusal does not name "${name}": ${o.refusal.message}`);
        }
      }
      if (o.refusal.message.includes(validId) && validId !== invalidId) {
        // The valid worker should not appear as a problem.
        const problemLines = o.refusal.message
          .split("\n")
          .filter((l) => l.includes(validId) && l.includes("—"));
        if (problemLines.length > 0) {
          failures.push(`leg (c): the valid worker ${validId} was reported as a problem: ${problemLines.join(" ")}`);
        }
      }
    }

    // Secondary, and meaningful only because the roster is mixed.
    if (o.validWorkerStatusAfterRefusal !== 404) {
      failures.push(
        `leg (c): a session with the valid worker ${validId} on "${builtInKind}" answered ` +
          `${o.validWorkerStatusAfterRefusal} on a host built from what came back — a copy was registered anyway`,
      );
    }

    if (o.refusal.threw && failures.length === 0) {
      evidence.push(
        `leg (c): a mixed roster (${validId} valid, ${invalidId} naming "${invalidKind}") refused by name, ` +
          `listing "${builtInKind}", returning nothing — a session with the valid worker 404s`,
      );
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
