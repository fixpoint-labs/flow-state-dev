/**
 * Goal check — a hired seat is handed the skills its files declared, on a kind
 * with no model in it.
 *
 * A workforce tree with an `org/skills/` folder, a team-level folder and a
 * worker's own is read by the real loader. Two seats of a non-agent kind are
 * hired from it and run an action to completion through the real HTTP router.
 * A block NESTED inside that action reads `ctx.flow.config.seatSkills`, and
 * what it saw is read back through `/state` after the stores are closed and the
 * host rebuilt.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/a-non-agent-seat-receives-its-skills/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { hireWorkforce, type HireOptions } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import {
  TRIAGE_KIND,
  NO_CONTRACT_KIND,
  triageFlow,
  noContractFlow
} from "./fixtures/flows";

type SeatFixture = {
  id: string;
  flow: string;
  description: string;
  desk: string;
  skills: string[];
};
type Fixture = {
  userId: string;
  note: string;
  seats: { support: SeatFixture; billing: SeatFixture };
  orgSkill: string;
  control: { dir: string; id: string; flow: string; description: string; desk: string };
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const { support, billing } = fixture.seats;

const kinds: HireOptions["kinds"] = {
  [TRIAGE_KIND]: triageFlow as never,
  // Registered so the control's refusal is about the contract it never
  // composed, not about a kind the app forgot to pass.
  [NO_CONTRACT_KIND]: noContractFlow as never
};

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
    clientData?: { session?: { ran?: { skills?: string[] | null; desk?: string | null; runs?: number } } };
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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-non-agent-skills-"));
  const dbFile = join(dir, "goal.db");
  const sessions: Record<string, string> = { [support.id]: "s_support", [billing.id]: "s_billing" };

  // ---- (a) the real loader reads the tree, and the real factory hires it ---
  const { workers, errors, skillErrors } = await readWorkforce(tree("workforce"));
  if (errors.length > 0) failures.push(`the loader reported ${errors.length} error(s): ${JSON.stringify(errors)}`);
  if (skillErrors.length > 0) failures.push(`the loader reported skill errors: ${JSON.stringify(skillErrors)}`);
  if (workers.length !== 2) failures.push(`the tree produced ${workers.length} record(s), wanted 2`);

  const seats = hireWorkforce(workers, { kinds });
  if (seats.length !== 2) failures.push(`hired ${seats.length} seat(s), wanted 2`);
  evidence.push(
    "the real loader read the tree and one hireWorkforce call turned both records into seats of a kind with no model in it"
  );

  // ---- (b) each seat RUNS, and its nested block reads its own skills -------
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);
    for (const id of [support.id, billing.id]) {
      const res = await act(router, id, sessions[id]!);
      const body = (await res.json()) as { request?: { id: string } };

      // One failure per thing that actually went wrong. A rejected action has
      // no request to wait on, so polling anyway would spend five seconds
      // looking up an empty id and then report `request ended undefined` — a
      // second failure naming a state that never happened, beside the real
      // one. A check that invents a failure is worse than a check that misses
      // one: whoever reads the output is told two things broke when one did.
      if (res.status !== 202) {
        failures.push(`${id}: expected 202 from its own address, got ${res.status}`);
        continue;
      }
      const requestId = body.request?.id;
      if (requestId === undefined) {
        failures.push(`${id}: accepted with 202 but the response carried no request id`);
        continue;
      }

      const status = await settled(stores, requestId);
      if (status !== "completed") failures.push(`${id}: request ended ${String(status)}`);
    }
    evidence.push("both seats ran an action to completion through the real HTTP route, with no model call");
  }

  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);

    // Graded from what the RUNNING BLOCK saw, never off the returned instance:
    // a bag read off `seat.config` is green for a value that never reached a
    // block. Nested rather than at the action root, because a root-only read
    // proves nothing about the context spread that carries it down.
    const seen: Record<string, string[]> = {};
    for (const seat of [support, billing]) {
      const ran = await ranOn(router, sessions[seat.id]!);
      if (ran.status !== 200) failures.push(`${seat.id}: /state returned ${ran.status}`);
      const names = ran.skills ?? [];
      seen[seat.id] = names;

      // Whole list, in level order — org, then team, then its own. Compared as
      // a sequence rather than a set, because the order is part of the promise
      // and a set check would pass for a bag assembled backwards.
      if (JSON.stringify(names) !== JSON.stringify(seat.skills)) {
        failures.push(
          `${seat.id}: its nested block saw ${JSON.stringify(names)}, its folders declared ${JSON.stringify(seat.skills)}`
        );
      }
      if (ran.desk !== seat.desk) {
        failures.push(`${seat.id}: its nested block saw desk ${String(ran.desk)}, wanted ${seat.desk}`);
      }
      if (ran.runs !== 1) failures.push(`${seat.id}: ran ${String(ran.runs)} times`);
    }
    evidence.push(
      "after closing the store and rebuilding the host, each seat's nested block shows the skills its own folders declared, in level order, read off ctx.flow.config.seatSkills"
    );

    // ---- (c) control: a seat is NOT handed its sibling's folders -----------
    //
    // The org skill is the one both must hold; everything else must differ.
    // Without this, one shared bag — always right for somebody — passes (b).
    const supportSeen = seen[support.id] ?? [];
    const billingSeen = seen[billing.id] ?? [];
    if (JSON.stringify(supportSeen) === JSON.stringify(billingSeen)) {
      failures.push("both seats saw the same skill list — one shared bag, not two seats' own");
    }
    for (const [mine, theirs, who] of [
      [supportSeen, billingSeen, support.id],
      [billingSeen, supportSeen, billing.id]
    ] as const) {
      const borrowed = theirs.filter((n) => n !== fixture.orgSkill && mine.includes(n));
      if (borrowed.length > 0) {
        failures.push(`${who}: holds its sibling's skills ${JSON.stringify(borrowed)}`);
      }
    }
    if (!supportSeen.includes(fixture.orgSkill) || !billingSeen.includes(fixture.orgSkill)) {
      failures.push(`the org-level skill "${fixture.orgSkill}" did not reach both seats`);
    }
    evidence.push(
      `both seats hold the org folder's "${fixture.orgSkill}" and neither holds the other's team or own-folder skills`
    );

    // ---- (d) control: strip the contract, and nothing is hired -------------
    {
      const { workers: legacy } = await readWorkforce(tree(fixture.control.dir));
      let hired: FlowInstance[] | undefined;
      let refusal = "";
      try {
        hired = hireWorkforce([...workers, ...legacy], { kinds });
      } catch (error) {
        refusal = messageOf(error);
      }
      if (hired !== undefined) {
        failures.push(`the kind with no contract hired ${hired.length} seat(s) instead of refusing`);
      } else {
        for (const name of [fixture.control.id, "workerConfigSchema()"]) {
          if (!refusal.includes(name)) {
            failures.push(`the refusal does not name "${name}": ${refusal}`);
          }
        }
        // A refusal after a partial hire is not a refusal — the seats whose own
        // kind was fine are gone too, so nothing can be registered.
        const emptied = host(stores, hired ?? []);
        const res = await act(emptied, billing.id, "s_refused");
        if (res.status !== 404) {
          failures.push(`a seat was registered anyway (${billing.id} answered ${res.status})`);
        }
      }
      evidence.push(
        "with the contract stripped from the kind, the whole roster refuses at the hire, the message names the worker and the fix, and nothing is registered"
      );
    }
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
