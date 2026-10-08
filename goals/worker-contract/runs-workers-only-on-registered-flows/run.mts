/**
 * Goal check — an app runs a worker only on a flow it registered as a
 * worker flow, and the built-in `agent` keeps a worker's own state off org
 * scope while a shared note names who wrote it.
 *
 * Real path, no model: the roster is read from files, registered through
 * `hireWorkforce`, booted with `createFlowState`, and run with `runAction`
 * for two users of one org, each in a session created naming its worker. A
 * user's own worker on a flow kept for declared workers is refused when a
 * session names it. Graded on what boot refuses and what the store holds
 * after each run, never on what the contract check returns.
 *
 * See goal.md for the contract and the source-revert controls.
 *
 * Run: pnpm tsx goals/worker-contract/runs-workers-only-on-registered-flows/run.mts
 */
import { join } from "node:path";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, ensureSessionRecord, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { resolveUserStorageKey } from "@flow-state-dev/engine";
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { defineFlows } from "./fixtures/flows.ts";

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
  /** The app's installation, with the broken flows beside its own when `broken`. The coordinator is kept for declared workers. */
  const install = (broken: boolean) => {
    let flows: Record<string, unknown> = {};
    const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
    const built = defineFlows(installation);
    flows = {
      ...built.registered,
      [fixture.keptFlow]: { flow: built.registered.coordinator, standardOnly: true },
      ...(broken ? built.broken : {})
    };
    return { installation, registered: Object.keys(built.registered), broken: Object.keys(built.broken) };
  };

  // ---- leg a · three broken flows refused at boot, by name; nothing hired ----
  let brokenSeats: FlowInstance[] | undefined;
  let bootError = "";
  const withBroken = install(true);
  try {
    brokenSeats = hireWorkforce(withBroken.installation);
  } catch (error) {
    bootError = error instanceof Error ? error.message : String(error);
  }
  if (brokenSeats !== undefined) {
    fail("a", `the app with ${withBroken.broken.join(", ")} registered ${brokenSeats.length} cop(ies)`);
  } else {
    const named = (flow: string) => bootError.includes(`worker flow "${flow}"`);
    if (!named("doorless") || !bootError.includes("no door")) fail("a", `the boot error does not name the doorless flow: ${bootError}`);
    if (!named("numbered") || !bootError.includes("`seatId`")) fail("a", `the boot error does not name numbered's \`seatId\`: ${bootError}`);
    if (!named("loose-attribution") || !bootError.includes("writtenBy")) {
      fail("a", `the boot error does not name loose-attribution's \`writtenBy\`: ${bootError}`);
    }
    for (const good of ["agent", ...withBroken.registered]) {
      if (named(good)) fail("a", `the boot error refuses "${good}", which meets the contract`);
    }
    if (!bootError.includes("nothing was hired")) fail("a", `the boot error does not say nothing was hired: ${bootError}`);
    evidence.push(`a: one boot error named doorless, numbered and loose-attribution and hired nothing`);
  }

  // ---- boot the app that meets the contract ------------------------
  const { installation } = install(false);
  const copies = hireWorkforce(installation);
  const copyById = new Map(copies.map((copy) => [copy.id, copy]));
  /** The copy of the flow `workerId` runs on. */
  const flowOf = (workerId: string): FlowInstance => {
    const kind = (installation.standardWorker(workerId)?.declared.flow as string | undefined) ?? "agent";
    const found = copyById.get(kind);
    if (found === undefined) throw new Error(`no copy of "${kind}" was registered; registered: ${[...copyById.keys()].join(", ")}`);
    return found;
  };
  evidence.push(`booted ${workers.length} workers on ${copies.length - 1} flows, one copy each`);

  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
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

    /** Open `sessionId` naming `worker`, through the one session-birth path, as `user`. */
    const open = async (worker: string, user: string, sessionId: string) => {
      const flow = flowOf(worker);
      const now = Date.now();
      await ensureSessionRecord(
        runtime.stores,
        sessionId,
        {
          flow,
          sessionId,
          principal: { userId: user, orgId: fixture.orgId },
          state: { workerId: worker },
          fromCaller: true,
          via: "create"
        },
        () => ({
          id: sessionId,
          flowKind: flow.kind,
          flowId: flow.id,
          userId: user,
          orgId: fixture.orgId,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        })
      );
    };
    /** One turn of `worker`'s `actionName`, as `user`, in a session naming the worker. */
    const run = async (worker: string, actionName: string, user: string, input: unknown) => {
      const sessionId = `${user}-${worker}-${actionName}`;
      await open(worker, user, sessionId);
      runningAs = user;
      try {
        return await runAction({
          orgId: fixture.orgId,
          flow: flowOf(worker),
          actionName,
          input,
          userId: user,
          sessionId,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
        } as never);
      } finally {
        runningAs = "";
      }
    };

    // ---- leg b · the built-in agent's own state stays in its user's scope ----
    for (const user of [fixture.alice, fixture.bob]) {
      const result = await run(fixture.helper, "run", user, { message: fixture.question });
      if (result.error !== undefined) fail("b", `${user}'s run on ${fixture.helper} failed: ${JSON.stringify(result.error)}`);
    }
    const drawer = accesses.filter((a) => a.key.startsWith("skills/") && a.user !== "");
    const aliceWrites = drawer.filter((a) => a.user === fixture.alice && a.op === "set");
    if (aliceWrites.length === 0) fail("b", `alice's run on ${fixture.helper} wrote no skills drawer rows, so nothing below is evidence`);
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
    const shared = await run(fixture.scout, "share", fixture.alice, fixture.note);
    if (shared.error !== undefined) fail("b", `alice's note failed: ${JSON.stringify(shared.error)}`);
    const stored = (await get("org", fixture.orgId, `team-notes/${fixture.note.key}`)) as { state?: unknown } | undefined;
    const want = { text: fixture.note.text, writtenBy: { userId: fixture.alice, workerId: fixture.scout } };
    if (JSON.stringify(stored?.state) !== JSON.stringify(want)) {
      fail("b", `the shared note is ${JSON.stringify(stored?.state)}, not ${JSON.stringify(want)}`);
    } else {
      evidence.push(`the shared note is stored naming ${fixture.alice} and ${fixture.scout}`);
    }

    // A flow its author built to keep org data registered, and every member reads what it wrote (Q2).
    const kept = await run(fixture.keeper, "keep", fixture.alice, fixture.board);
    const boardRow = (await get("org", fixture.orgId, `team-board/${fixture.board.key}`)) as { state?: { text?: string } } | undefined;
    if (kept.error !== undefined || boardRow?.state?.text !== fixture.board.text) {
      fail("b", `the org-keeper's own org data was not written: ${JSON.stringify(kept.error ?? boardRow)}`);
    }

    // ---- leg c · a user's own worker on a kept flow is refused ---------------
    // Bob's own worker row, naming the kept flow, as a row written before the
    // flow was kept for declared workers leaves it: hire refuses to write one now.
    const bobsCell = resolveUserStorageKey(fixture.bob, fixture.orgId, { id: "", isolateUserState: false });
    const rowKey = `workforce/workers/${fixture.bobsOwn.seatId}`;
    const row = {
      flow: fixture.keptFlow,
      description: null,
      instructions: "You hand work on.",
      teamInstructions: null,
      skills: [],
      settings: {},
      forkedFrom: null
    };
    await set("user", bobsCell, rowKey, row as never, "any" as never);
    const before = JSON.stringify(await get("user", bobsCell, rowKey));
    let refusal = "";
    try {
      const flow = copyById.get(fixture.keptFlow)!;
      const sessionId = `${fixture.bob}-${fixture.bobsOwn.seatId}`;
      const now = Date.now();
      await ensureSessionRecord(
        runtime.stores,
        sessionId,
        {
          flow,
          sessionId,
          principal: { userId: fixture.bob, orgId: fixture.orgId },
          state: { workerId: fixture.bobsOwn.seatId },
          fromCaller: true,
          via: "create"
        },
        () => ({ id: sessionId, flowKind: flow.kind, flowId: flow.id, userId: fixture.bob, orgId: fixture.orgId, version: 0, createdAt: now, updatedAt: now, journal: [] })
      );
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    if (refusal === "") fail("c", `bob's own worker runs on the kept flow "${fixture.keptFlow}"`);
    else if (!refusal.includes(`"${fixture.keptFlow}"`) || !refusal.includes("declared workers")) {
      fail("c", `the refusal does not name the kept flow and say it is kept for declared workers: ${refusal}`);
    }
    if (JSON.stringify(await get("user", bobsCell, rowKey)) !== before) fail("c", "bob's stored worker was changed");
    const standardRun = await run(fixture.coordinator, "run", fixture.alice, { message: "who takes this?" });
    if (standardRun.error !== undefined) fail("c", `the declared worker on "${fixture.keptFlow}" did not run: ${JSON.stringify(standardRun.error)}`);
    if (refusal !== "" && standardRun.error === undefined) {
      evidence.push(`c: a session naming bob's own worker on "${fixture.keptFlow}" was refused and his row left as stored; ${fixture.coordinator} ran on it`);
    }
  } finally {
    await state.dispose();
  }

  return { failures, evidence: evidence.join("; ") };
});
