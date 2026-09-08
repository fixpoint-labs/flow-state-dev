/**
 * Goal check — two copies of one flow definition, differing only in the
 * settings they were created with, behave differently and read only their own
 * knobs; and those settings never leave the process.
 *
 * Real path, no mocking, no model, out of CI. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/flow-instances/settings-travel-with-the-copy/run.mts
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { auditDefinition, seatDefinition, seatWork } from "./fixtures/seats";

type Seat = { id: string; config: Record<string, unknown> };
type Fixture = {
  userId: string;
  note: string;
  east: Seat;
  west: Seat;
  defaulted: Seat & { expectedRetries: number };
  typo: { id: string; badKey: string };
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);

const mint = (seat: Seat) =>
  seatDefinition({ id: seat.id, config: seat.config as never }) as unknown as FlowInstance;

function host(stores: StoreRegistry, ...flows: FlowInstance[]) {
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

async function get(router: Router, path: string[]): Promise<{ status: number; body: unknown }> {
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
    params: { path }
  });
  return { status: res.status, body: await res.json() };
}

/** What the copy actually ran on, through the public `/state` route. */
async function ranOn(router: Router, sessionId: string) {
  const { status, body } = await get(router, ["sessions", sessionId, "state"]);
  const seen = (body as { clientData?: { session?: { ran?: Record<string, unknown> } } }).clientData
    ?.session?.ran;
  return { status, ranOn: seen?.ranOn, routedTo: seen?.routedTo, runs: seen?.runs };
}

async function settled(stores: StoreRegistry, requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

/** What a copy's settings SHOULD read as, rendered the way the blocks render them. */
function expected(seat: Seat) {
  const harness = seat.config.harness as string;
  const model = seat.config.model as string;
  return {
    ranOn: `${harness}/${model}`,
    routedTo: harness === "claude-code" ? `claude:${model}` : `${harness}:${model}`
  };
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "fsd-seat-config-"));
  const dbFile = join(dir, "goal.db");
  const seats = [fixture.east, fixture.west, fixture.defaulted];
  const sessions: Record<string, string> = {
    [fixture.east.id]: "s_east",
    [fixture.west.id]: "s_west",
    [fixture.defaulted.id]: "s_defaulted"
  };

  // ---- (a) one block graph, three copies -------------------------------
  {
    const minted = seats.map(mint);
    for (const instance of minted) {
      const block = (instance.actions as { run: { block: unknown } }).run.block;
      if (block !== seatWork) {
        failures.push(`${instance.id}: action block is a per-copy rebuild, not the shared graph`);
      }
    }
    const bags = minted.map((i) => JSON.stringify(i.config));
    if (new Set(bags).size !== bags.length) failures.push("two copies ended up with the same bag");
    // The defaulted copy omitted `retries` and must read the schema's default,
    // not a bare absence.
    const defaulted = minted[2]!.config as { retries?: number };
    if (defaulted.retries !== fixture.defaulted.expectedRetries) {
      failures.push(`the defaulted copy reads retries=${String(defaulted.retries)}`);
    }
    evidence.push(
      `three copies of one definition share one block graph and carry three distinct bags`
    );
  }

  // ---- (b) each copy runs on its OWN knobs, read back after a restart ---
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, ...seats.map(mint));
    for (const seat of seats) {
      const res = await act(router, seat.id, sessions[seat.id]!);
      const body = (await res.json()) as { request?: { id: string } };
      if (res.status !== 202) failures.push(`${seat.id}: expected 202, got ${res.status}`);
      const status = await settled(stores, body.request?.id ?? "");
      if (status !== "completed") failures.push(`${seat.id}: request ended ${status}`);
    }
    evidence.push("each copy ran the same action through the real HTTP route");
  }

  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, ...seats.map(mint));
    const others = (seat: Seat) => seats.filter((s) => s.id !== seat.id).map(expected);
    for (const seat of seats) {
      const seen = await ranOn(router, sessions[seat.id]!);
      const want = expected(seat);
      if (seen.status !== 200) failures.push(`${seat.id}: /state returned ${seen.status}`);
      // The nested tap and the routed branch each recorded this copy's knobs.
      if (seen.ranOn !== want.ranOn) {
        failures.push(`${seat.id}: nested tap ran on ${String(seen.ranOn)}, wanted ${want.ranOn}`);
      }
      if (seen.routedTo !== want.routedTo) {
        failures.push(
          `${seat.id}: routed branch recorded ${String(seen.routedTo)}, wanted ${want.routedTo}`
        );
      }
      // Reading correctly proves nothing on its own — the sibling's value must
      // be ABSENT, since one shared bag would show up as a value that is right
      // for somebody.
      for (const other of others(seat)) {
        if (seen.ranOn === other.ranOn || seen.routedTo === other.routedTo) {
          failures.push(`${seat.id}: read a sibling copy's knobs (${String(seen.ranOn)})`);
        }
      }
      if (seen.runs !== 1) failures.push(`${seat.id}: ran ${String(seen.runs)} times`);
    }
    evidence.push(
      "after reopening the store on a fresh host, each copy's nested tap and routed branch show its own harness and model, and no sibling's"
    );
  }

  // ---- (c) the settings never left the process -------------------------
  {
    const router = host(stores, ...seats.map(mint));
    const { body } = await get(router, []);
    const listing = (body as { flows: Array<Record<string, unknown>> }).flows;
    for (const entry of listing) {
      if (Object.hasOwn(entry, "config")) failures.push(`${String(entry.id)}: listing carries config`);
    }
    // Not just "the endpoint omits the key": the value must be nowhere on the
    // wire, and nowhere on disk. The whole database file is the haystack, so a
    // record written under any name is caught.
    const onDisk = readFileSync(dbFile, "latin1");
    const wire = JSON.stringify(body);
    for (const seat of seats) {
      const secret = seat.config.apiKey as string;
      if (wire.includes(secret)) failures.push(`${seat.id}: the flow listing leaked its apiKey`);
      if (onDisk.includes(secret)) failures.push(`${seat.id}: its apiKey was written to the store`);
    }
    evidence.push(
      "the unauthenticated flow listing carries no config key, and no copy's credential appears anywhere on the wire or in the database file"
    );
  }

  // ---- (d) a bad bag refuses at the mint, before any request exists -----
  {
    const typoBag: Record<string, unknown> = { ...(fixture.east.config as object) };
    typoBag[fixture.typo.badKey] = typoBag.harness;
    delete typoBag.harness;

    let refusal = "";
    try {
      seatDefinition({ id: fixture.typo.id, config: typoBag as never });
      failures.push("a bag with an undeclared key was accepted");
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }
    for (const fragment of ["seat", fixture.typo.id, fixture.typo.badKey]) {
      if (!refusal.includes(fragment)) {
        failures.push(`the typo refusal does not name "${fragment}": ${refusal}`);
      }
    }

    // The same block on a LOOSER flow: refused per copy, at the mint of the one
    // that omits the field — and NOT where the two definitions were written.
    let blockRefusal = "";
    try {
      auditDefinition({ id: "audit-1", config: { harness: "codex" } as never });
      failures.push("a bag no block could read was accepted");
    } catch (err) {
      blockRefusal = err instanceof Error ? err.message : String(err);
    }
    for (const fragment of ["audit", "audit-1"]) {
      if (!blockRefusal.includes(fragment)) {
        failures.push(`the block refusal does not name "${fragment}": ${blockRefusal}`);
      }
    }
    // It must name a DECLARING block. Which one is the walk's order — the four
    // share one schema reference and dedupe to a single collected entry — so
    // the contract is "a block that declared the requirement", not a fixed name.
    const declaring = ["seat-record-harness", "seat-by-harness", "seat-branch-claude", "seat-branch-other"];
    if (!declaring.some((name) => blockRefusal.includes(`"${name}"`))) {
      failures.push(`the block refusal names no declaring block: ${blockRefusal}`);
    }
    // …and the copy that DOES supply it runs, on the same definition. Graded
    // rather than left to throw: a refusal here is a real finding (one copy's
    // bag leaking into the next), and a crash would report less than a bullet.
    try {
      const ok = auditDefinition({
        id: "audit-2",
        config: { harness: "codex", model: "gpt-5.4" } as never
      });
      if ((ok.config as { model?: string }).model !== "gpt-5.4") {
        failures.push(`the satisfied audit copy carries ${JSON.stringify(ok.config)}`);
      }
    } catch (err) {
      failures.push(
        `a copy that supplies every setting was refused: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    evidence.push(
      "a typo'd knob refuses at the line that mints the copy, naming the flow, the id and the key; " +
        "a bag a block cannot read refuses naming the block, per copy, while a copy that supplies it mints fine"
    );
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
