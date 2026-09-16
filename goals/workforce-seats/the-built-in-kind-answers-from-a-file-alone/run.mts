/**
 * Goal check — a worker file alone hires the built-in kind, and it answers.
 *
 * The epic's promise is that describing a worker in Markdown gives you a
 * working worker. The unit specs prove the body ARRIVES as a setting; a mocked
 * generator cannot prove the model ever saw it, because the mock supplies the
 * answer the assertion wants. This is the only place that claim is made.
 *
 * Four legs, mapping to the worker-kind contract's acceptance criteria 1-3
 * (`docs/architecture/workforce-default-worker-kind.md`):
 *
 *   0  fixture integrity — the tree and input.json agree, before any model call
 *   a  C1: two worker files hire with NO `kinds` argument, and register
 *   b  C2: each seat's reply is steered by ITS OWN body, not its neighbour's
 *   c  C3: a mixed roster with one unregistered kind refuses, and nothing hires
 *
 * The harness owns the real path and reports raw observations; this file owns
 * every assertion. See goal.md for the contract and the anti-game.
 *
 * Run: pnpm tsx goals/workforce-seats/the-built-in-kind-answers-from-a-file-alone/run.mts
 */
import { readFileSync } from "node:fs";
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
  loadErrors: unknown[];
  skillErrors: unknown[];
  rosterIds: string[];
  rosterBodies: Record<string, string>;
  seatIds: string[];
  registered: string[];
  attempts: Array<Record<string, string>>;
  mixedRosterIds: string[];
  refusal: { threw: boolean; message: string; returnedSeatIds: string[] | null };
  validWorkerStatusAfterRefusal: number;
}

const fixture = loadFixture<Fixture>(import.meta.url);

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
    if (!text.includes(`description: ${worker.description}`)) {
      failures.push(`${worker.id}: its WORKER.md description and input.json have drifted`);
    }
    // The token must be reachable ONLY through this worker's own file, or
    // leg (b) grades something the fixture handed to both seats.
    for (const other of fixture.workers) {
      if (other.id !== worker.id && text.includes(other.token)) {
        failures.push(`${worker.id}: its WORKER.md also carries ${other.id}'s token ${other.token}`);
      }
    }
  }
  return failures;
}

/**
 * Leg 0, half two — the hire call itself passes no `kinds`.
 *
 * Read statically off the harness source, because a runtime report could only
 * say what the harness chose to say. Passing a `kinds` map would prove nothing
 * about the built-in, which is the whole subject.
 */
function hireCallPassesNoKinds(): string[] {
  const source = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
  const calls = [...source.matchAll(/hireWorkforce\s*\(([\s\S]{0,200}?)\)\s*[;:\n]/g)].map((m) =>
    m[1].replace(/\s+/g, " ").trim(),
  );
  if (calls.length === 0) {
    return ["the harness contains no hireWorkforce call — the check is not driving the subject"];
  }
  const withKinds = calls.filter((args) => args.includes("kinds"));
  return withKinds.length > 0
    ? [`the harness passes a kinds argument (${withKinds.join(" | ")}), which proves nothing about the built-in`]
    : [];
}

/** Case- and separator-insensitive: `HALYARD-6182`, `Halyard 6182`, `halyard6182`. */
function carriesToken(reply: string, token: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(reply).includes(norm(token));
}

await runGoal(() => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- leg 0 -------------------------------------------------------------
  failures.push(...fixtureDrift(), ...hireCallPassesNoKinds());
  if (failures.length > 0) {
    return { failures, evidence: "stopped at leg 0 — no model call was spent" };
  }
  evidence.push("leg 0: the fixture tree matches input.json and the hire passes no `kinds`");

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
      GOAL_WORKFORCE_DIR: fixturePath(import.meta.url, "workforce"),
      GOAL_MIXED_DIR: fixturePath(import.meta.url, "mixed-roster"),
    },
  });

  if (o.ok !== true) {
    return { failures: ["the harness did not complete"], evidence: "" };
  }
  if (o.loadErrors.length > 0 || o.skillErrors.length > 0) {
    // A seat that failed to load is not a seat; grading a partially-read roster
    // would report on workers nobody has.
    failures.push(
      `the loader reported errors: ${JSON.stringify({ errors: o.loadErrors, skillErrors: o.skillErrors })}`,
    );
  }

  const expected = fixture.workers.map((w) => w.id).sort();

  // ---- leg (a): C1 — hires from files alone, with no kinds ---------------
  {
    const seats = [...o.seatIds].sort();
    if (JSON.stringify(seats) !== JSON.stringify(expected)) {
      failures.push(`hired ${JSON.stringify(seats)}, wanted ${JSON.stringify(expected)}`);
    }
    const registered = [...o.registered].sort();
    if (JSON.stringify(registered) !== JSON.stringify(expected)) {
      failures.push(`registered ${JSON.stringify(registered)}, wanted ${JSON.stringify(expected)}`);
    }
    if (failures.length === 0) {
      evidence.push(`leg (a): ${seats.join(", ")} hired from files alone with no \`kinds\`, and registered`);
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

    // THE load-bearing assertion. A partial hire returns an array containing
    // the valid seat instead of throwing, and turns this red.
    if (!o.refusal.threw) {
      failures.push(
        `leg (c): the hire returned ${JSON.stringify(o.refusal.returnedSeatIds)} instead of refusing — ` +
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
        `leg (c): the valid worker ${validId} answered ${o.validWorkerStatusAfterRefusal} on a host built ` +
          `from what came back — a seat was registered anyway`,
      );
    }

    if (o.refusal.threw && failures.length === 0) {
      evidence.push(
        `leg (c): a mixed roster (${validId} valid, ${invalidId} naming "${invalidKind}") refused by name, ` +
          `listing "${builtInKind}", returning nothing — the valid worker's address 404s`,
      );
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
