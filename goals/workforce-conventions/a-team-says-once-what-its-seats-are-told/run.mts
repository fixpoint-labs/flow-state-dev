/**
 * Goal check — a team says once what all its seats are told, and only its own.
 *
 * A workforce tree with two teams, one carrying a `TEAM.md` and one not, read
 * by the real loader. Three seats of a non-agent kind are hired from it and run
 * an action to completion through the real HTTP router. A block NESTED inside
 * that action reads `ctx.flow.config.teamInstructions` and
 * `ctx.flow.config.instructions`, and what it saw is read back through `/state`
 * after the stores are closed and the host rebuilt.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-conventions/a-team-says-once-what-its-seats-are-told/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { hireWorkforce, type HireOptions } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  fixtureDir,
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides
} from "../../lib/index.mts";
import { TRIAGE_KIND, triageFlow } from "./fixtures/flows";

type SeatFixture = { id: string; desk: string; own: string };
type Side = { team: string; seats: SeatFixture[] };
type Fixture = {
  userId: string;
  note: string;
  teamLayer: string;
  teamDescription: string;
  withLayer: Side;
  withoutLayer: Side;
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const allSeats = [...fixture.withLayer.seats, ...fixture.withoutLayer.seats];

const kinds: HireOptions["kinds"] = { [TRIAGE_KIND]: triageFlow as never };

const tree = (name: string): string => join(fixtureDir(import.meta.url), name);

function host(stores: StoreRegistry, flows: FlowInstance[]) {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function act(router: Router, address: string, sessionId: string): Promise<Response> {
  const path = [address, sessionId, "actions", "run"];
  return router.POST(
    new Request(`http://goal/api/flows/${path.join("/")}`, {
      method: "POST",
      body: JSON.stringify({ userId: fixture.userId, input: { note: fixture.note } })
    }),
    { params: { path } }
  );
}

/** What a seat's NESTED block actually ran on, through the public `/state` route. */
async function ranOn(router: Router, sessionId: string) {
  const path = ["sessions", sessionId, "state"];
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
    params: { path }
  });
  const body = (await res.json()) as {
    clientData?: {
      session?: {
        ran?: {
          team?: string | null;
          teamKeyPresent?: boolean | null;
          own?: string | null;
          desk?: string | null;
          runs?: number;
        };
      };
    };
  };
  return { status: res.status, ...(body.clientData?.session?.ran ?? {}) };
}

async function settled(stores: StoreRegistry, requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

const sessionOf = (id: string): string => `s_${id.replace(".", "_")}`;

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-team-instructions-"));
  const dbFile = join(dir, "goal.db");

  // ---- (a) the real loader reads the tree, and the real factory hires it ---
  const { workers, errors, skillErrors, teams, teamErrors } = await readWorkforce(tree("workforce"));
  if (errors.length > 0) {
    failures.push(`the loader reported ${errors.length} error(s): ${JSON.stringify(errors)}`);
  }
  if (skillErrors.length > 0) {
    failures.push(`the loader reported skill errors: ${JSON.stringify(skillErrors)}`);
  }
  if (teamErrors.length > 0) {
    failures.push(`the loader reported team errors: ${JSON.stringify(teamErrors)}`);
  }
  if (workers.length !== allSeats.length) {
    failures.push(`the tree produced ${workers.length} record(s), wanted ${allSeats.length}`);
  }

  // The team with a file produces a record; the one without produces none —
  // absent from the list, not present-and-empty.
  if (JSON.stringify(teams.map((team) => team.id)) !== JSON.stringify([fixture.withLayer.team])) {
    failures.push(
      `teams came back as ${JSON.stringify(teams.map((t) => t.id))}, wanted only "${fixture.withLayer.team}"`
    );
  }
  // The description is read rather than validated and dropped. Nothing else
  // consumes it yet, so if it is not asserted here it is not asserted anywhere.
  if (teams[0]?.description !== fixture.teamDescription) {
    failures.push(
      `the team's description came back as ${JSON.stringify(teams[0]?.description)}, wanted ${JSON.stringify(fixture.teamDescription)}`
    );
  }

  const seats = hireWorkforce(workers, { kinds });
  if (seats.length !== allSeats.length) {
    failures.push(`hired ${seats.length} seat(s), wanted ${allSeats.length}`);
  }
  evidence.push(
    "the real loader read a tree of two teams — one with a TEAM.md, one without — and one hireWorkforce call turned all three records into seats of a kind with no model in it"
  );

  // ---- (b) each seat RUNS, and its nested block reads both layers ----------
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);
    for (const seat of allSeats) {
      const res = await act(router, seat.id, sessionOf(seat.id));
      const body = (await res.json()) as { request?: { id: string } };

      // One failure per thing that actually went wrong. A rejected action has
      // no request to wait on, so polling anyway would report a second,
      // invented failure beside the real one.
      if (res.status !== 202) {
        failures.push(`${seat.id}: expected 202 from its own address, got ${res.status}`);
        continue;
      }
      const requestId = body.request?.id;
      if (requestId === undefined) {
        failures.push(`${seat.id}: accepted with 202 but the response carried no request id`);
        continue;
      }

      const status = await settled(stores, requestId);
      if (status !== "completed") failures.push(`${seat.id}: request ended ${String(status)}`);
    }
    evidence.push("all three seats ran an action to completion through the real HTTP route, with no model call");
  }

  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);

    // Graded from what the RUNNING BLOCK saw, never off the returned instance:
    // a bag read off `seat.config` is green for a value that never reached a
    // block. Nested rather than at the action root, because a root-only read
    // proves nothing about the context spread that carries it down.
    for (const seat of fixture.withLayer.seats) {
      const ran = await ranOn(router, sessionOf(seat.id));
      if (ran.status !== 200) failures.push(`${seat.id}: /state returned ${ran.status}`);

      // Two values, both present, neither merged. Compared to the file's exact
      // bytes, so a layer that arrived trimmed, reflowed or concatenated fails.
      if (ran.team !== fixture.teamLayer) {
        failures.push(
          `${seat.id}: its nested block saw team instructions ${JSON.stringify(ran.team)}, its team's TEAM.md wrote ${JSON.stringify(fixture.teamLayer)}`
        );
      }
      if (ran.own !== seat.own) {
        failures.push(
          `${seat.id}: its nested block saw its own instructions ${JSON.stringify(ran.own)}, its WORKER.md wrote ${JSON.stringify(seat.own)}`
        );
      }
      // Merged-into-one is the failure a two-field check would otherwise miss
      // if both fields happened to carry the same joined string.
      if (ran.own !== null && ran.team !== null && ran.own === ran.team) {
        failures.push(`${seat.id}: both settings carried the same value — one merged layer, not two`);
      }
      if (ran.desk !== seat.desk) {
        failures.push(`${seat.id}: its nested block saw desk ${String(ran.desk)}, wanted ${seat.desk}`);
      }
      if (ran.runs !== 1) failures.push(`${seat.id}: ran ${String(ran.runs)} times`);
    }
    evidence.push(
      "after closing the store and rebuilding the host, both seats on the team with a TEAM.md show their team's instructions AND their own, as two separate values read off ctx.flow.config inside a nested block"
    );

    // ---- (c) the sibling team's seat carries NO layer, and none of theirs --
    //
    // One shared bag is always right for somebody, so the sibling's value is
    // asserted ABSENT as well as the others' present. Absence is checked on the
    // KEY, not on the value: a `teamInstructions: ""` would read back as a
    // falsy value and slip past a truthiness check, and empty-not-absent is
    // precisely what this feature promises never to do.
    for (const seat of fixture.withoutLayer.seats) {
      const ran = await ranOn(router, sessionOf(seat.id));
      if (ran.status !== 200) failures.push(`${seat.id}: /state returned ${ran.status}`);

      if (ran.teamKeyPresent !== false) {
        failures.push(
          `${seat.id}: its team wrote no TEAM.md, but the key was present in its bag (saw ${JSON.stringify(ran.team)})`
        );
      }
      if (ran.team !== null) {
        failures.push(
          `${seat.id}: holds team instructions ${JSON.stringify(ran.team)} from a team that wrote none`
        );
      }
      // Its own instructions are untouched — the off-state adds no layer and
      // takes nothing away.
      if (ran.own !== seat.own) {
        failures.push(
          `${seat.id}: its nested block saw its own instructions ${JSON.stringify(ran.own)}, its WORKER.md wrote ${JSON.stringify(seat.own)}`
        );
      }
    }
    evidence.push(
      "the seat on the team with no TEAM.md carries no teamInstructions key at all — absent, not empty — and its own instructions are unchanged"
    );

    // ---- (d) control: the key is present for the seats that should have it -
    //
    // (c) on its own is equally consistent with the key never being imposed for
    // anybody, which would pass every absence check in this file. So the
    // positive half of the same property is asserted explicitly.
    for (const seat of fixture.withLayer.seats) {
      const ran = await ranOn(router, sessionOf(seat.id));
      if (ran.teamKeyPresent !== true) {
        failures.push(
          `${seat.id}: its team wrote a TEAM.md, but the key was absent from its bag`
        );
      }
    }
    evidence.push(
      "and the same key IS present for the seats whose team wrote one, so the absence above is about that team and not about a key nobody ever receives"
    );
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
