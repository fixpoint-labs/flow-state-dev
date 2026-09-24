/**
 * `support.mara` — the seat that names `hire` and `fire` — run as the app
 * composes her.
 *
 * Promoted from the spec POC (`specs/issues/FIX-1527/poc/manager-seat/`), with
 * one difference that is the point of promoting it: the POC rebuilt the
 * `agent` kind beside the app, and this file does not. The seats come from
 * `hireKitchenSinkWorkforce()`, which reads the real `workforce/teams/` folders
 * and hires them against the exported `kitchenSinkKinds`, so mara's tools are
 * the ones `workforce/hire.ts` composed and nothing else. Every run goes
 * through the engine's `runAction` with a scripted model; the registrar is the
 * app's real proxy over an in-memory door, as in `workforce-admin.test.ts`.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1527/PLAN.md`), and the red
 * state each was seen in before its green was trusted:
 *
 *   V1  hire under a named org, discover, fire. Red: register through the
 *       registrar's plain `register` instead of `registerFromRoster` in
 *       `workforce/hire.ts` — `isFromRoster` reads false.
 *   V2  under the development org the hire is refused and nothing is written,
 *       read straight out of the stores with no model involved. Red: run the
 *       same case under `acme` — the run succeeds and a roster row exists.
 *   V3  otto, on the same kind, cannot hire. Red: add `hire` to otto's
 *       `WORKER.md` — the seat is registered.
 *   V4  a `desk-clerk` hire with a `desk` setting. Red: pass
 *       `allowKinds: ["agent"]` in `kitchenSinkSeatHireOptions` — refused.
 *   V5  the app's boot reload brings mara's hire back. Red: reload a
 *       different organization — no seats.
 *   V6  a seat mara hires with `tools: [hire]` can hire in turn. Red: hire it
 *       with no tools — its own hire registers nothing.
 *   V7  the operator's `workforce-admin` fire releases a seat mara hired, and
 *       mara's fire refuses a seat the operator hired. Red (first half): the
 *       same `register` swap as V1 — the operator's fire reports
 *       `released: false` and leaves the seat answering.
 *   Release provenance: mara's fire does not release an address the roster
 *       door did not register. Red: wire `unregister` straight to the
 *       registrar's `unregister` — `released: true`, the seat goes offline.
 *
 * The real-model check (VG) is not here; it is `fsdev run support.mara`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { reloadHiredSeats } from "@flow-state-dev/workforce";

import { ADMIN_TOKENS_ENV } from "../lib/workforce-admin-auth";
import { setWorkforceRegistrarImpl, workforceRegistrar } from "../lib/workforce-registrar";
import workforceAdminFlow from "../flows/workforce-admin/flow";
import { hireKitchenSinkWorkforce, kitchenSinkKinds } from "../workforce/hire";

const ORG = "acme";

type Stores = ReturnType<typeof createInMemoryStores>;
type ScriptStep =
  | { toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> }
  | { text: string };

/** The app's registrar proxy, installed over an in-memory door. */
function installRegistrar(): Map<string, FlowInstance> {
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

/** One file-declared seat, as `hireKitchenSinkWorkforce` hires it. */
async function fileSeat(id: string): Promise<FlowInstance> {
  const { seats } = await hireKitchenSinkWorkforce();
  const seat = seats.find((candidate) => candidate.id === id);
  if (seat === undefined) throw new Error(`the workforce tree declares no seat "${id}"`);
  return seat;
}

const call = (toolName: string, args: Record<string, unknown>, toolCallId = toolName) => ({
  toolCalls: [{ toolCallId, toolName, args }],
});

/** Run a seat's `run` action through the engine with a scripted model. */
async function runSeat(seat: FlowInstance, stores: Stores, script: ScriptStep[], orgId = ORG) {
  const answer = mockGenerator({ name: "agent-answer", script: script as never });
  return runAction({
    flow: seat,
    actionName: "run",
    input: { message: "staff the desk" },
    userId: "desk-lead",
    orgId,
    stores,
    runtimeConfig: {
      modelResolver: createMockModelResolver({ generators: { "agent-answer": answer } }),
    },
  });
}

/** One `workforce-admin` action, driven the way `workforce-admin.test.ts` drives it. */
async function callAdmin(stores: Stores, actionName: "hire" | "fire", input: unknown) {
  return runAction({
    flow: workforceAdminFlow as FlowInstance,
    actionName,
    input,
    userId: "admin",
    orgId: ORG,
    stores,
    runtimeConfig: { modelResolver: createMockModelResolver({ policy: "allow" }) },
  });
}

/** What one tool returned during a run, read off the run's own items. */
function toolOutput(result: { items: unknown[] }, blockName: string): unknown {
  const item = result.items.find(
    (candidate) =>
      (candidate as { type?: string }).type === "tool_output" &&
      (candidate as { blockName?: string }).blockName === blockName,
  );
  return (item as { output?: unknown } | undefined)?.output;
}

/** The seat ids `discover` listed, from the `seats` domain of its output. */
function discoveredSeats(result: { items: unknown[] }): string[] {
  const output = toolOutput(result, "discover") as
    | { domains: Array<{ domain: string; entries: Array<{ id: string }> }> }
    | undefined;
  if (output === undefined) throw new Error("the run made no discover call");
  return (output.domains.find((d) => d.domain === "seats")?.entries ?? []).map((e) => e.id);
}

/** Storage keys under a prefix of one organization's resource state, read with no model involved. */
async function storedKeys(stores: Stores, orgId: string, prefix: string): Promise<string[]> {
  return Object.keys(await stores.resourceState.getByPrefix("org", orgId, prefix)).sort();
}

const ROSTER = "workforce/roster/";
const INVENTORY = "inventory/seats/";

beforeEach(() => {
  // The admin flow's own resolver is transport-level and never runs under
  // `runAction`; the env is stubbed so its module sees a configured
  // deployment, the same as `workforce-admin.test.ts`.
  vi.stubEnv(ADMIN_TOKENS_ENV, `${ORG}:tok-acme`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mara hires, discover lists the hire, and mara fires it", () => {
  it("lands the hire in the org roster the app reloads, marked as roster-minted, and releases it on fire", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");

    const hired = await runSeat(mara, stores, [
      call("hire", { seatId: "support.pat", flow: "agent", instructions: "You take refunds." }),
      call("discover", { domain: "seats" }),
      { text: "hired" },
    ]);
    expect(hired.error?.message ?? null).toBe(null);
    expect(toolOutput(hired, "hire")).toMatchObject({ address: "acme.support.pat" });
    expect(await storedKeys(stores, ORG, ROSTER)).toEqual(["workforce/roster/support.pat"]);
    expect(held.get("acme.support.pat")?.kind).toBe("agent");
    expect(workforceRegistrar.isFromRoster("acme.support.pat")).toBe(true);
    expect(discoveredSeats(hired)).toEqual(["acme.support.pat"]);

    const fired = await runSeat(mara, stores, [
      call("fire", { seatId: "support.pat" }),
      call("discover", { domain: "seats" }),
      { text: "fired" },
    ]);
    expect(fired.error?.message ?? null).toBe(null);
    expect(toolOutput(fired, "fire")).toMatchObject({ released: true });
    expect(held.has("acme.support.pat")).toBe(false);
    expect(await storedKeys(stores, ORG, ROSTER)).toEqual([]);
    expect(discoveredSeats(fired)).toEqual([]);
    // The inventory row outlives the fire: it records what was registered,
    // not what is still hired. `discover` withholds the seat anyway, because
    // its seat list needs the roster row too.
    expect(await storedKeys(stores, ORG, INVENTORY)).toEqual(["inventory/seats/acme.support.pat"]);
  });
});

describe("under the development organization every default kitchen-sink run uses", () => {
  it("refuses the hire, names the organization, and writes nothing", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");

    const result = await runSeat(
      mara,
      stores,
      [call("hire", { seatId: "support.pat", flow: "agent" }), { text: "hired" }],
      DEFAULT_ORG_ID,
    );

    expect(result.error?.message).toMatch(/Organization id "__fsd_default_org__"/);
    // Read from the store, not from the tool: a refusal that reported
    // correctly but had already written a row would pass the line above.
    expect(await storedKeys(stores, DEFAULT_ORG_ID, ROSTER)).toEqual([]);
    expect(await storedKeys(stores, DEFAULT_ORG_ID, INVENTORY)).toEqual([]);
    expect(held.size).toBe(0);
  });
});

describe("a seat on the same kind that does not name hire", () => {
  it("cannot hire, although the kind offers the tool", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const otto = await fileSeat("support.otto");

    const result = await runSeat(otto, stores, [
      call("hire", { seatId: "support.pat", flow: "agent" }),
      { text: "done" },
    ]);

    expect(result.error?.message ?? null).toBe(null);
    expect(held.size).toBe(0);
    expect(await storedKeys(stores, ORG, ROSTER)).toEqual([]);
  });
});

describe("mara offers the kinds the admin action offers", () => {
  it("hires a desk-clerk with its own desk setting", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");

    const result = await runSeat(mara, stores, [
      call("hire", { seatId: "support.bea", flow: "desk-clerk", settings: { desk: "back" } }),
      { text: "hired" },
    ]);

    expect(result.error?.message ?? null).toBe(null);
    expect(held.get("acme.support.bea")?.kind).toBe("desk-clerk");
    expect(held.get("acme.support.bea")?.config).toMatchObject({ desk: "back" });
  });
});

describe("after a restart", () => {
  it("the app's existing boot reload brings mara's hire back", async () => {
    installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");
    await runSeat(mara, stores, [call("hire", { seatId: "support.pat", flow: "agent" }), { text: "hired" }]);

    const reload = await reloadHiredSeats({ stores, orgIds: [ORG], kinds: kitchenSinkKinds });

    expect(reload.problems).toEqual([]);
    expect(reload.seats.map((seat) => `${seat.id}:${seat.kind}`)).toEqual(["acme.support.pat:agent"]);
  });
});

describe("a seat mara hires with hire in its settings", () => {
  it("can hire in turn", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");
    await runSeat(mara, stores, [
      call("hire", { seatId: "support.pat", flow: "agent", settings: { tools: ["hire"] } }),
      { text: "hired" },
    ]);
    const pat = held.get("acme.support.pat");
    expect(pat).toBeDefined();

    const result = await runSeat(pat!, stores, [
      call("hire", { seatId: "support.quinn", flow: "agent" }),
      { text: "hired" },
    ]);

    expect(result.error?.message ?? null).toBe(null);
    expect(held.has("acme.support.quinn")).toBe(true);
  });
});

describe("mara and the operator share one roster", () => {
  it("the operator's fire releases a seat mara hired", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");
    await runSeat(mara, stores, [call("hire", { seatId: "support.pat", flow: "agent" }), { text: "hired" }]);

    const fired = await callAdmin(stores, "fire", { seatId: "support.pat" });

    expect(fired.error?.message ?? null).toBe(null);
    expect(fired.output).toMatchObject({ address: "acme.support.pat", released: true });
    expect(held.has("acme.support.pat")).toBe(false);
    expect(await storedKeys(stores, ORG, ROSTER)).toEqual([]);
  });

  it("mara's fire refuses a seat the operator hired, and the operator's seat keeps answering", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const hired = await callAdmin(stores, "hire", { seatId: "support.ada2", flow: "desk-clerk", settings: {} });
    expect(hired.error?.message ?? null).toBe(null);
    const operatorAddress = "acme.~admin.support.ada2";
    expect(held.has(operatorAddress)).toBe(true);

    const mara = await fileSeat("support.mara");
    const result = await runSeat(mara, stores, [call("fire", { seatId: "support.ada2" }), { text: "fired" }]);

    expect(result.error?.message).toMatch(/hired no seat "support\.ada2"/);
    expect(held.has(operatorAddress)).toBe(true);
    // The operator's row survived: their own fire still finds and releases it.
    const operatorFire = await callAdmin(stores, "fire", { seatId: "support.ada2" });
    expect(operatorFire.output).toMatchObject({ released: true });
  });
});

describe("mara's fire releases only what the roster door registered", () => {
  it("leaves an address registered some other way answering, with released: false", async () => {
    const held = installRegistrar();
    const stores = createInMemoryStores();
    const mara = await fileSeat("support.mara");
    await runSeat(mara, stores, [call("hire", { seatId: "support.pat", flow: "agent" }), { text: "hired" }]);

    // The address is now held by the same kind, registered without the
    // roster mark — what a seat declared in a folder at that address looks
    // like. The roster row is still there, so mara's fire reaches the release.
    const pat = held.get("acme.support.pat")!;
    workforceRegistrar.unregister(pat.id);
    workforceRegistrar.register(pat);
    expect(workforceRegistrar.isFromRoster(pat.id)).toBe(false);

    const fired = await runSeat(mara, stores, [call("fire", { seatId: "support.pat" }), { text: "fired" }]);

    expect(fired.error?.message ?? null).toBe(null);
    expect(toolOutput(fired, "fire")).toMatchObject({ released: false });
    expect(held.has("acme.support.pat")).toBe(true);
  });
});
