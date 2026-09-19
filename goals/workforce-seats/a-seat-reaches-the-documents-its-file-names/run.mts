/**
 * Goal check — a seat reaches the documents its own file names, and nothing
 * else.
 *
 * One workforce tree, read by the real loader. Three seats of one kind, hired
 * in one call: one granting a document read-only, one granting a different one
 * `rw`, and one naming no documents at all. Each runs an action to completion
 * through the real HTTP router, and a block NESTED inside that action tries to
 * reach and to write every document the app declared plus the app's own store.
 * What it managed is read back through `/state` after the stores are closed and
 * the host rebuilt.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { DESK_KIND, STORE, buildDesk } from "./fixtures/flows";

type SeatFixture = { id: string; reaches: string[]; writes: string[] };
type Fixture = {
  userId: string;
  note: string;
  documents: string[];
  store: string;
  seats: { lead: SeatFixture; cfo: SeatFixture; chief: SeatFixture };
  control: { dir: string; id: string; ref: string };
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const ORG = "org_seat_resource_allowlist_goal";
const roster = [fixture.seats.lead, fixture.seats.cfo, fixture.seats.chief];

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
      body: JSON.stringify({ userId: fixture.userId, orgId: ORG, input: { note: fixture.note } })
    }),
    { params: { path } }
  );
}

/** What a seat's NESTED block actually reached and wrote, through the public route. */
async function ranOn(router: Router, sessionId: string) {
  const path = ["sessions", sessionId, "state"];
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
    params: { path }
  });
  const body = (await res.json()) as {
    clientData?: { session?: { ran?: { reach?: string[] | null; wrote?: string[] | null; runs?: number } } };
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

const same = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-seat-resources-"));
  const dbFile = join(dir, "goal.db");
  const sessions: Record<string, string> = Object.fromEntries(
    roster.map((seat, i) => [seat.id, `s_seat_${i}`])
  );

  // ---- (a) the real loader reads the tree, and one call hires it ----------
  const declared = await readDeclaredRoster(tree("workforce"));
  if (declared.problems.length > 0) {
    failures.push(`the loader reported ${declared.problems.length} problem(s): ${JSON.stringify(declared.problems.map((p) => `${p.layer} ${p.path}: ${p.error.message}`))}`);
  }
  if (declared.workers.length !== roster.length) {
    failures.push(`the tree produced ${declared.workers.length} record(s), wanted ${roster.length}`);
  }
  if (!same(declared.documents.map((d) => d.ref), fixture.documents)) {
    failures.push(
      `the tree produced documents ${JSON.stringify(declared.documents.map((d) => d.ref))}, wanted ${JSON.stringify(fixture.documents)}`
    );
  }

  const { deskFlow, catalog } = buildDesk(declared.documents);
  const kinds = { [DESK_KIND]: deskFlow as never };

  const seats = hireWorkforce(declared.workers, { kinds, documents: catalog });
  if (seats.length !== roster.length) failures.push(`hired ${seats.length} seat(s), wanted ${roster.length}`);
  evidence.push(
    `the real loader read ${declared.workers.length} seat files and ${declared.documents.length} documents, and one hireWorkforce call turned them into ${seats.length} seats of one kind`
  );

  // ---- (b) every seat RUNS, through the real route ------------------------
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);
    for (const seat of roster) {
      const res = await act(router, seat.id, sessions[seat.id]!);
      const body = (await res.json()) as { request?: { id: string } };
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

    // ---- (c) each seat reached exactly what its own file named -----------
    //
    // Graded from what the RUNNING BLOCK managed, never off the returned
    // instance: a map asserted on `seat.resources` proves the mint and nothing
    // about what a block holds. `wrote` is a real `setState`, not a flag.
    const seen: Record<string, { reach: string[]; wrote: string[] }> = {};
    for (const seat of roster) {
      const ran = await ranOn(router, sessions[seat.id]!);
      if (ran.status !== 200) failures.push(`${seat.id}: /state returned ${ran.status}`);
      if (ran.runs !== 1) failures.push(`${seat.id}: ran ${String(ran.runs)} times`);

      const reach = ran.reach ?? [];
      const wrote = ran.wrote ?? [];
      seen[seat.id] = { reach, wrote };

      // The store is the app's own and belongs to no grant, so it is compared
      // separately — see (d). Here the documents alone.
      const documentsReached = reach.filter((key) => key !== fixture.store);
      const documentsWritten = wrote.filter((key) => key !== fixture.store);

      if (!same(documentsReached, seat.reaches)) {
        failures.push(
          `${seat.id}: reached documents ${JSON.stringify(documentsReached)}, its file names ${JSON.stringify(seat.reaches)}`
        );
      }
      if (!same(documentsWritten, seat.writes)) {
        failures.push(
          `${seat.id}: wrote documents ${JSON.stringify(documentsWritten)}, its file grants ${JSON.stringify(seat.writes)}`
        );
      }
    }
    evidence.push(
      "after closing the store and rebuilding the host, each seat's nested block reached exactly the documents its own file names — the read-only grant read its document and could not write it, the rw grant wrote its own, and neither could see the other's"
    );

    // ---- (d) the app's own store is not what a grant governs -------------
    //
    // BR-15, on the real path. Without this the whole check is equally green
    // for a resolver that narrows to the granted documents alone and silently
    // deletes everything else the app declared at flow level.
    for (const seat of roster) {
      const { reach, wrote } = seen[seat.id] ?? { reach: [], wrote: [] };
      if (!reach.includes(fixture.store)) {
        failures.push(`${seat.id}: lost the app's own "${fixture.store}", which no seat file mentions`);
      }
      if (!wrote.includes(fixture.store)) {
        failures.push(`${seat.id}: could not write the app's own "${fixture.store}"`);
      }
    }
    evidence.push(
      `all three seats still reach and write the app's own "${STORE}", which no grant names and none may narrow`
    );

    // ---- (e) two seats of one kind really do differ ----------------------
    //
    // The anti-game. A single shared map is always right for somebody, and
    // (c) alone would pass for a kind that narrowed once for all three.
    const lead = seen[fixture.seats.lead.id]?.reach ?? [];
    const cfo = seen[fixture.seats.cfo.id]?.reach ?? [];
    const chief = seen[fixture.seats.chief.id]?.reach ?? [];
    if (same(lead, cfo)) failures.push("the two granted seats reached the same set — one shared map, not two seats' own");
    if (same(lead, chief)) failures.push("a granted seat reached what the ungranted one did — the grant changed nothing");
    evidence.push("no two of the three seats reached the same set, so the narrowing is per seat and not per kind");

    // ---- (f) control: a ref that matches no document refuses -------------
    {
      const typo = await readDeclaredRoster(tree(fixture.control.dir));
      let hired: FlowInstance[] | undefined;
      let refusal = "";
      try {
        hired = hireWorkforce([...declared.workers, ...typo.workers], { kinds, documents: catalog });
      } catch (error) {
        refusal = messageOf(error);
      }
      if (hired !== undefined) {
        failures.push(`a seat granting a ref no document matches hired ${hired.length} seat(s) instead of refusing`);
      } else {
        for (const name of [fixture.control.id, fixture.control.ref]) {
          if (!refusal.includes(name)) failures.push(`the refusal does not name "${name}": ${refusal}`);
        }
        // A refusal after a partial hire is not a refusal: the good seats are
        // gone too, so nothing can be registered.
        const emptied = host(stores, hired ?? []);
        const res = await act(emptied, fixture.seats.chief.id, "s_refused");
        if (res.status !== 404) {
          failures.push(`a seat was registered anyway (${fixture.seats.chief.id} answered ${res.status})`);
        }
      }
      evidence.push(
        "a seat file granting a ref no document matches refuses the whole roster at the hire, naming the seat and the ref, and nothing is registered"
      );
    }
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
