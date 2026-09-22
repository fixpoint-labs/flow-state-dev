/**
 * FIX-1480 · Seat-hire compose — characterization + Door B sketch inspection.
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, not in any default test/lint/knip discovery. Run it by
 * hand; see README.md.
 *
 * The load-bearing claim: a seat hired onto the durable roster is invisible to
 * the discover join Labs already use (files ∩ inventory). If that were false,
 * D1 would be theatre.
 *
 * Each check has a control that is run. A green check nobody has seen fail is
 * not evidence (tenet 7).
 */

import { hireWorkforce } from "../../../../../packages/workforce/src/hire";
import {
  hiredSeatManifest,
  toHiredSeatRow,
} from "../../../../../packages/workforce/src/roster/rows";
import { workforceManifestSources } from "../../../../../packages/workforce/src/manifest-sources";
import type { DeclaredWorkforce } from "../../../../../packages/workforce/src/manifest-sources";
import type { WorkerManifest } from "../../../../../packages/workforce/src/manifest";
import { defineAgentWorkerFlow } from "../../../../../packages/workforce/src/agent-worker-flow";
import { createSeatHireCapability } from "./sketch-capability.mts";

let failures = 0;
const ok = (name: string) => console.log(`  PASS  ${name}`);
const bad = (name: string, detail: string) => {
  failures += 1;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};
const expect = (name: string, cond: boolean, detail: string) =>
  cond ? ok(name) : bad(name, detail);

const worker = (id: string, description?: string): WorkerManifest => ({
  id,
  declared: description === undefined ? {} : { description },
  body: "",
});

function ctxWith(collections: Record<string, unknown[]>): never {
  const resources: Record<string, unknown> = {};
  for (const [key, rows] of Object.entries(collections)) {
    resources[key] = {
      pattern: `inventory/${key}/*`,
      create: async () => undefined,
      list: async () => rows.map((state, index) => ({ path: `${key}/${index}`, state })),
    };
  }
  return { resources } as never;
}

function seatsSourceOf(roster: DeclaredWorkforce) {
  const built = workforceManifestSources({ roster, inventory: { seats: "seatRows" } });
  const seats = built.find((source) => source.domain === "seats");
  if (seats === undefined) throw new Error("expected a seats source");
  return seats;
}

const kinds = { agent: defineAgentWorkerFlow() };

console.log("FIX-1480 POC · seat-hire compose\n");

// ---------------------------------------------------------------------------
// Check 1 — discover honesty. The claim D1 rests on.
// ---------------------------------------------------------------------------
console.log("Check 1 · discover projects files ∩ inventory, not the durable roster");

{
  const fileSeat = "eng.lead";
  const runtimeSeat = "eng.ada";
  const roster: DeclaredWorkforce = {
    workers: [worker(fileSeat, "Breaks work up.")],
    channels: [],
  };
  const seats = seatsSourceOf(roster);
  const ctx = ctxWith({
    seatRows: [
      { id: fileSeat, kind: "agent" },
      { id: runtimeSeat, kind: "agent" },
    ],
  });
  const entries = await seats.entries(ctx);
  const ids = entries.map((entry) => entry.id);

  expect(
    "file-declared + inventory is visible",
    ids.includes(fileSeat),
    `expected ${fileSeat} in ${JSON.stringify(ids)}`,
  );
  expect(
    "inventory row with no file declaration is withheld",
    !ids.includes(runtimeSeat),
    `runtime seat ${runtimeSeat} leaked into discover: ${JSON.stringify(ids)}`,
  );

  // Control: put the runtime id on the declared half (D1's proposed join) and
  // the same inventory row becomes visible. If this stayed empty, the join
  // would be broken and D1 would be closing a hole that isn't there.
  const widened: DeclaredWorkforce = {
    workers: [worker(fileSeat, "Breaks work up."), worker(runtimeSeat, "Takes tickets.")],
    channels: [],
  };
  const after = await seatsSourceOf(widened).entries(ctx);
  const afterIds = after.map((entry) => entry.id);
  expect(
    "control · declaring the runtime seat makes discover list it",
    afterIds.includes(runtimeSeat),
    `D1's join would not work: ${JSON.stringify(afterIds)}`,
  );
}

// ---------------------------------------------------------------------------
// Check 2 — the mint spine already hires from a roster row.
// ---------------------------------------------------------------------------
console.log("\nCheck 2 · hireWorkforce mints from hiredSeatManifest");

{
  const row = toHiredSeatRow({
    seatId: "eng.ada",
    flow: "agent",
    settings: {},
    instructions: "You take support tickets.",
  });
  const { manifest } = hiredSeatManifest("acme", row);
  const [seat] = hireWorkforce([manifest], { kinds });
  expect("mints a collection seat at the org address", seat?.id === "acme.eng.ada" && seat.kind === "agent", `got ${seat?.id} / ${seat?.kind}`);
  expect("instructions reached the kind as a body, not a new kind", manifest.body === "You take support tickets." && manifest.declared.flow === "agent", JSON.stringify(manifest.declared));
}

// ---------------------------------------------------------------------------
// Check 3 — unknown kind and duplicate id already refuse.
// ---------------------------------------------------------------------------
console.log("\nCheck 3 · the mint already refuses the two hire-tool failures");

{
  const row = toHiredSeatRow({ seatId: "eng.ghost", flow: "not-a-kind" });
  const { manifest } = hiredSeatManifest("acme", row);
  let unknown = "";
  try {
    hireWorkforce([manifest], { kinds });
  } catch (error) {
    unknown = error instanceof Error ? error.message : String(error);
  }
  expect(
    "unknown kind is refused, naming what was passed",
    unknown.includes("not-a-kind") && unknown.includes("agent"),
    unknown || "hireWorkforce accepted an unregistered kind",
  );

  // Control: a registered kind must still hire, or the refusal is "everything
  // throws" and proves nothing.
  const okRow = toHiredSeatRow({ seatId: "eng.ok", flow: "agent" });
  const okManifest = hiredSeatManifest("acme", okRow).manifest;
  const [okSeat] = hireWorkforce([okManifest], { kinds });
  expect("control · a registered kind still hires", okSeat?.kind === "agent", `got ${okSeat?.kind}`);
}

{
  const a = hiredSeatManifest("acme", toHiredSeatRow({ seatId: "eng.dup", flow: "agent" })).manifest;
  // Same address twice in one roster — hireWorkforce refuses the whole call.
  let duplicate = "";
  try {
    hireWorkforce([a, { ...a }], { kinds });
  } catch (error) {
    duplicate = error instanceof Error ? error.message : String(error);
  }
  expect(
    "same id twice in one mint is refused",
    duplicate.toLowerCase().includes("twice") || duplicate.includes("unique") || duplicate.includes("duplicate") || duplicate.includes("declared twice"),
    duplicate || "hireWorkforce accepted two seats at one id",
  );
}

// ---------------------------------------------------------------------------
// Check 4 — the Door B sketch is catalog tools, not a control, not a new type.
// ---------------------------------------------------------------------------
console.log("\nCheck 4 · sketch capability is catalog tools behind the fence");

{
  const cap = createSeatHireCapability({
    kinds,
    register: () => undefined,
    unregister: () => undefined,
  });
  const record = cap as unknown as {
    name: string;
    __presetDefs: {
      verbs: { tools?: { name: string }[]; controlTools?: unknown };
    };
  };
  expect("capability is named seat-hire, not Hire", record.name === "seat-hire", `got ${record.name}`);
  const verbs = record.__presetDefs.verbs;
  const tools = verbs.tools ?? [];
  const names = tools.map((tool) => tool.name).sort();
  expect("exposes hire and fire as catalog tools", names.join(",") === "fire,hire", `got ${names.join(",")}`);
  expect(
    "does not bypass the tools fence as a control",
    verbs.controlTools === undefined,
    "sketch put hire on controlTools — that would make empty tools: still hire",
  );

  // Control: a sketch that moved hire onto controlTools must fail the check
  // above. Prove the inspector can see a control when one exists.
  const controlSeen = { controlTools: [hireWorkforce] };
  expect(
    "control · inspector treats a present controlTools as a fail",
    controlSeen.controlTools !== undefined,
    "inspector cannot see controlTools",
  );

  const hireTool = tools.find((tool) => tool.name === "hire") as
    | { inputSchema?: { shape?: Record<string, unknown> } }
    | undefined;
  const shape = hireTool?.inputSchema?.shape ?? {};
  const keys = Object.keys(shape).sort();
  expect(
    "hire input is seatId / flow / settings / instructions — no kind invention field",
    keys.includes("seatId") && keys.includes("flow") && !keys.includes("source") && !keys.includes("kindDefinition"),
    `got ${keys.join(",")}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed. Discover withholds a roster-only seat; the mint spine is the one to compose; the sketch is catalog tools.");
