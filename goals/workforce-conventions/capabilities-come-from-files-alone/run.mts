/**
 * Goal check — a capability added to a team's folder reaches the seats whose
 * own files asked for it, and no others.
 *
 * The acceptance criterion the issue owns, on the real path: one TypeScript
 * capability in a team's `resources/` folder, the command run, two seats of
 * one kind differing only in what their own files name, and each answering
 * with only what its own file gave it.
 *
 * Three legs:
 *
 *   0  fixture integrity — the tree, the generated module and input.json
 *      agree, before any model call is spent
 *   a  discovery and install — the command's module carries the capability,
 *      and it lands on the kind through `uses`
 *   b  the seat's half — the seat that named a preset answers with its fact,
 *      the seat that named nothing does not, and neither carries the preset
 *      nobody selected
 *
 * The harness owns the real path and reports raw observations; this file owns
 * every assertion. See goal.md for the contract and the anti-game.
 *
 * Run: pnpm tsx goals/workforce-conventions/capabilities-come-from-files-alone/run.mts
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

interface Seat {
  id: string;
  selects: string[];
  knows: string | null;
}
interface Fixture {
  userId: string;
  question: string;
  capability: string;
  seats: Seat[];
  unselectedPreset: string;
  unselectedToken: string;
}

interface Observation {
  ok: boolean;
  control: string | null;
  model: string;
  loadErrors: unknown[];
  skillErrors: unknown[];
  rosterIds: string[];
  selections: Record<string, Record<string, string[]> | null>;
  discoveredRefs: string[];
  installedCapabilities: string[];
  seatIds: string[];
  registered: string[];
  attempts: Array<Record<string, string>>;
}

const fixture = loadFixture<Fixture>(import.meta.url);

/** Case- and separator-insensitive: `LANTERN-2208`, `Lantern 2208`, `lantern2208`. */
function carries(reply: string, token: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(reply).includes(norm(token));
}

/** The `key: value` lines between a WORKER.md's first two `---` fences. */
function frontmatter(text: string): string {
  return text.split(/^---$/m)[1] ?? "";
}

/**
 * Leg 0 — the tree and input.json, in THIS process, before a model call.
 *
 * Every clause below is a way leg (b) could go green for the wrong reason: a
 * fact written in two places, a fact the question already carries, a seat file
 * that no longer names what input.json says it names, or a "knows nothing"
 * seat whose file quietly names something.
 */
function fixtureDrift(): string[] {
  const failures: string[] = [];

  const capabilityPath = fixturePath(
    import.meta.url,
    "workforce/teams/support/resources/research.ts",
  );
  let capabilitySource: string;
  try {
    capabilitySource = readFileSync(capabilityPath, "utf8");
  } catch {
    return [`no capability module at ${capabilityPath}`];
  }

  const tokens = [
    ...fixture.seats.map((seat) => seat.knows).filter((t): t is string => t !== null),
    fixture.unselectedToken,
  ];

  for (const token of tokens) {
    // Exactly one occurrence, in the capability and nowhere else: a fact
    // written twice could reach a seat by the other route and grade green.
    const inCapability = capabilitySource.split(token).length - 1;
    if (inCapability !== 1) {
      failures.push(`${token} appears ${inCapability} times in the capability module, wanted once`);
    }
    if (carries(fixture.question, token)) {
      failures.push(`the question already carries ${token}, so every seat could echo it`);
    }
  }

  for (const seat of fixture.seats) {
    const [team, name] = seat.id.split(".");
    const path = fixturePath(
      import.meta.url,
      `workforce/teams/${team}/workers/${name}/WORKER.md`,
    );
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      failures.push(`${seat.id}: no WORKER.md at ${path}`);
      continue;
    }
    const declared = frontmatter(text);
    for (const preset of seat.selects) {
      if (!declared.includes(preset)) {
        failures.push(
          `${seat.id}: its WORKER.md does not name preset "${preset}" that input.json says it selects`,
        );
      }
    }
    if (seat.selects.length === 0 && declared.includes("capabilities")) {
      failures.push(
        `${seat.id}: input.json says it names nothing, but its WORKER.md declares \`capabilities:\``,
      );
    }
    // A seat's own file must not carry any fact directly, or leg (b) would be
    // grading the body rather than the capability.
    for (const token of tokens) {
      if (text.includes(token)) {
        failures.push(`${seat.id}: its WORKER.md carries ${token} directly`);
      }
    }
  }

  return failures;
}

/**
 * Leg 0, half two — the harness installs what the COMMAND generated.
 *
 * Read statically off the harness source. A harness that imported the
 * capability module directly would prove nothing about the build step, and a
 * runtime report could only say what the harness chose to say.
 */
function harnessInstallsFromGeneratedModule(): string[] {
  const source = readFileSync(new URL("./harness.mts", import.meta.url), "utf8");
  const failures: string[] = [];
  if (!source.includes("splitResourceModules")) {
    failures.push("the harness does not install through `splitResourceModules` — the install half is not being driven");
  }
  if (/from\s+["'][^"']*resources\/research["']/.test(source)) {
    failures.push("the harness imports the capability module directly, bypassing the generated module");
  }
  return failures;
}

await runGoal(() => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- leg 0 -------------------------------------------------------------
  failures.push(...fixtureDrift(), ...harnessInstallsFromGeneratedModule());
  if (failures.length > 0) {
    return { failures, evidence: "stopped at leg 0 — no model call was spent" };
  }
  evidence.push("leg 0: the tree, input.json and the harness's install path agree");

  const knows = Object.fromEntries(fixture.seats.map((seat) => [seat.id, seat.knows]));

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
      GOAL_GEN_MODULE: fixturePath(import.meta.url, "workforce/workforce.gen.ts"),
      // The harness stops asking once a pair comes back clean; it grades
      // nothing. Every verdict below is reached here, over every attempt.
      GOAL_KNOWS: JSON.stringify(knows),
    },
  });

  if (o.ok !== true) {
    return { failures: ["the harness did not complete"], evidence: "" };
  }
  if (o.loadErrors.length > 0 || o.skillErrors.length > 0) {
    failures.push(
      `the loader reported errors: ${JSON.stringify({ errors: o.loadErrors, skillErrors: o.skillErrors })}`,
    );
  }

  const expected = fixture.seats.map((seat) => seat.id).sort();

  // ---- leg (a): the command found it, and it reached the kind -------------
  {
    if (!o.installedCapabilities.includes(fixture.capability)) {
      failures.push(
        `the kind installed ${JSON.stringify(o.installedCapabilities)}, which does not carry ` +
          `"${fixture.capability}" — nothing from the folder reached the worker kind`,
      );
    }
    const seats = [...o.seatIds].sort();
    if (JSON.stringify(seats) !== JSON.stringify(expected)) {
      failures.push(`hired ${JSON.stringify(seats)}, wanted ${JSON.stringify(expected)}`);
    }
    // The selection has to survive the hire. A seat whose settings lost it
    // would answer exactly like its sibling, and leg (b) could not tell that
    // apart from a broken per-seat path.
    for (const seat of fixture.seats) {
      const named = o.selections[seat.id]?.[fixture.capability] ?? [];
      if (JSON.stringify([...named].sort()) !== JSON.stringify([...seat.selects].sort())) {
        failures.push(
          `${seat.id} reached the hire naming ${JSON.stringify(named)}, its file says ` +
            `${JSON.stringify(seat.selects)}`,
        );
      }
    }
    if (failures.length === 0) {
      evidence.push(
        `leg (a): \`fsdev gen\` put ${o.discoveredRefs.join(", ")} on the generated module, ` +
          `"${fixture.capability}" reached the kind through \`uses\`, and ${seats.join(", ")} hired`,
      );
    }
  }

  // ---- leg (b): each seat answered from its own file ----------------------
  {
    // Graded as a PAIR. One shared kind and one shared question is always
    // right for somebody: a seat producing its fact is evidence only beside a
    // sibling that cannot.
    const attemptResults = o.attempts.map((replies) => {
      const problems: string[] = [];
      for (const seat of fixture.seats) {
        const reply = replies[seat.id] ?? "";
        if (reply.trim() === "") {
          problems.push(`${seat.id} produced no reply`);
          continue;
        }
        if (seat.knows !== null && !carries(reply, seat.knows)) {
          problems.push(
            `${seat.id} named preset ${JSON.stringify(seat.selects)} and did not answer with ` +
              `${seat.knows}: ${JSON.stringify(reply.slice(0, 200))}`,
          );
        }
        for (const other of fixture.seats) {
          if (other.id === seat.id || other.knows === null) continue;
          if (carries(reply, other.knows)) {
            problems.push(
              `${seat.id} answered with ${other.knows}, which only ${other.id}'s file asked for: ` +
                JSON.stringify(reply.slice(0, 200)),
            );
          }
        }
        // Nobody selected this one. A seat carrying it is a kind that
        // installed the whole capability instead of what each file named —
        // which is the shape this key exists to replace.
        if (carries(reply, fixture.unselectedToken)) {
          problems.push(
            `${seat.id} answered with ${fixture.unselectedToken}, from preset ` +
              `"${fixture.unselectedPreset}", which no seat selected: ` +
              JSON.stringify(reply.slice(0, 200)),
          );
        }
      }
      return problems;
    });

    const passing = attemptResults.findIndex((p) => p.length === 0);
    if (passing === -1) {
      failures.push(
        `leg (b): no attempt had both seats answering from their own file. ` +
          attemptResults.map((p, i) => `attempt ${i + 1}: ${p.join("; ")}`).join(" | "),
      );
    } else {
      const replies = o.attempts[passing];
      evidence.push(
        `leg (b): on attempt ${passing + 1} of ${o.attempts.length}, ` +
          fixture.seats
            .map((seat) =>
              seat.knows === null
                ? `${seat.id} named nothing and did not know it`
                : `${seat.id} named ${JSON.stringify(seat.selects)} and answered with ${seat.knows}`,
            )
            .join("; ") +
          `; neither carried ${fixture.unselectedToken} ` +
          `(${fixture.seats.map((s) => JSON.stringify((replies[s.id] ?? "").slice(0, 80))).join(" / ")})`,
      );
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
