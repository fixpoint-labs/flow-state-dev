/**
 * Registering worker flows, and which workers may run on them (FIX-1789 V2,
 * V3, V4, V7: BR-6, BR-7, BR-10, BR-13 to BR-16, and the door).
 *
 * `hireWorkforce` checks every worker flow once, before any worker is hired,
 * and then resolves each worker: `agent` when it names no flow, and a flow the
 * installation keeps for standard workers refuses a user's own. A user's own
 * worker is a record with an owner pin, as a runtime hire and a stored roster
 * row always are and a `WORKER.md` never is.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createInMemoryStores, executeBlock } from "@flow-state-dev/engine";
import { createTestContext } from "@flow-state-dev/testing";
import { defineSeatInventoryCollection } from "../src/inventory/collections";
import { defineHiredRosterCollection } from "../src/roster/collections";
import { createSeatHireBlocks, HIRED_ROSTER_RESOURCE, SEAT_INVENTORY_RESOURCE } from "../src/seat-hire-blocks";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { checkHiredSeatRow } from "../src/roster/check";
import { HIRED_ROSTER_PREFIX } from "../src/roster/collections";
import { reloadHiredSeats } from "../src/roster/reload";
import { toHiredSeatRow } from "../src/roster/rows";
import { workerConfigSchema } from "../src/worker-config";

const message = z.object({ message: z.string() });
const reply = handler({ name: "registration-reply", inputSchema: message, outputSchema: message, execute: (i) => i });
const door = { inputSchema: message, block: reply, userMessage: (i: { message: string }) => i.message };
const note = z.object({ note: z.string() });
const work = handler({ name: "registration-work", inputSchema: note, outputSchema: note, execute: (i) => i });

function workerFlow(kind: string, over: Record<string, unknown> = {}) {
  return defineFlow({
    kind,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { run: door },
    ...over
  } as never) as unknown as NonNullable<HireOptions["workerFlows"]>[string];
}

const triage = workerFlow("triage");
const coordinator = workerFlow("coordinator");
const doorless = workerFlow("doorless", { actions: { run: { inputSchema: note, block: work } } });
const numbered = workerFlow("numbered", {
  configSchema: workerConfigSchema().extend({ seatId: z.number().optional() })
});
const twoDoors = workerFlow("two-doors", { actions: { ask: door, say: door } });

/** A standard worker: one the installation's files define. */
function standard(id: string, flow?: string): WorkerManifest {
  return { id, declared: flow === undefined ? {} : { flow }, body: "" };
}

/** A user's own worker: a runtime hire or a stored row, so it carries an owner pin. */
function own(id: string, flow?: string): WorkerManifest {
  return {
    id: `acme.~bob.${id}`,
    declared: flow === undefined ? {} : { flow },
    body: "",
    seatId: id,
    ownerPin: { orgId: "acme", userId: "bob" }
  };
}

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("registering worker flows (V2)", () => {
  it("BR-7 · refuses every broken flow in one error, and hires nothing", () => {
    let seats: unknown;
    const message = refusalOf(() => {
      seats = hireWorkforce([standard("support.ada"), standard("support.tri", "triage")], {
        workerFlows: { triage, doorless, numbered }
      });
    });
    expect(seats).toBeUndefined();
    expect(message).toContain('"doorless"');
    expect(message).toContain('"numbered"');
    expect(message).toContain("`seatId`");
    expect(message).not.toContain('worker flow "triage"');
    expect(message).toContain("nothing was hired");
  });

  it("refuses a broken flow before any worker, an empty roster included", () => {
    expect(refusalOf(() => hireWorkforce([], { workerFlows: { doorless } }))).toContain('"doorless"');
  });

  it("V7 · no worker flow hires with no door or two", () => {
    expect(refusalOf(() => hireWorkforce([standard("support.d", "doorless")], { workerFlows: { doorless } }))).toContain(
      "no door"
    );
    const two = refusalOf(() => hireWorkforce([standard("support.t", "two-doors")], { workerFlows: { "two-doors": twoDoors } }));
    expect(two).toContain('"ask"');
    expect(two).toContain('"say"');
  });

  it("BR-6 · registers a flow keeping org data of its own, and hires on it", () => {
    const orgKeeper = workerFlow("org-keeper", {
      resources: {
        board: defineResourceCollection({ pattern: "board/*", scope: "org", stateSchema: z.object({ text: z.string() }) })
      }
    });
    const seats = hireWorkforce([standard("ops.keeper", "org-keeper")], { workerFlows: { "org-keeper": orgKeeper } });
    expect(seats.map((seat) => seat.kind)).toEqual(["org-keeper"]);
  });

  it("BR-10 · with no flows of its own, the installation registers the built-in agent, which passes", () => {
    expect(hireWorkforce([standard("support.ada")]).map((seat) => seat.kind)).toEqual(["agent"]);
    expect(hireWorkforce([standard("support.ada")], { workerFlows: {} }).map((seat) => seat.kind)).toEqual(["agent"]);
  });

  it("BR-9 · registers the built-in agent with mailbox task lists, with no warning", () => {
    const agent = defineAgentWorkerFlow({ taskLists: ["front-desk.queue"] });
    const seats = hireWorkforce([standard("support.ada")], { workerFlows: { agent } as never });
    expect(seats.map((seat) => seat.kind)).toEqual(["agent"]);
  });
});

describe("which workers may run on a flow (V3)", () => {
  const kept: HireOptions["workerFlows"] = { triage, coordinator: { flow: coordinator, standardOnly: true } };

  it("BR-11 · a worker naming a registered flow runs on it", () => {
    expect(hireWorkforce([standard("support.tri", "triage")], { workerFlows: kept }).map((s) => s.kind)).toEqual([
      "triage"
    ]);
  });

  it("BR-14 · refuses a user's own worker naming a standard-only flow, and a standard worker on it runs", () => {
    const message = refusalOf(() => hireWorkforce([own("coord", "coordinator")], { workerFlows: kept }));
    expect(message).toContain('"coordinator"');
    expect(message).toContain("standard workers");
    const seats = hireWorkforce([standard("ops.coord", "coordinator")], { workerFlows: kept });
    expect(seats.map((seat) => seat.kind)).toEqual(["coordinator"]);
  });

  it("a user's own worker runs on a flow that isn't kept", () => {
    expect(hireWorkforce([own("tri", "triage")], { workerFlows: kept }).map((s) => s.kind)).toEqual(["triage"]);
  });

  it("BR-13 · a worker naming no flow is an agent worker, and standard-only is checked after that default", () => {
    const agentKept: HireOptions["workerFlows"] = { agent: { flow: defineAgentWorkerFlow() as never, standardOnly: true } };
    const message = refusalOf(() => hireWorkforce([own("helper")], { workerFlows: agentKept }));
    expect(message).toContain('"agent"');
    expect(message).toContain("standard workers");
    // Named directly, the same refusal.
    expect(refusalOf(() => hireWorkforce([own("helper", "agent")], { workerFlows: agentKept }))).toContain(
      "standard workers"
    );
    // A standard worker naming no flow still runs on it.
    expect(hireWorkforce([standard("support.ada")], { workerFlows: agentKept }).map((s) => s.kind)).toEqual(["agent"]);
  });

  it("BR-16 · a replacement agent passes the same checks, and keeps the installation's flag", () => {
    const replacement = workerFlow("agent");
    const replaced: HireOptions["workerFlows"] = { agent: { flow: replacement, standardOnly: true } };
    expect(refusalOf(() => hireWorkforce([own("helper")], { workerFlows: replaced }))).toContain("standard workers");
    const seats = hireWorkforce([standard("support.ada")], { workerFlows: replaced });
    expect(seats[0]!.kind).toBe("agent");
    expect(seats[0]!.actions).toHaveProperty("run");

    const brokenReplacement = workerFlow("agent", { actions: { run: { inputSchema: note, block: work } } });
    expect(refusalOf(() => hireWorkforce([standard("support.ada")], { workerFlows: { agent: brokenReplacement } }))).toContain(
      'worker flow "agent" has no door'
    );
  });
});

describe("a runtime hire on a standard-only flow (S3, every path)", () => {
  it("BR-14 · refuses a user's own hire, writes no roster row, and registers nothing", async () => {
    const registered: string[] = [];
    const { hire } = createSeatHireBlocks({
      workerFlows: { coordinator: { flow: coordinator, standardOnly: true } },
      register: (seat) => void registered.push(seat.id),
      unregister: () => true
    });
    const { ctx } = await createTestContext({
      orgId: "acme",
      sessionId: "hire-session",
      declaredResources: {
        [HIRED_ROSTER_RESOURCE]: defineHiredRosterCollection(),
        [SEAT_INVENTORY_RESOURCE]: defineSeatInventoryCollection()
      }
    });
    const result = await executeBlock({ block: hire, input: { seatId: "coord", flow: "coordinator" }, ctx });
    expect(String(result.error?.message ?? result.error)).toContain("standard workers");
    const roster = await (ctx.resources as Record<string, { list(): Promise<unknown[]> }>)[HIRED_ROSTER_RESOURCE]!.list();
    expect(roster).toEqual([]);
    expect(registered).toEqual([]);

    // The same tool hires onto a flow that isn't kept.
    const { hire: open } = createSeatHireBlocks({
      workerFlows: { triage },
      register: (seat) => void registered.push(seat.id),
      unregister: () => true
    });
    expect((await executeBlock({ block: open, input: { seatId: "tri", flow: "triage" }, ctx })).error).toBeUndefined();
    expect(registered).toEqual(["acme.tri"]);
  });
});

describe("a stored worker on a flow that became standard-only (V4)", () => {
  const row = toHiredSeatRow({ seatId: "coord", flow: "coordinator", owningOrgId: "acme", ownerUserId: "bob" });

  it("BR-15 · is reported refused with the standard-only sentence", () => {
    const checked = checkHiredSeatRow("acme", row, { coordinator: { flow: coordinator, standardOnly: true } });
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.reason).toBe("refused");
      expect(checked.detail).toContain("standard workers");
    }
    // The same row runs once the mark is removed.
    expect(checkHiredSeatRow("acme", row, { coordinator }).ok).toBe(true);
  });

  it("BR-15 · is skipped at boot and left byte-identical on disk", async () => {
    const stores = createInMemoryStores();
    const key = `${HIRED_ROSTER_PREFIX}coord`;
    await stores.resourceState.set("org", "acme", key, row as never, "any" as never);
    const before = JSON.stringify(await stores.resourceState.get("org", "acme", key));

    const reload = await reloadHiredSeats({
      stores,
      orgIds: ["acme"],
      workerFlows: { coordinator: { flow: coordinator, standardOnly: true } }
    });
    expect(reload.seats).toEqual([]);
    expect(reload.problems).toHaveLength(1);
    expect(JSON.stringify(reload.problems[0])).toContain("standard workers");
    expect(JSON.stringify(await stores.resourceState.get("org", "acme", key))).toBe(before);
  });
});
