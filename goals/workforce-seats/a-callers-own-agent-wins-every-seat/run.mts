/**
 * Goal check — a team's own worker replaces ours, for every seat on the roster.
 *
 * Three worker records. Two name no kind at all and one names `agent`
 * explicitly, so all three would take the built-in. The app registers its own
 * flow under `agent`, and every one of them runs on the app's flow instead —
 * checked seat by seat, because one-seat-right-and-the-rest-ours is the failure
 * a single assertion misses.
 *
 * The seats then REGISTER, through the real flow registry, and one runs to
 * completion over the real HTTP route so its own record's instructions can be
 * read back at the far end. Registration is the point: the mint is not the
 * gate. The control run at the end proves that — the same roster with the
 * replacement declared as a singleton mints exactly the same three seats and is
 * refused at registration.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/a-callers-own-agent-wins-every-seat/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { AGENT_KIND, hireWorkforce, type WorkerManifest } from "@flow-state-dev/workforce";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { callerAgentFlow, callerAgentSingleton } from "./fixtures/flows";

type Worker = {
  id: string;
  description: string;
  desk: string;
  body: string;
  /** Whether the record writes `flow: agent` or leaves the key out entirely. */
  namesTheKind: boolean;
};
type Fixture = { userId: string; note: string; roster: Worker[] };

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);

/**
 * The roster, hand-built. The loader path is the sibling goal's subject; what
 * this one grades is which flow each record ends up on.
 */
function records(): WorkerManifest[] {
  return fixture.roster.map((worker) => ({
    id: worker.id,
    declared: {
      description: worker.description,
      desk: worker.desk,
      // The two shapes that must land on the same kind: an absent key, and the
      // name written out.
      ...(worker.namesTheKind ? { flow: AGENT_KIND } : {})
    },
    body: worker.body
  }));
}

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

async function ranOn(router: Router, sessionId: string) {
  const path = ["sessions", sessionId, "state"];
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), { params: { path } });
  const body = (await res.json()) as {
    clientData?: { session?: { ran?: { instructions?: string | null; desk?: string | null; runs?: number } } };
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-caller-agent-"));
  const dbFile = join(dir, "goal.db");

  const roster = records();
  const seats = hireWorkforce(roster, { kinds: { [AGENT_KIND]: callerAgentFlow } });

  // ---- (a) EVERY seat resolved to the caller's flow ----------------------
  {
    if (seats.length !== roster.length) {
      failures.push(`hired ${seats.length} seat(s) from ${roster.length} record(s)`);
    }

    for (const worker of fixture.roster) {
      const seat = seats.find((s) => s.id === worker.id);
      if (seat === undefined) {
        failures.push(`${worker.id}: no seat was hired for this record`);
        continue;
      }
      // Counting instances is the anti-game trap: three seats come back even
      // when all three are ours. Read each seat's own bag instead — `desk` is
      // a setting only the caller's flow declares, and `model` is one only
      // ours does.
      const config = seat.config as Record<string, unknown>;
      if (config.desk !== worker.desk) {
        failures.push(`${worker.id}: carries desk ${JSON.stringify(config.desk)}, wanted ${JSON.stringify(worker.desk)} — this seat is not the caller's flow`);
      }
      if (Object.hasOwn(config, "model")) {
        failures.push(`${worker.id}: carries a "model" setting, which only the built-in declares — the replacement did not win this seat`);
      }
    }

    const named = fixture.roster.filter((w) => w.namesTheKind).length;
    evidence.push(
      `all ${seats.length} seats resolved to the caller's own agent — ${named} naming the kind and ${seats.length - named} naming none`
    );
  }

  // ---- (b) and those seats REGISTER ---------------------------------------
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    let router: Router | undefined;
    try {
      router = host(stores, seats);
    } catch (error) {
      failures.push(`registering the caller's seats threw: ${messageOf(error)}`);
    }

    if (router !== undefined) {
      evidence.push("every seat registered through the real flow registry");

      // ---- (c) one seat runs, and its OWN record's instructions arrive ----
      const lead = fixture.roster[0]!;
      const session = "s_lead";
      const res = await act(router, lead.id, session);
      if (res.status !== 202) {
        failures.push(`${lead.id}: expected 202 from its own address, got ${res.status}`);
      } else {
        const body = (await res.json()) as { request?: { id: string } };
        const status = await settled(stores, body.request?.id ?? "");
        if (status !== "completed") failures.push(`${lead.id}: request ended ${String(status)}`);

        const seen = await ranOn(router, session);
        if (seen.status !== 200) failures.push(`${lead.id}: /state returned ${seen.status}`);
        if ((seen.instructions ?? "").trim() !== lead.body.trim()) {
          failures.push(`${lead.id}: its nested block saw instructions ${JSON.stringify(seen.instructions)}`);
        }
        if (seen.desk !== lead.desk) {
          failures.push(`${lead.id}: its nested block saw desk ${String(seen.desk)}`);
        }
        if (seen.runs !== 1) failures.push(`${lead.id}: ran ${String(seen.runs)} times`);

        evidence.push(
          "one seat ran to completion through the real HTTP route, and its own record's body reached a block nested inside the action as `instructions`"
        );
      }
    }
  }
  (stores as unknown as { close(): void }).close();

  // ---- (d) the control: a singleton replacement must FAIL at registration --
  // Without this leg, (b) proves nothing — a check that cannot fail has
  // verified nothing, and the mint is demonstrably not the gate.
  {
    const controlStores = createSQLiteStores({ filename: join(dir, "control.db") }) as unknown as StoreRegistry;
    let controlSeats: FlowInstance[] | undefined;
    try {
      controlSeats = hireWorkforce(roster, { kinds: { [AGENT_KIND]: callerAgentSingleton } });
    } catch (error) {
      failures.push(
        `the control roster was refused at the HIRE (${messageOf(error)}) — it is supposed to mint and fail later, so this leg no longer proves registration is the gate`
      );
    }

    if (controlSeats !== undefined) {
      if (controlSeats.length !== roster.length) {
        failures.push(`the control minted ${controlSeats.length} seat(s), wanted ${roster.length}`);
      }
      let registered = false;
      try {
        host(controlStores, controlSeats);
        registered = true;
      } catch {
        // Expected: a singleton's seats are refused one by one, by name.
      }
      if (registered) {
        failures.push("a singleton replacement registered cleanly — registration is not refusing what the contract says it must");
      } else {
        evidence.push(
          "the control run — the same roster with the replacement declared a singleton — minted all three seats and was refused at registration, which is what proves this check reaches the registry at all"
        );
      }
    }
    (controlStores as unknown as { close(): void }).close();
  }

  return { failures, evidence: evidence.join("; ") };
});
