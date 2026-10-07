/**
 * Goal check — an app runs a worker only on a flow it registered as a
 * worker flow, and the built-in `agent` keeps a worker's own state off org
 * scope while a shared note names who wrote it.
 *
 * Real path, no model: the roster is read from files, hired through
 * `hireWorkforce`, booted with `createFlowState`, run with `runAction` for two
 * users of one org, and a hired worker comes back from a stored roster row
 * through `reloadHiredSeats`. Graded on what boot refuses and what the store
 * holds after each run, never on what the contract check returns.
 *
 * See goal.md for the contract and the source-revert controls.
 *
 * Run: pnpm tsx goals/worker-contract/runs-workers-only-on-registered-flows/run.mts
 */
import { join } from "node:path";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, ensureSessionRecord, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  createWorkerInstallation,
  HIRED_ROSTER_PREFIX,
  hireWorkforce,
  reloadHiredSeats,
  seatAddress,
  toHiredSeatRow,
  type HireOptions
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import {
  coordinatorFlow,
  doorlessFlow,
  looseAttributionFlow,
  numberedFlow,
  defineSharerFlow,
  orgKeeperFlow,
  triageFlow
} from "./fixtures/flows.ts";

type Fixture = {
  orgId: string;
  alice: string;
  bob: string;
  helper: string;
  scout: string;
  keeper: string;
  coordinator: string;
  keptFlow: string;
  bobsOwn: { seatId: string };
  note: { key: string; text: string };
  board: { key: string; text: string };
  question: string;
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);

/**
 * The app's worker flows. The coordinator is kept for declared workers. The
 * sharer runs its worker on the worker model, which the files' roster builds
 * once read, so it joins the map then.
 */
const registered: NonNullable<HireOptions["workerFlows"]> = {
  triage: triageFlow,
  [fixture.keptFlow]: { flow: coordinatorFlow, standardOnly: true },
  "org-keeper": orgKeeperFlow
};

/** The same app with three flows that each break one rule. */
const BROKEN = { doorless: doorlessFlow, numbered: numberedFlow, "loose-attribution": looseAttributionFlow };

type Access = { user: string; op: string; scopeType: string; scopeId: string; key: string };

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  const tree = await readWorkforce(join(fixtureDir(import.meta.url), "workforce"));
  if (tree.errors.length > 0 || tree.skillErrors.length > 0) {
    return { failures: [`the fixture tree did not load: ${JSON.stringify([tree.errors, tree.skillErrors])}`], evidence: "" };
  }
  const workers = tree.workers;
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => registered });
  registered.sharer = defineSharerFlow(installation);

  // ---- leg a · three broken flows refused at boot, by name; nothing hired ----
  let brokenSeats: FlowInstance[] | undefined;
  let bootError = "";
  try {
    brokenSeats = hireWorkforce(workers, { workerFlows: { ...registered, ...BROKEN } });
  } catch (error) {
    bootError = error instanceof Error ? error.message : String(error);
  }
  if (brokenSeats !== undefined) {
    fail("a", `the app with ${Object.keys(BROKEN).join(", ")} hired ${brokenSeats.length} worker(s)`);
  } else {
    const named = (flow: string) => bootError.includes(`worker flow "${flow}"`);
    if (!named("doorless") || !bootError.includes("no door")) fail("a", `the boot error does not name the doorless flow: ${bootError}`);
    if (!named("numbered") || !bootError.includes("`seatId`")) fail("a", `the boot error does not name numbered's \`seatId\`: ${bootError}`);
    if (!named("loose-attribution") || !bootError.includes("writtenBy")) {
      fail("a", `the boot error does not name loose-attribution's \`writtenBy\`: ${bootError}`);
    }
    for (const good of ["agent", ...Object.keys(registered)]) {
      if (named(good)) fail("a", `the boot error refuses "${good}", which meets the contract`);
    }
    if (!bootError.includes("nothing was hired")) fail("a", `the boot error does not say nothing was hired: ${bootError}`);
    evidence.push(`a: one boot error named doorless, numbered and loose-attribution and hired nothing`);
  }

  // ---- boot the app that meets the contract ------------------------
  const seats = hireWorkforce(workers, { workerFlows: registered });
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const seat = (id: string): FlowInstance => {
    const found = seatById.get(id);
    if (found === undefined) throw new Error(`no seat "${id}" was hired; hired: ${[...seatById.keys()].join(", ")}`);
    return found;
  };
  evidence.push(`booted ${seats.length} workers on ${new Set(seats.map((s) => s.kind)).size} flows`);

  const state = createFlowState({
    flows: Object.fromEntries(seats.map((s) => [s.id, s])),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "Five working days." } }] })
      },
      policy: "allow"
    })
  });

  try {
    const runtime = await state.getRuntime();
    const store = runtime.stores.resourceState;

    // Every touch of the store during a run, with the user the run was for.
    let runningAs = "";
    const accesses: Access[] = [];
    const record = (op: string, scopeType: string, scopeId: string, key: string) =>
      accesses.push({ user: runningAs, op, scopeType, scopeId, key });
    const set = store.set.bind(store);
    store.set = ((scopeType: string, scopeId: string, key: string, ...rest: unknown[]) => {
      record("set", scopeType, scopeId, key);
      return (set as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, key, ...rest);
    }) as typeof store.set;
    const get = store.get.bind(store);
    store.get = ((scopeType: string, scopeId: string, key: string, ...rest: unknown[]) => {
      record("get", scopeType, scopeId, key);
      return (get as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, key, ...rest);
    }) as typeof store.get;
    const getByPrefix = store.getByPrefix.bind(store);
    store.getByPrefix = ((scopeType: string, scopeId: string, prefix: string, ...rest: unknown[]) => {
      record("getByPrefix", scopeType, scopeId, prefix);
      return (getByPrefix as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, prefix, ...rest);
    }) as typeof store.getByPrefix;
    const getAll = store.getAll.bind(store);
    store.getAll = ((scopeType: string, scopeId: string, ...rest: unknown[]) => {
      record("getAll", scopeType, scopeId, "");
      return (getAll as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, ...rest);
    }) as typeof store.getAll;

    const run = async (flow: FlowInstance, actionName: string, user: string, input: unknown) => {
      runningAs = user;
      try {
        return await runAction({
          orgId: fixture.orgId,
          flow,
          actionName,
          input,
          userId: user,
          sessionId: `${user}-${flow.id}-${actionName}`,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
        } as never);
      } finally {
        runningAs = "";
      }
    };

    // ---- leg b · the built-in agent's own state stays in its user's scope ----
    const helper = seat(fixture.helper);
    for (const user of [fixture.alice, fixture.bob]) {
      const result = await run(helper, "run", user, { message: fixture.question });
      if (result.error !== undefined) fail("b", `${user}'s run on ${helper.id} failed: ${JSON.stringify(result.error)}`);
    }
    const drawer = accesses.filter((a) => a.key.startsWith("skills/") && a.user !== "");
    const aliceWrites = drawer.filter((a) => a.user === fixture.alice && a.op === "set");
    if (aliceWrites.length === 0) fail("b", `alice's run on ${helper.id} wrote no skills drawer rows, so nothing below is evidence`);
    const orgRows = aliceWrites.filter((a) => a.scopeType === "org");
    if (orgRows.length > 0) {
      fail("b", `alice's drawer rows are in the org's cells: ${[...new Set(orgRows.map((a) => `org/${a.scopeId}`))].join(", ")}`);
    }
    const aliceCells = new Set(aliceWrites.map((a) => `${a.scopeType}/${a.scopeId}`));
    const bobIntoAlice = drawer.filter((a) => a.user === fixture.bob && aliceCells.has(`${a.scopeType}/${a.scopeId}`));
    if (bobIntoAlice.length > 0) {
      fail("b", `bob's run touched alice's drawer: ${[...new Set(bobIntoAlice.map((a) => `${a.op} ${a.scopeType}/${a.scopeId}`))].join(", ")}`);
    }
    if (orgRows.length === 0 && aliceWrites.length > 0) {
      evidence.push(`b: alice's ${aliceWrites.length} drawer write(s) landed in ${[...aliceCells].map((c) => c.split("/")[0]).join(", ")} scope, none in the org's cells, and bob's run touched none of them`);
    }

    // Her shared note names her, and her worker: the one her session was
    // created with, which the turn loaded.
    const scout = seat(fixture.scout);
    const shareSession = `${fixture.alice}-${scout.id}-share`;
    const now = Date.now();
    await ensureSessionRecord(
      runtime.stores,
      shareSession,
      {
        flow: scout,
        sessionId: shareSession,
        principal: { userId: fixture.alice, orgId: fixture.orgId },
        state: { workerId: fixture.scout },
        fromCaller: true,
        via: "create"
      },
      () => ({
        id: shareSession,
        flowKind: scout.kind,
        flowId: scout.id,
        userId: fixture.alice,
        orgId: fixture.orgId,
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: []
      })
    );
    const shared = await run(scout, "share", fixture.alice, fixture.note);
    if (shared.error !== undefined) fail("b", `alice's note failed: ${JSON.stringify(shared.error)}`);
    const stored = (await get("org", fixture.orgId, `team-notes/${fixture.note.key}`)) as { state?: unknown } | undefined;
    const want = { text: fixture.note.text, writtenBy: { userId: fixture.alice, workerId: fixture.scout } };
    if (JSON.stringify(stored?.state) !== JSON.stringify(want)) {
      fail("b", `the shared note is ${JSON.stringify(stored?.state)}, not ${JSON.stringify(want)}`);
    } else {
      evidence.push(`the shared note is stored naming ${fixture.alice} and ${fixture.scout}`);
    }

    // A flow its author built to keep org data registered, and every member reads what it wrote (Q2).
    const keeper = seat(fixture.keeper);
    const kept = await run(keeper, "keep", fixture.alice, fixture.board);
    const boardRow = (await get("org", fixture.orgId, `team-board/${fixture.board.key}`)) as { state?: { text?: string } } | undefined;
    if (kept.error !== undefined || boardRow?.state?.text !== fixture.board.text) {
      fail("b", `the org-keeper's own org data was not written: ${JSON.stringify(kept.error ?? boardRow)}`);
    }

    // ---- leg c · a hired worker on a kept flow is refused ------------------
    const row = toHiredSeatRow({
      seatId: fixture.bobsOwn.seatId,
      flow: fixture.keptFlow,
      owningOrgId: fixture.orgId,
      ownerUserId: fixture.bob
    });
    const rowKey = `${HIRED_ROSTER_PREFIX}${fixture.bobsOwn.seatId}`;
    await set("org", fixture.orgId, rowKey, row as never, "any" as never);
    const before = JSON.stringify(await get("org", fixture.orgId, rowKey));
    const reload = await reloadHiredSeats({ stores: runtime.stores, orgIds: [fixture.orgId], workerFlows: registered });
    const bobsAddress = seatAddress(fixture.orgId, fixture.bobsOwn.seatId, fixture.bob);
    if (reload.seats.some((s) => s.id === bobsAddress)) {
      fail("c", `bob's hired worker runs on the kept flow "${fixture.keptFlow}"`);
    }
    const problem = reload.problems.join("\n");
    if (!problem.includes(`"${fixture.keptFlow}"`) || !problem.includes("declared workers")) {
      fail("c", `the refusal does not name the kept flow and say it is kept for declared workers: ${problem}`);
    }
    if (JSON.stringify(await get("org", fixture.orgId, rowKey)) !== before) fail("c", "bob's stored worker was changed by the boot");
    const coord = seat(fixture.coordinator);
    const standardRun = await run(coord, "run", fixture.alice, { message: "who takes this?" });
    if (standardRun.error !== undefined) fail("c", `the declared worker on "${fixture.keptFlow}" did not run: ${JSON.stringify(standardRun.error)}`);
    if (!reload.seats.some((s) => s.id === bobsAddress) && standardRun.error === undefined) {
      evidence.push(`c: bob's hired worker on "${fixture.keptFlow}" was refused at reload and left as stored; ${coord.id} ran on it`);
    }
  } finally {
    await state.dispose();
  }

  return { failures, evidence: evidence.join("; ") };
});
