/**
 * FIX-1527 · POC · the manager seat, composed the way the plan composes it.
 *
 * NOT production code and not part of any default test run. See README.md for
 * how to run it, what it observed, and its limits.
 *
 * Builds kitchen-sink's own `agent` kind the way PLAN.md S1 proposes — the
 * generated capabilities and block catalog this app already passes, plus
 * `createSeatHireCapability` and `createWorkforceCapability` — and wires the
 * hire tool's register/unregister/kindAt to the app's real
 * `workforceRegistrar` proxy. Then it runs a manager seat that names
 * `hire` and `fire`, and a neighbour that does not, under two organizations.
 *
 * Premises it settles (README.md → "What it observed"):
 *   P1  under a named org the manager hires, the row lands in the org roster
 *       the boot reload reads, the registrar marks the address as roster-minted,
 *       and `discover` lists the new seat
 *   P2  under DEFAULT_ORG_ID — the org every kitchen-sink seat request runs
 *       under today — the same call refuses and writes nothing
 *   P3  a neighbour on the same kind that does not name `hire` cannot hire
 *   P4  fire drops the seat from `discover`; its inventory row stays (FIX-1540)
 *   P5  the row the manager wrote is one the app's existing boot reload
 *       (`reloadHiredSeats`) brings back — no second roster
 *   P6  a seat the manager hires with `tools: [hire]` in its settings can
 *       itself hire (the capability's contract; D1 → Locks in)
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import {
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  hireWorkforce,
  reloadHiredSeats,
  splitResourceModules,
  workforceManifestSources,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  type HireOptions,
} from "@flow-state-dev/workforce";

import { setWorkforceRegistrarImpl, workforceRegistrar } from "@/lib/workforce-registrar";
import { blocks, kinds as generatedKinds, resourceModules } from "@/workforce/workforce.gen";

// Negative controls (README.md): POC_ORG re-runs P2 under a named org;
// POC_NEIGHBOUR_TOOLS hands the neighbour the grant P3 says it lacks;
// POC_RELOAD_ORG points P5's boot reload at an org that hired nothing;
// POC_HIRED_TOOLS="" hires P6's seat with no tools, so it cannot hire.
const DEV_ORG = process.env.POC_ORG ?? DEFAULT_ORG_ID;
const HIRED_TOOLS = (process.env.POC_HIRED_TOOLS ?? "hire").split(",").filter(Boolean);
const RELOAD_ORG = process.env.POC_RELOAD_ORG ?? "acme";
const NEIGHBOUR_TOOLS = (process.env.POC_NEIGHBOUR_TOOLS ?? "desk-note").split(",");

type ToolCall = { toolCallId: string; toolName: string; args: Record<string, unknown> };
type Rows = { list: () => Promise<Array<{ state: Record<string, unknown> }>> };

/** The app's registrar, installed over an in-memory map (fsdev.config.ts installs FlowState's). */
function installRegistrar() {
  const held = new Map<string, FlowInstance>();
  setWorkforceRegistrarImpl({
    register: (flow) => {
      if (held.has(flow.id)) throw new Error(`"${flow.id}" is already registered`);
      held.set(flow.id, flow);
    },
    unregister: (id) => held.delete(id),
    kindAt: (id) => held.get(id)?.kind,
  });
  return held;
}

/** kitchen-sink's `agent` kind with the two capabilities composed on it (PLAN.md S1). */
function kitchenSinkKindsWithHire() {
  const { capabilities } = splitResourceModules(resourceModules);
  const kinds: NonNullable<HireOptions["kinds"]> = { ...generatedKinds };
  const seatHire = createSeatHireCapability({
    kinds,
    register: (seat, pin) => workforceRegistrar.registerFromRoster(seat, { pin }),
    unregister: (id) => workforceRegistrar.unregister(id),
    kindAt: (id) => workforceRegistrar.kindAt(id),
  });
  const workforce = createWorkforceCapability({
    roster: { workers: [], channels: [] },
    inventory: { seats: SEAT_INVENTORY_RESOURCE },
    hiredRoster: HIRED_ROSTER_RESOURCE,
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [...capabilities, seatHire, workforce], catalog: blocks });
  return kinds;
}

function seats(kinds: NonNullable<HireOptions["kinds"]>) {
  const [manager, neighbour] = hireWorkforce(
    [
      { id: "support.mara", declared: { tools: ["hire", "fire"] }, body: "You staff the desk." },
      { id: "support.otto", declared: { tools: NEIGHBOUR_TOOLS }, body: "You answer questions." },
    ],
    { kinds },
  );
  return { manager: manager!, neighbour: neighbour! };
}

async function run(
  seat: FlowInstance,
  script: Array<{ toolCalls: ToolCall[] } | { text: string }>,
  orgId: string,
) {
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId,
    org: { state: {} },
    sessionId: "poc-session",
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: { "agent-answer": mockGenerator({ name: "agent-answer", script: script as never }) },
  });
  const result = await executeBlock({
    block: seat.actions.run!.block,
    input: { message: "staff the desk" },
    ctx: runtime.ctx,
  });
  return { result, ctx: runtime.ctx, stores: runtime.stores };
}

const call = (toolName: string, args: Record<string, unknown>, id: string): ToolCall => ({
  toolCallId: id,
  toolName,
  args,
});

async function ids(ctx: unknown, key: string, field: string): Promise<string[]> {
  const rows = await ((ctx as { resources: Record<string, Rows> }).resources[key]!).list();
  return rows.map((row) => row.state?.[field]).filter((v): v is string => typeof v === "string");
}

async function discovered(ctx: unknown): Promise<string[]> {
  const [source] = workforceManifestSources({
    roster: { workers: [], channels: [] },
    inventory: { seats: SEAT_INVENTORY_RESOURCE },
    hiredRoster: HIRED_ROSTER_RESOURCE,
  });
  return (await source!.entries(ctx as never)).map((entry) => entry.id);
}


describe("FIX-1527 POC · manager seat on kitchen-sink's agent kind", () => {
  it("P1 · under a named org, hire lands in the org roster, marks provenance, and discover lists it", async () => {
    const held = installRegistrar();
    const { manager } = seats(kitchenSinkKindsWithHire());
    const { result, ctx } = await run(
      manager,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent", instructions: "You take refunds." }, "h1")] },
        { text: "done" },
      ],
      "acme",
    );
    expect(result.error).toBeUndefined();
    expect(await ids(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual(["support.pat"]);
    expect(held.has("acme.support.pat")).toBe(true);
    expect(workforceRegistrar.isFromRoster("acme.support.pat")).toBe(true);
    expect(await discovered(ctx)).toEqual(["acme.support.pat"]);
  });

  it("P2 · under the org kitchen-sink seat requests run under today, the same hire refuses and writes nothing", async () => {
    const held = installRegistrar();
    const { manager } = seats(kitchenSinkKindsWithHire());
    const { result, ctx } = await run(
      manager,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent" }, "h1")] },
        { text: "done" },
      ],
      DEV_ORG,
    );
    expect(result.error?.message).toMatch(/Organization id "__fsd_default_org__" must be lowercase/);
    expect(await ids(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await ids(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual([]);
    expect(held.size).toBe(0);
  });

  it("P3 · a neighbour on the same kind that does not name hire cannot hire", async () => {
    const held = installRegistrar();
    const { neighbour } = seats(kitchenSinkKindsWithHire());
    const { result, ctx } = await run(
      neighbour,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent" }, "h1")] },
        { text: "done" },
      ],
      "acme",
    );
    expect(result.error).toBeUndefined();
    expect(held.size).toBe(0);
    expect(await ids(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
  });

  it("P4 · fire drops the seat from discover and releases it; the inventory row stays (FIX-1540)", async () => {
    const held = installRegistrar();
    const { manager } = seats(kitchenSinkKindsWithHire());
    const { result, ctx } = await run(
      manager,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent" }, "h1")] },
        { toolCalls: [call("fire", { seatId: "support.pat" }, "f1")] },
        { text: "done" },
      ],
      "acme",
    );
    expect(result.error).toBeUndefined();
    expect(held.has("acme.support.pat")).toBe(false);
    expect(await ids(ctx, HIRED_ROSTER_RESOURCE, "seatId")).toEqual([]);
    expect(await ids(ctx, SEAT_INVENTORY_RESOURCE, "id")).toEqual(["acme.support.pat"]);
    expect(await discovered(ctx)).toEqual([]);
  });

  it("P5 · the boot reload the app already runs brings the manager's hire back", async () => {
    installRegistrar();
    const kinds = kitchenSinkKindsWithHire();
    const { manager } = seats(kinds);
    const { stores } = await run(
      manager,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent" }, "h1")] },
        { text: "done" },
      ],
      "acme",
    );
    const reload = await reloadHiredSeats({ stores: stores as never, orgIds: [RELOAD_ORG], kinds });
    expect(reload.problems).toEqual([]);
    expect(reload.seats.map((seat) => seat.id)).toEqual(["acme.support.pat"]);
  });

  it("P6 · a seat hired with tools: [hire] in its settings can itself hire", async () => {
    const held = installRegistrar();
    const kinds = kitchenSinkKindsWithHire();
    const { manager } = seats(kinds);
    await run(
      manager,
      [
        { toolCalls: [call("hire", { seatId: "support.pat", flow: "agent", settings: { tools: HIRED_TOOLS } }, "h1")] },
        { text: "done" },
      ],
      "acme",
    );
    const pat = held.get("acme.support.pat")!;
    const { result } = await run(
      pat,
      [
        { toolCalls: [call("hire", { seatId: "support.quinn", flow: "agent" }, "h2")] },
        { text: "done" },
      ],
      "acme",
    );
    expect(result.error).toBeUndefined();
    expect(held.has("acme.support.quinn")).toBe(true);
  });
});
