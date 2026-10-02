/**
 * Seat-hire tools that ask a person first (`askBefore`), run where a model
 * runs them: an agent seat's own turn, under durable execution, answered
 * through the same continuation Inbox's Approve and Deny reach.
 *
 * Graded on the stores and the live registry, never on the model's words. A
 * "restart" is a second boot over the same stores: a new registry, a new
 * capability, the hired roster reloaded, nothing carried over in memory.
 *
 * Rules (`specs/issues/FIX-1719/BUSINESS-RULES.md`): BR-8 a hire with `fire`
 * listed asks nothing · BR-9 a kind outside `allowKinds` is refused · BR-10
 * fire asks and changes nothing yet · BR-11 Approve removes the seat · BR-12
 * Deny changes nothing · BR-13 a restart between the ask and the answer keeps
 * the ask · BR-14 a declared seat is refused with no ask · BR-15 `hire` listed
 * asks · BR-16 no durable execution refuses by name · BR-18 `rehire` always
 * asks · BR-20 a hire reusing a declared seat's id is refused. Plus the approve
 * crash promise: a process that dies between the approval and the write, then
 * restarts, makes the change exactly once.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createSQLiteStores, type SQLiteStoreRegistry } from "@flow-state-dev/store-sqlite";
import type {
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  ModelResolver,
  SuspensionRecord,
} from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  runAction,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { createSeatHireCapability, type SeatHireAskVerb } from "../src/seat-hire-capability";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import { reloadHiredSeats } from "../src/roster/reload";
import { HIRED_ROSTER_PREFIX } from "../src/roster/collections";
import { toHiredSeatRow } from "../src/roster/rows";

/**
 * A SQLite file per test, because a restart has to find what the first process
 * wrote, items included: the in-memory request store keeps a run's items only
 * once the run ends, so a process that dies mid-run would leave it nothing.
 */
const opened: SQLiteStoreRegistry[] = [];
afterAll(() => {
  for (const stores of opened) stores.close();
});
type LabStores = SQLiteStoreRegistry & { file: string };
function freshStores(): LabStores {
  const file = join(mkdtempSync(join(tmpdir(), "seat-hire-ask-")), "lab.db");
  return reopen({ file });
}
/** A second connection to the same file: the next process's view. */
function reopen(stores: { file: string }): LabStores {
  const next = Object.assign(createSQLiteStores({ filename: stores.file }), { file: stores.file });
  opened.push(next);
  return next;
}

const ORG = "acme";
const USER = "u_person";
const COS = "chief-of-staff";
const HELPER = "helper";
const HELPER_ADDRESS = `${ORG}.${HELPER}`;
const COS_TOOLS = ["hire", "fire", "rehire", "brokenSeats"];

type Step = (options: GeneratorModelCallOptions) => GeneratorModelResult;

/**
 * A step-capable model that plays `script` in order; `seen` counts the calls.
 * `streaming` offers only `streamStep`, as a real provider's model is driven.
 */
function stepModel(script: Step[], streaming = false) {
  const seen: GeneratorModelCallOptions[] = [];
  const next = (options: GeneratorModelCallOptions): GeneratorModelResult => {
    seen.push(options);
    const entry = script[seen.length - 1];
    if (entry === undefined) throw new Error(`no script entry for step ${seen.length - 1}`);
    return entry(options);
  };
  const model: GeneratorModel = streaming
    ? {
        modelId: "test/stream-step",
        async generate() {
          throw new Error("the owned tool loop calls streamStep");
        },
        async *streamStep(options) {
          const result = next(options);
          if (result.text) yield { type: "text_delta", textDelta: result.text };
          yield { type: "finish", finishReason: result.finishReason ?? "stop", fullResult: result } as never;
        },
      }
    : {
        modelId: "test/step",
        async generate() {
          throw new Error("the owned tool loop calls generateStep");
        },
        async generateStep(options) {
          return next(options);
        },
      };
  const resolver = Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
  return { resolver, seen };
}

const call = (toolName: string, args: Record<string, unknown>, id = "c1"): Step => () => ({
  toolCalls: [{ toolCallId: id, toolName, args }],
  finishReason: "tool-calls",
});
const say = (text: string): Step => () => ({ text, finishReason: "stop" });

/** The tool results the model was handed on its last call, as text. */
function lastToolResults(seen: GeneratorModelCallOptions[]): string {
  const messages = seen.at(-1)?.messages ?? [];
  return JSON.stringify((messages as Array<{ role?: string }>).filter((m) => m.role === "tool"));
}

interface BootOptions {
  askBefore?: readonly SeatHireAskVerb[];
  durable?: boolean;
  /** Stores this process sees; a fault-injecting view of the shared ones. */
  view?: StoreRegistry;
  /** How many stored rows the boot is expected to skip. Default none. */
  reloadProblems?: number;
  /** Drive the model through `streamStep`, as a real provider's is. */
  streaming?: boolean;
}

/**
 * One process: the kinds, the capability, a registry holding the declared
 * chief of staff and every stored hire, and a model playing `script`.
 */
async function boot(stores: StoreRegistry, script: Step[], options: BootOptions = {}) {
  const seen = stepModel(script, options.streaming);
  const registry = createFlowRegistry();
  const released: string[] = [];
  const kinds: NonNullable<HireOptions["kinds"]> = {};
  const seatHire = createSeatHireCapability({
    kinds,
    register: (seat, pin) => registry.register(seat, { pin }),
    unregister: (id) => {
      released.push(id);
      return registry.unregister(id);
    },
    kindAt: (id) => registry.get(id)?.kind,
    allowKinds: ["agent"],
    ...(options.askBefore === undefined ? {} : { askBefore: options.askBefore }),
  });
  kinds.agent = defineAgentWorkerFlow({ uses: [seatHire] });

  const [cos] = hireWorkforce(
    [{ id: COS, declared: { tools: COS_TOOLS }, body: "You are the chief of staff." }],
    { kinds },
  );
  registry.register(cos!);
  const reload = await reloadHiredSeats({ stores, orgIds: [ORG], kinds });
  expect(reload.problems).toHaveLength(options.reloadProblems ?? 0);
  for (const seat of reload.seats) {
    registry.register(seat, { pin: (seat as { ownerPin?: { orgId: string } }).ownerPin ?? { orgId: ORG } });
  }

  const view = options.view ?? stores;
  const durabilityProvider =
    options.durable === false
      ? undefined
      : createCheckpointDurabilityProvider({
          checkpoints: view.checkpoints,
          suspensions: view.suspensions,
          leases: view.leases,
        });
  const runtimeConfig = { modelResolver: seen.resolver, ...(durabilityProvider === undefined ? {} : { durabilityProvider }) };

  /** Ask the chief of staff something; the script decides what it does. */
  const ask = async (message: string) => {
    const result = await runAction({
      orgId: ORG,
      flow: registry.get(COS) as FlowInstance,
      actionName: "run",
      input: { message },
      userId: USER,
      stores: view,
      runtimeConfig,
    } as never);
    return { requestId: result.requestId!, status: (await view.request.get(result.requestId!))?.status };
  };

  /** Answer the pending ask as Inbox does, and run the request on. */
  const answer = async (requestId: string, action: "approve" | "reject") => {
    const [pending] = await pendingAsks(view);
    expect(pending).toBeDefined();
    await durabilityProvider!.suspend({
      ...pending!,
      status: action === "approve" ? "approved" : "rejected",
      resolvedAt: Date.now(),
    });
    return continueRequest({
      requestId,
      stores: view,
      flowRegistry: registry,
      resumeContext: { suspensionId: pending!.suspensionId, action, resumedBy: USER },
      runtimeConfig,
    } as never);
  };

  /** Pick up a request a dead process left, as crash recovery does. */
  const recover = async (requestId: string) => {
    const record = await view.request.get(requestId);
    await view.request.set(requestId, { ...record!, status: "interrupted", interruptedAt: Date.now() } as never, "any");
    const { finished } = await continueRequest({ requestId, stores: view, flowRegistry: registry, runtimeConfig } as never);
    await finished;
    return (await view.request.get(requestId))?.status;
  };

  return { registry, released, seen: seen.seen, ask, answer, recover };
}

async function pendingAsks(stores: StoreRegistry): Promise<SuspensionRecord[]> {
  return (await stores.suspensions.list({ status: "pending" })) as SuspensionRecord[];
}

/** The org's stored roster rows, by seat id. */
async function rosterRows(stores: StoreRegistry): Promise<string[]> {
  const rows = await stores.resourceState.getByPrefix("org", ORG, HIRED_ROSTER_PREFIX);
  return Object.entries(rows)
    .filter(([, record]) => (record as { deleted?: boolean; state?: unknown }).state != null)
    .map(([key]) => key.slice(HIRED_ROSTER_PREFIX.length));
}

/** The org's seat inventory rows, by address. */
async function inventoryRows(stores: StoreRegistry): Promise<string[]> {
  const rows = await stores.resourceState.getByPrefix("org", ORG, "inventory/seats/");
  return Object.entries(rows)
    .filter(([, record]) => (record as { state?: unknown }).state != null)
    .map(([key]) => key.slice("inventory/seats/".length));
}

/** Hire the helper with nothing asked, as the Lab's policy says. */
async function withHelperHired(stores: StoreRegistry) {
  const lab = await boot(stores, [call("hire", { seatId: HELPER, flow: "agent" }), say("hired")], { askBefore: ["fire"] });
  const hired = await lab.ask("we need a helper");
  expect(hired.status).toBe("completed");
  return lab;
}

describe("a hire, with only fire asking first (BR-8)", () => {
  it("lands at once: roster row, inventory row, a registered address, and no ask", async () => {
    const stores = freshStores();
    const lab = await withHelperHired(stores);
    expect(await pendingAsks(stores)).toEqual([]);
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(await inventoryRows(stores)).toContain(HELPER_ADDRESS);
    expect(lab.registry.get(HELPER_ADDRESS)?.kind).toBe("agent");
  });

  it("refuses a kind outside allowKinds, writing nothing (BR-9)", async () => {
    const stores = freshStores();
    const lab = await boot(stores, [call("hire", { seatId: HELPER, flow: "coder" }), say("could not")], { askBefore: ["fire"] });
    expect((await lab.ask("hire a coder")).status).toBe("completed");
    expect(lastToolResults(lab.seen)).toContain("may not hire kind");
    expect(await rosterRows(stores)).toEqual([]);
  });

  it("refuses a seat id a declared seat holds, before any row is written (BR-20)", async () => {
    const stores = freshStores();
    const lab = await boot(stores, [call("hire", { seatId: COS, flow: "agent" }), say("could not")], { askBefore: ["fire"] });
    expect((await lab.ask("hire another chief of staff")).status).toBe("completed");
    expect(lastToolResults(lab.seen)).toContain(`is the id of a seat this app declares`);
    expect(await rosterRows(stores)).toEqual([]);
    expect(await pendingAsks(stores)).toEqual([]);
  });
});

describe("roster admin stays with the seats an app declares", () => {
  it("refuses a hire whose settings grant the roster tools, by a tools line or by picking the seat-hire capability", async () => {
    // Only the chief of staff hires and fires: a seat it hires can't be handed
    // the same tools, whatever the kind.
    const stores = freshStores();
    const lab = await boot(stores, [
      call("hire", { seatId: "deputy", flow: "agent", settings: { tools: ["hire", "fire"] } }, "h1"),
      call("hire", { seatId: "deputy2", flow: "agent", settings: { capabilities: { "seat-hire": ["tools"] } } }, "h2"),
      say("done"),
    ]);
    expect((await lab.ask("hire two deputies who can hire")).status).toBe("completed");
    const results = lastToolResults(lab.seen);
    expect(results.match(/roster tools are the chief of staff's/g)).toHaveLength(2);
    expect(await rosterRows(stores)).toEqual([]);
  });
});

describe("a fire, with fire asking first", () => {
  it("raises one human_approval naming the verb, the seat and its kind, and changes nothing yet (BR-10)", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER })], { askBefore: ["fire"] });
    const fired = await lab.ask("let the helper go");
    expect(fired.status).toBe("suspended");

    const [pending] = await pendingAsks(stores);
    expect(pending?.reason).toBe("human_approval");
    const stored = (await stores.resourceState.get("org", ORG, `${HIRED_ROSTER_PREFIX}${HELPER}`))?.state as
      | { incarnation?: unknown }
      | undefined;
    expect(typeof stored?.incarnation).toBe("string");
    expect(pending?.data).toEqual({ verb: "fire", seatId: HELPER, kind: "agent", owner: null, incarnation: stored?.incarnation });
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(lab.registry.get(HELPER_ADDRESS)).toBeDefined();
    expect(lab.released).toEqual([]);
  });

  it("raises the same ask when the model streams, as a real provider's does", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER }), say("waiting")], { askBefore: ["fire"], streaming: true });
    expect((await lab.ask("let the helper go")).status).toBe("suspended");
    expect((await pendingAsks(stores))[0]?.data).toEqual({ verb: "fire", seatId: HELPER, kind: "agent", owner: null, incarnation: expect.any(String) });
    expect(await rosterRows(stores)).toEqual([HELPER]);
  });

  it("on Approve removes the roster row, the address and the inventory row (BR-11)", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER }), say("done")], { askBefore: ["fire"] });
    const { requestId } = await lab.ask("let the helper go");
    const { finished } = await lab.answer(requestId, "approve");
    await finished;

    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(await rosterRows(stores)).toEqual([]);
    expect(await inventoryRows(stores)).not.toContain(HELPER_ADDRESS);
    expect(lab.registry.get(HELPER_ADDRESS)).toBeUndefined();
    expect(lab.released).toEqual([HELPER_ADDRESS]);
    // And a restart brings nothing back.
    const after = await boot(stores, []);
    expect(after.registry.get(HELPER_ADDRESS)).toBeUndefined();
  });

  it("carries the owner a fire names through the ask to the fire it makes, and refuses one this flow can't reach unasked", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    // The chief of staff mounts the organization's roster only: a seat of
    // the caller's own is refused before anyone is asked.
    const mine = await boot(stores, [call("fire", { seatId: HELPER, owner: "me" }), say("no")], { askBefore: ["fire"] });
    expect((await mine.ask("let my helper go")).status).toBe("completed");
    expect(lastToolResults(mine.seen)).toContain("user-owned roster");
    expect(await pendingAsks(stores)).toEqual([]);

    const lab = await boot(stores, [call("fire", { seatId: HELPER, owner: "organization" }), say("done")], { askBefore: ["fire"] });
    const { requestId } = await lab.ask("let the helper go");
    expect((await pendingAsks(stores))[0]?.data).toMatchObject({ verb: "fire", seatId: HELPER, owner: null });
    const { finished } = await lab.answer(requestId, "approve");
    await finished;
    expect(await rosterRows(stores)).toEqual([]);
    expect(lab.released).toEqual([HELPER_ADDRESS]);
  });

  it("on Approve leaves alone a seat hired under the same id while the person was asked", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const asked = await boot(stores, [call("fire", { seatId: HELPER }), say("done")], { askBefore: ["fire"] });
    const { requestId } = await asked.ask("let the helper go");

    // Meanwhile, through a door that doesn't ask: the helper is fired and a
    // new one hired under the same id.
    const meanwhile = await boot(stores, [
      call("fire", { seatId: HELPER }, "f1"),
      call("hire", { seatId: HELPER, flow: "agent", instructions: "The new helper." }, "h1"),
      say("replaced"),
    ]);
    expect((await meanwhile.ask("replace the helper")).status).toBe("completed");
    const replacement = await stores.resourceState.get("org", ORG, `${HIRED_ROSTER_PREFIX}${HELPER}`);

    const { finished } = await asked.answer(requestId, "approve");
    await finished;
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    expect(lastToolResults(asked.seen)).toContain("changed while you were asked");
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(await stores.resourceState.get("org", ORG, `${HIRED_ROSTER_PREFIX}${HELPER}`)).toEqual(replacement);
    expect(await inventoryRows(stores)).toContain(HELPER_ADDRESS);
  });

  it("on Deny changes nothing, and the model is told (BR-12)", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER }), say("kept")], { askBefore: ["fire"] });
    const { requestId } = await lab.ask("let the helper go");
    const { finished } = await lab.answer(requestId, "reject");
    await finished;

    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(lastToolResults(lab.seen)).toContain("denied");
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(lab.released).toEqual([]);
    const after = await boot(stores, []);
    expect(after.registry.get(HELPER_ADDRESS)?.kind).toBe("agent");
  });

  it("keeps the ask across a restart, and Approve after it removes the seat (BR-13)", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const before = await boot(stores, [call("fire", { seatId: HELPER })], { askBefore: ["fire"] });
    const { requestId } = await before.ask("let the helper go");

    // The process is gone. A new one boots over the same file.
    const next = reopen(stores);
    const after = await boot(next, [say("done")], { askBefore: ["fire"] });
    expect(await pendingAsks(next)).toHaveLength(1);
    expect(after.registry.get(HELPER_ADDRESS)?.kind).toBe("agent");

    const { finished } = await after.answer(requestId, "approve");
    await finished;
    expect(await rosterRows(next)).toEqual([]);
    expect(after.registry.get(HELPER_ADDRESS)).toBeUndefined();
    expect(after.released).toEqual([HELPER_ADDRESS]);
  });

  it("refuses the chief of staff itself with no ask (BR-14)", async () => {
    const stores = freshStores();
    const lab = await boot(stores, [call("fire", { seatId: COS }), say("no")], { askBefore: ["fire"] });
    expect((await lab.ask("fire yourself")).status).toBe("completed");
    expect(lastToolResults(lab.seen)).toContain("removed by editing its folder");
    expect(await pendingAsks(stores)).toEqual([]);
    expect(lab.registry.get(COS)).toBeDefined();
  });

  it("on Approve refuses a seat whose row carries no incarnation, so a replacement written the same way isn't fired unasked", async () => {
    // A writer that stamps no incarnation (an older row, or `toHiredSeatRow`'s
    // default) can fire and replace the seat while the person is asked; with
    // no stamp on either row, nothing tells the replacement from the original.
    const stores = freshStores();
    const key = `${HIRED_ROSTER_PREFIX}${HELPER}`;
    await stores.resourceState.set("org", ORG, key, toHiredSeatRow({ seatId: HELPER, flow: "agent", owningOrgId: ORG }) as never, "any");
    const asked = await boot(stores, [call("fire", { seatId: HELPER }), say("done")], { askBefore: ["fire"] });
    const { requestId } = await asked.ask("let the helper go");
    expect((await pendingAsks(stores))[0]?.data).toMatchObject({ verb: "fire", seatId: HELPER, incarnation: null });

    const replacement = toHiredSeatRow({ seatId: HELPER, flow: "agent", owningOrgId: ORG, instructions: "The new helper." });
    await stores.resourceState.set("org", ORG, key, replacement as never, "any");

    const { finished } = await asked.answer(requestId, "approve");
    await finished;
    expect(lastToolResults(asked.seen)).toContain("carries no incarnation");
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect((await stores.resourceState.get("org", ORG, key))?.state).toEqual(replacement);
    expect(asked.released).toEqual([]);
  });

  it("on Approve refuses a re-hire of a row with no incarnation, even when a different-kind row replaced it", async () => {
    const stores = freshStores();
    const key = `${HIRED_ROSTER_PREFIX}${HELPER}`;
    await stores.resourceState.set("org", ORG, key, toHiredSeatRow({ seatId: HELPER, flow: "retired-kind", owningOrgId: ORG }) as never, "any");
    const asked = await boot(stores, [call("rehire", { seatId: HELPER, flow: "agent" }), say("done")], { reloadProblems: 1 });
    const { requestId } = await asked.ask("put the helper back on the agent kind");

    const replacement = toHiredSeatRow({ seatId: HELPER, flow: "another-retired-kind", owningOrgId: ORG });
    await stores.resourceState.set("org", ORG, key, replacement as never, "any");

    const { finished } = await asked.answer(requestId, "approve");
    await finished;
    expect(lastToolResults(asked.seen)).toContain("carries no incarnation");
    expect((await stores.resourceState.get("org", ORG, key))?.state).toEqual(replacement);
    expect(asked.registry.get(`${ORG}.${HELPER}`)).toBeUndefined();
  });

  it("asks before clearing a hired seat's leftover inventory row, and refuses one that never said it was hired", async () => {
    // A crash between fire's two deletes leaves a `hired: true` inventory row
    // with no roster row; fire still clears it, so the ask is still owed. A
    // row with no `hired` mark is nothing fire removes, so nobody is asked.
    const leftover = async (stores: StoreRegistry, hired: boolean) =>
      stores.resourceState.set(
        "org",
        ORG,
        `inventory/seats/${HELPER_ADDRESS}`,
        { id: HELPER_ADDRESS, kind: "agent", door: null, ...(hired ? { hired: true } : {}) } as never,
        "any",
      );

    const marked = freshStores();
    await leftover(marked, true);
    const asked = await boot(marked, [call("fire", { seatId: HELPER })], { askBefore: ["fire"] });
    expect((await asked.ask("clear the helper")).status).toBe("suspended");
    expect((await pendingAsks(marked))[0]?.data).toEqual({ verb: "fire", seatId: HELPER, kind: null, owner: null, incarnation: null });

    const unmarked = freshStores();
    await leftover(unmarked, false);
    const refused = await boot(unmarked, [call("fire", { seatId: HELPER }), say("no")], { askBefore: ["fire"] });
    expect((await refused.ask("clear the helper")).status).toBe("completed");
    expect(lastToolResults(refused.seen)).toContain("This organization hired no seat");
    expect(await pendingAsks(unmarked)).toEqual([]);
    expect(await inventoryRows(unmarked)).toContain(HELPER_ADDRESS);
  });
});

describe("the approve crash promise", () => {
  /**
   * A view of `stores` that, once armed, never answers a roster write: the
   * process dies at the moment the change would land.
   */
  function dyingAtRosterWrite(stores: StoreRegistry) {
    const state = { armed: false, held: 0 };
    const resourceState = new Proxy(stores.resourceState, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const writes = prop === "set" || prop === "delete";
          if (state.armed && writes && typeof args[2] === "string" && args[2].startsWith(HIRED_ROSTER_PREFIX)) {
            state.held += 1;
            return new Promise(() => {});
          }
          return value.apply(target, args);
        };
      },
    });
    return { view: { ...stores, resourceState } as StoreRegistry, state };
  }

  it("dies between Approve and the fire, restarts, and fires exactly once", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const { view, state } = dyingAtRosterWrite(stores);
    const doomed = await boot(stores, [call("fire", { seatId: HELPER }), say("never reached")], { askBefore: ["fire"], view });
    const { requestId } = await doomed.ask("let the helper go");
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    state.armed = true;
    void (await doomed.answer(requestId, "approve")).finished;
    for (let i = 0; i < 200 && state.held === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(state.held).toBe(1);
    // Approved, and nothing changed: the process died before the write landed.
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(doomed.released).toEqual([]);

    const next = reopen(stores);
    const restarted = await boot(next, [say("done")], { askBefore: ["fire"] });
    expect(restarted.registry.get(HELPER_ADDRESS)?.kind).toBe("agent");
    expect(await restarted.recover(requestId)).toBe("completed");

    expect(await rosterRows(next)).toEqual([]);
    expect(await inventoryRows(next)).not.toContain(HELPER_ADDRESS);
    expect(restarted.released).toEqual([HELPER_ADDRESS]);
    // No second ask was raised for the approved change.
    expect(await pendingAsks(next)).toEqual([]);
  });

  it("dies after the fire landed and before the turn ended, restarts, and does not fire again", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    let died = false;
    const doomed = await boot(
      stores,
      [
        call("fire", { seatId: HELPER }),
        () => {
          died = true;
          return new Promise<never>(() => {}) as never;
        },
      ],
      { askBefore: ["fire"] },
    );
    const { requestId } = await doomed.ask("let the helper go");
    void (await doomed.answer(requestId, "approve")).finished;
    for (let i = 0; i < 200 && !died; i++) await new Promise((r) => setTimeout(r, 5));
    expect(died).toBe(true);
    expect(await rosterRows(stores)).toEqual([]);
    expect(doomed.released).toEqual([HELPER_ADDRESS]);

    const next = reopen(stores);
    const restarted = await boot(next, [say("done")], { askBefore: ["fire"] });
    expect(await restarted.recover(requestId)).toBe("completed");
    expect(await rosterRows(next)).toEqual([]);
    // The fire is not made a second time, and the model was handed its first result, not a refusal.
    expect(restarted.released).toEqual([]);
    expect(lastToolResults(restarted.seen)).toContain(HELPER_ADDRESS);
    expect(lastToolResults(restarted.seen)).not.toContain("hired no seat");
  });
});

describe("what asks, and where it can't", () => {
  it("asks before a hire when the Lab lists hire, and Approve then hires (BR-15)", async () => {
    const stores = freshStores();
    const lab = await boot(stores, [call("hire", { seatId: HELPER, flow: "agent" }), say("hired")], { askBefore: ["hire", "fire"] });
    const { requestId, status } = await lab.ask("we need a helper");
    expect(status).toBe("suspended");
    expect((await pendingAsks(stores))[0]?.data).toEqual({ verb: "hire", seatId: HELPER, kind: "agent", owner: null, incarnation: null });
    expect(await rosterRows(stores)).toEqual([]);

    await (await lab.answer(requestId, "approve")).finished;
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(lab.registry.get(HELPER_ADDRESS)?.kind).toBe("agent");
  });

  it("refuses a listed verb by name without durable execution, changing nothing (BR-16)", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER }), say("could not")], { askBefore: ["fire"], durable: false });
    expect((await lab.ask("let the helper go")).status).toBe("completed");
    expect(lastToolResults(lab.seen)).toContain(`\\"fire\\" waits for a person's approval here, and this app can't ask for one`);
    expect(await rosterRows(stores)).toEqual([HELPER]);
    expect(lab.released).toEqual([]);
  });

  it("asks before a re-hire even with askBefore empty (BR-18)", async () => {
    const stores = freshStores();
    // A stored seat whose kind this app no longer carries.
    await stores.resourceState.set(
      "org",
      ORG,
      `${HIRED_ROSTER_PREFIX}${HELPER}`,
      toHiredSeatRow({ seatId: HELPER, flow: "retired-kind", owningOrgId: ORG }) as never,
      "any",
    );
    const lab = await boot(stores, [call("rehire", { seatId: HELPER, flow: "agent" })], { askBefore: [], reloadProblems: 1 });
    expect((await lab.ask("put the helper back on the agent kind")).status).toBe("suspended");
    expect((await pendingAsks(stores))[0]?.data).toEqual({ verb: "rehire", seatId: HELPER, kind: "agent", owner: null, incarnation: null });
  });

  it("asks nothing with askBefore omitted: a fire lands at once, as before the option", async () => {
    const stores = freshStores();
    await withHelperHired(stores);
    const lab = await boot(stores, [call("fire", { seatId: HELPER }), say("done")]);
    expect((await lab.ask("let the helper go")).status).toBe("completed");
    expect(await pendingAsks(stores)).toEqual([]);
    expect(await rosterRows(stores)).toEqual([]);
  });

  it("refuses an askBefore entry it does not know", () => {
    expect(() =>
      createSeatHireCapability({ register: () => {}, unregister: () => true, askBefore: ["rehire" as never] }),
    ).toThrow(/askBefore names "rehire"/);
  });
});
