// FIX-2621; the store recorder is the twin of FIX-2286 D1's read-only stores.
// Run with `bash specs/issues/FIX-2621/poc/dependency-check/run.sh`.
/**
 * A proof of concept: retained design evidence, not production code.
 *
 * The question: can a test fail a view that reads something its `dependsOn`
 * does not declare, on the real read paths, at a cost a developer keeps on?
 *
 * Two recorders run the same real reads through `runRead`, unchanged:
 *
 *   - the STORE recorder, the read-only stores' twin: a proxy
 *     over every store the read is handed, recording each call it makes;
 *   - the CONTEXT recorder: the read's block run with its `ctx` behind a proxy
 *     that records which scope state and which resources the block reaches.
 *
 * The reads: the conversation board's `listTasks_tasks` (`taskToolReads`, via
 * workforce's coordinator), the claude-code-style lab's `listPins` (its user
 * state), and `listTasks_<id>` on a `taskBoard()`, reached through the
 * board's own recorded resolver. A fourth, the probe, reads one block down
 * (a sequencer step) to find a path the context recorder can't see.
 *
 * Each read's `dependsOn` is written by hand, from what the read is for, as a
 * view's author would. Nothing derives it from the block's source or from a
 * recording. Every control (one entry removed) must FAIL naming that entry,
 * and is asserted before the full declaration's PASS.
 */
import { DEFAULT_ORG_ID, handler, sequencer } from "@flow-state-dev/core";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { runRead } from "@flow-state-dev/engine/internal";
import { taskToolReads } from "@flow-state-dev/orchestration/internal";
import { taskBoard, taskToolActions } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, type TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { defineFlow } from "@flow-state-dev/core";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
// Off the public surface on purpose: the board's own handle, as `taskToolActions(board)` reaches it.
import { boardResolverOf } from "../../orchestration/src/task-board/board-resolver";
import { definePinsFlow } from "../../../labs/claude-code-style/workforce/flows/pins.mts";
import { bootBoardHost, ORG } from "./conversation-board-harness";

// ---------------------------------------------------------------------------
// The two recorders
// ---------------------------------------------------------------------------

/** A dependency as a view would declare it: a scope's state, or one resource by accessor. */
type Dep = `${"session" | "user" | "org"}.state` | `resource:${string}`;

const SCOPES = ["session", "user", "org"] as const;

/**
 * Replace `obj[prop]` on `obj` itself with a getter passing each read through
 * `onRead`, keeping `obj`'s identity. A property it can't redefine is listed
 * in `unrecordable`, so a gap shows instead of passing quietly.
 */
function recordOn(obj: any, prop: string, unrecordable: Set<string>, onRead: (value: unknown) => unknown): void {
  let owner = obj;
  let found: PropertyDescriptor | undefined;
  while (owner != null && (found = Object.getOwnPropertyDescriptor(owner, prop)) === undefined) owner = Object.getPrototypeOf(owner);
  if (found === undefined) return;
  const d = found;
  let held = d.value;
  try {
    Object.defineProperty(obj, prop, {
      configurable: true,
      enumerable: d.enumerable ?? true,
      get: () => onRead(d.get !== undefined ? d.get.call(obj) : held),
      set: (next) => {
        if (d.set !== undefined) d.set.call(obj, next);
        else held = next;
      }
    });
  } catch {
    unrecordable.add(prop);
  }
}

/**
 * The read's block, run with its own `ctx` recorded. Records `<scope>.state`
 * and `resource:<accessor>` (through `ctx.resources` or a scope's
 * `resources`). Anything it could not record lands in `unrecordable`.
 *
 * Two modes, because neither sees everything from outside the engine:
 *
 *   - `in-place`: the context and its scope objects keep their identity; only
 *     the resource registry is proxied, and properties are redefined on the
 *     objects themselves. A scope's `state` is a non-configurable getter the
 *     engine defines, so it can't be redefined: it lands in `unrecordable`.
 *   - `proxy`: the context and scope objects are put behind proxies, which see
 *     `state`. But code keys state by those objects' identity (workforce's
 *     verified worker is a WeakMap on the session object), and a proxy in
 *     their place silently takes another branch: the board then never reaches
 *     its plan ledger, so the recorder never sees it.
 */
function contextRecorded(flow: any, readName: string, mode: "in-place" | "proxy" | "off" = "in-place") {
  const touched = new Set<string>();
  const unrecordable = new Set<string>();
  const onResources = (res: any) =>
    new Proxy(res, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (typeof p === "string" && typeof v !== "function") touched.add(`resource:${p}`);
        else if (typeof p === "string") unrecordable.add(`resources.${p}()`);
        return typeof v === "function" ? v.bind(t) : v;
      }
    });
  const inPlace = (ctx: any) => {
    recordOn(ctx, "resources", unrecordable, (v) => (v == null ? v : onResources(v)));
    for (const scope of SCOPES) {
      const s = ctx[scope];
      if (s == null) continue;
      const missed = new Set<string>();
      recordOn(s, "state", missed, (v) => {
        touched.add(`${scope}.state`);
        return v;
      });
      recordOn(s, "resources", missed, (v) => (v == null ? v : onResources(v)));
      for (const prop of missed) unrecordable.add(`${scope}.${prop}`);
    }
    return ctx;
  };
  const proxied = (ctx: any) => {
    const onScope = (scope: string, s: any) =>
      new Proxy(s, {
        get(t, p) {
          const v = Reflect.get(t, p, t);
          if (p === "state") touched.add(`${scope}.state`);
          else if (p === "resources" && v != null) return onResources(v);
          return typeof v === "function" ? v.bind(t) : v;
        }
      });
    return new Proxy(ctx, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        if (p === "resources" && v != null) return onResources(v);
        if (typeof p === "string" && (SCOPES as readonly string[]).includes(p) && v != null) return onScope(p, v);
        return typeof v === "function" ? v.bind(t) : v;
      }
    });
  };
  const wrap = mode === "in-place" ? inPlace : mode === "proxy" ? proxied : (ctx: any) => ctx;
  const read = flow.reads[readName];
  const block = read.block;
  const recordedBlock = Object.assign(Object.create(Object.getPrototypeOf(block)), block, {
    run: (input: unknown, ctx: unknown) => block.run(input, wrap(ctx))
  });
  const recordedFlow = Object.assign(Object.create(Object.getPrototypeOf(flow)), flow, {
    reads: { ...flow.reads, [readName]: { ...read, block: recordedBlock } }
  });
  return { flow: recordedFlow, touched, unrecordable };
}

/** The longest static prefix of a resource's storage key or pattern (`tasks/**` → `tasks/`). */
function staticPrefix(config: any, accessor: string): string {
  const pattern: string | undefined = config?.pattern;
  if (pattern === undefined) return config?.key ?? accessor;
  const parts = pattern.split("/");
  const fixed = parts.slice(0, parts.findIndex((p) => p.includes("*") || p.includes("[")));
  return fixed.length === 0 ? "" : `${fixed.join("/")}/`;
}

/**
 * The stores, with every call recorded and mapped onto the same vocabulary:
 * a scope record's read is `<scope>.state`, a resource row's is the accessor
 * whose prefix covers its key, and anything else is `<store>.<verb>`.
 */
function storeRecorded(stores: any, flow: any) {
  const touched = new Set<string>();
  const prefixes = Object.entries(flow.resources ?? {})
    .map(([accessor, config]) => ({ accessor, prefix: staticPrefix(config, accessor) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const unitOf = (store: string, verb: string, args: unknown[]): string => {
    if (store === "session" || store === "user" || store === "org") return `${store}.state`;
    if (store === "resourceState" || store === "content") {
      const key = String(args[2] ?? "");
      return `resource:${prefixes.find((p) => key.startsWith(p.prefix) && p.prefix !== "")?.accessor ?? `?${key}`}`;
    }
    return `${store}.${verb}`;
  };
  const recorded: any = {};
  for (const [name, store] of Object.entries(stores)) {
    recorded[name] =
      store === null || typeof store !== "object"
        ? store
        : new Proxy(store as object, {
            get(t, p, r) {
              const v = Reflect.get(t, p, r);
              if (typeof v !== "function" || typeof p !== "string") return v;
              return (...args: unknown[]) => {
                if (process.env.FIX2621_RAW !== undefined) console.log(`store call · ${name}.${p}(${args.filter((a) => typeof a === "string").join(", ")})`);
                touched.add(unitOf(name, p, args));
                return v.apply(t, args);
              };
            }
          });
  }
  return { stores: recorded, touched };
}

/** The check a view's test runs: every dependency the run touched is declared. Names each one missing. */
function checkDependsOn(viewName: string, touched: Iterable<string>, dependsOn: readonly string[]): void {
  const missing = [...touched].filter((d) => !dependsOn.includes(d)).sort();
  if (missing.length > 0) {
    throw new Error(`view "${viewName}" reads ${missing.join(", ")} but its dependsOn does not declare ${missing.length === 1 ? "it" : "them"}`);
  }
}

// ---------------------------------------------------------------------------
// The reads, each a fresh run under a recorder
// ---------------------------------------------------------------------------

type Run = (stores: any, flow: any) => Promise<unknown>;
type Subject = { name: string; flow: any; readName: string; stores: any; run: Run; dependsOn: Dep[]; firstDraft?: Dep[] };

async function boardSubject(): Promise<Subject & { dispose: () => Promise<void> }> {
  const host = bootBoardHost();
  const conv = await host.conversation("alice", "desk");
  const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Audit licenses", assignee: "eng.tasker", held: true });
  expect(filed.error).toBeUndefined();
  await host.settled();
  const runtime = await host.state.getRuntime();
  return {
    name: "conversation board · listTasks_tasks",
    flow: host.instances.coordinator,
    readName: "listTasks_tasks",
    stores: runtime.stores,
    run: (stores, flow) =>
      runRead({ flow, readName: "listTasks_tasks", input: {}, userId: "alice", orgId: ORG, sessionId: conv, stores, runtimeConfig: runtime.runtimeConfig as never }),
    // The rows; the worker's own steps beside them (the plan ledger); who works
    // them (the roster says whether the session files at all); and the
    // session's own state (its worker and delegates pick the partition and the gate).
    dependsOn: ["resource:tasks", "resource:plan", "resource:workforceWorkers", "session.state"],
    // What an author writes first, knowing only that it's the board's list.
    firstDraft: ["resource:tasks"],
    dispose: () => host.dispose()
  };
}

async function pinsSubject(): Promise<Subject> {
  const flow = (definePinsFlow() as any)();
  const stores = await inMemoryStores().resolve();
  const pinned = await runAction({ flow, actionName: "pin", input: { taskId: "task-1" }, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "pins-s", stores, runtimeConfig: {} } as never);
  expect((pinned as { error?: unknown }).error).toBeUndefined();
  return {
    name: "lab pins · listPins",
    flow,
    readName: "listPins",
    stores,
    run: (s, f) => runRead({ flow: f, readName: "listPins", input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "pins-s", stores: s }),
    dependsOn: ["user.state"]
  };
}

const noopWorker = handler({ name: "noop-worker", inputSchema: z.unknown(), outputSchema: z.null(), execute: () => null }) as TaskWorker;

async function boardHandleSubject(): Promise<Subject> {
  const id = "todos";
  const board = taskBoard({ name: "todo-board", collection: defineTaskCollection({ id, scope: "session" }), workers: noopWorker });
  const resolve = boardResolverOf(board)!;
  const flow = defineFlow({ kind: "todo-host", actions: taskToolActions(board), reads: taskToolReads(id, resolve) } as never)();
  const stores = await inMemoryStores().resolve();
  const readName = Object.keys((flow as any).reads)[0]!;
  const createName = Object.keys((flow as any).actions).find((n) => n.startsWith("createTask"))!;
  const filed = await runAction({ flow, actionName: createName, input: { goal: "Write the notes", held: true }, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "todo-s", stores, runtimeConfig: {} } as never);
  expect((filed as { error?: unknown }).error).toBeUndefined();
  return {
    name: `taskBoard() handle · ${readName}`,
    flow,
    readName,
    stores,
    run: (s, f) => runRead({ flow: f, readName, input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "todo-s", stores: s }),
    dependsOn: ["resource:todos"]
  };
}

/**
 * Two runs of `subject`: the in-place context recorder with the store
 * recorder, then the proxy context recorder. `context` is what either saw.
 */
async function recordOnce(subject: Subject) {
  const inPlace = contextRecorded(subject.flow, subject.readName, "in-place");
  const storeRec = storeRecorded(subject.stores, subject.flow);
  const output = await subject.run(storeRec.stores, inPlace.flow);
  const proxied = contextRecorded(subject.flow, subject.readName, "proxy");
  const proxyOutput = await subject.run(subject.stores, proxied.flow);
  const context = new Set([...inPlace.touched, ...proxied.touched]);
  return { output, proxyOutput, inPlace: inPlace.touched, unrecordable: inPlace.unrecordable, proxy: proxied.touched, context, store: storeRec.touched };
}

const report: string[] = [];
afterAll(() => {
  console.log(`\n===== dependency-check POC =====\n${report.join("\n")}\n`);
});

/** Each control FAILs naming the entry it removed, then the full declaration PASSes. */
function controlsThenPass(subject: Subject, touched: Set<string>, recorder: string) {
  for (const left of subject.dependsOn) {
    const without = subject.dependsOn.filter((d) => d !== left);
    expect(() => checkDependsOn(subject.name, touched, without), `${recorder}: leaving out ${left}`).toThrow(left);
    report.push(`  FAIL (control, expected) · ${recorder} · without ${left}: ${(() => { try { checkDependsOn(subject.name, touched, without); return "passed?!"; } catch (e) { return (e as Error).message; } })()}`);
  }
  expect(() => checkDependsOn(subject.name, touched, subject.dependsOn)).not.toThrow();
  report.push(`  PASS · ${recorder} · dependsOn [${subject.dependsOn.join(", ")}]`);
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

describe("a view's dependsOn, checked against what it reads", () => {
  for (const make of [boardSubject, pinsSubject, boardHandleSubject]) {
    it(`${make.name}: the context recorders catch each left-out dependency between them, and the store recorder over-reports`, async () => {
      const subject = await make();
      try {
        const { output, proxyOutput, inPlace, unrecordable, proxy, context, store } = await recordOnce(subject);
        expect(output).toBeTruthy();
        const list = (xs: Iterable<string>) => [...xs].sort().join(", ") || "nothing";
        report.push(`\n${subject.name}`);
        report.push(`  in place saw: ${list(inPlace)} · couldn't record: ${list(unrecordable)}`);
        report.push(`  proxy saw:    ${list(proxy)}${JSON.stringify(proxyOutput) === JSON.stringify(output) ? "" : " · and answered differently"}`);
        report.push(`  store saw:    ${list(store)}`);
        // Neither context recorder alone sees everything (see contextRecorded).
        const proxyMissed = [...inPlace].filter((d) => !proxy.has(d));
        const inPlaceMissed = [...proxy].filter((d) => !inPlace.has(d));
        report.push(`  proxy missed (its run took another branch): ${list(proxyMissed)} · in place missed: ${list(inPlaceMissed)}`);

        controlsThenPass(subject, context, "context (either recorder)");
        if (subject.firstDraft !== undefined) {
          expect(() => checkDependsOn(subject.name, context, subject.firstDraft!)).toThrow();
          report.push(`  FAIL (first draft [${subject.firstDraft.join(", ")}]) · context: ${(() => { try { checkDependsOn(subject.name, context, subject.firstDraft!); return ""; } catch (e) { return (e as Error).message; } })()}`);
        }

        // The store recorder sees every touch the context does (sound) ...
        for (const dep of context) expect(store.has(dep), `store recorder missed ${dep}`).toBe(true);
        // ... and more: what the read's context loaded, not what the view read.
        const extra = [...store].filter((d) => !context.has(d)).sort();
        report.push(`  store-only (loaded by the context, not read by the view): ${extra.join(", ") || "none"}`);
        expect(() => checkDependsOn(subject.name, store, subject.dependsOn)).toThrow();
      } finally {
        await (subject as { dispose?: () => Promise<void> }).dispose?.();
      }
    });
  }

  it("probe · a read one block down (a sequencer step) is a path the context recorder can't see", async () => {
    const step = handler({
      name: "step-reads-user",
      inputSchema: z.unknown(),
      outputSchema: z.object({ pinned: z.array(z.string()) }),
      userStateSchema: z.object({ pinned: z.array(z.string()).default([]) }),
      execute: (_input, ctx) => ({ pinned: (ctx.user.state as { pinned: string[] }).pinned })
    });
    const flow = defineFlow({
      kind: "composed",
      user: { stateSchema: z.object({ pinned: z.array(z.string()).default([]) }) },
      actions: { open: { inputSchema: z.object({}), block: step } },
      reads: { composed: { block: sequencer({ name: "composed", inputSchema: z.object({}) }).step(step) } }
    } as never)();
    const stores = await inMemoryStores().resolve();
    // A session no action has run in can't be read (its birth writes), so open it first.
    await runAction({ flow, actionName: "open", input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "composed-s", stores, runtimeConfig: {} } as never);
    const subject: Subject = {
      name: "composed · one step down",
      flow,
      readName: "composed",
      stores,
      run: (s, f) => runRead({ flow: f, readName: "composed", input: {}, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId: "composed-s", stores: s }),
      dependsOn: []
    };
    const { context, store } = await recordOnce(subject);
    report.push(`\n${subject.name}`);
    report.push(`  context saw: ${[...context].sort().join(", ") || "nothing"}`);
    report.push(`  store saw:   ${[...store].sort().join(", ")}`);
    // The step read user state; the recorder on the read's own block did not see it.
    expect(context.has("user.state")).toBe(false);
    expect(store.has("user.state")).toBe(true);
    report.push(
      "  UNSEEN by the context recorder: a child block's ctx is built by the engine, not from the parent's. " +
        "The store recorder lists user.state only because every read's context loads it, so it covers this by over-reporting, not by seeing the step."
    );
  });

  it("cost · the added time per read run, under each recorder", async () => {
    const board = await boardSubject();
    const pins = await pinsSubject();
    try {
      const N = Number(process.env.FIX2621_RUNS ?? 40);
      report.push(`\ncost · ${Math.ceil((N * 5) / 5) * 5} runs of each variant, interleaved and rotated, after 20 warm-up; median run, ms`);
      for (const subject of [board, pins]) {
        // Each recorder is built once and its set cleared per run, as a view's
        // definition would carry it: a copy per run would also defeat the
        // engine's per-flow and per-registry caches, and measure that instead.
        const c = contextRecorded(subject.flow, subject.readName, "in-place");
        const p = contextRecorded(subject.flow, subject.readName, "proxy");
        // The context recorder's flow copy with recording off: separates the cost
        // of running a copied flow object from the cost of recording.
        const bare = contextRecorded(subject.flow, subject.readName, "off");
        const s = storeRecorded(subject.stores, subject.flow);
        const variants: Record<string, () => Promise<unknown>> = {
          plain: () => subject.run(subject.stores, subject.flow),
          copy: () => subject.run(subject.stores, bare.flow),
          "in-place": () => {
            c.touched.clear();
            return subject.run(subject.stores, c.flow);
          },
          proxy: () => {
            p.touched.clear();
            return subject.run(subject.stores, p.flow);
          },
          store: () => {
            s.touched.clear();
            return subject.run(s.stores, subject.flow);
          }
        };
        // An identity-safe recorder must not change the answer. The proxy may
        // (it took another branch on the board); here the plan is empty, so a
        // changed branch costs time, not rows, and only the time is reported.
        const answers: Record<string, unknown> = {};
        for (const [name, v] of Object.entries(variants)) answers[name] = await v();
        for (const name of ["copy", "in-place", "store"]) expect(answers[name]).toEqual(answers.plain);
        for (let i = 0; i < 20; i += 1) for (const v of Object.values(variants)) await v(); // warm up
        // Interleaved, so whatever slows later runs (the process warms, the heap
        // grows) falls on every variant alike, and rotated each round, so each
        // variant runs equally often in each position: a run right after
        // another pays or saves differently (GC, warm caches). The median run of
        // each is kept.
        const entries = Object.entries(variants);
        const rounds = Math.ceil((N * 5) / entries.length) * entries.length;
        const samples: Record<string, number[]> = Object.fromEntries(entries.map(([name]) => [name, []]));
        const bySlot: number[][] = entries.map(() => []);
        for (let i = 0; i < rounds; i += 1) {
          for (let slot = 0; slot < entries.length; slot += 1) {
            const [name, v] = entries[(i + slot) % entries.length]!;
            const start = performance.now();
            await v();
            const took = performance.now() - start;
            samples[name]!.push(took);
            bySlot[slot]!.push(took);
          }
        }
        const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
        const per: Record<string, number> = {};
        for (const [name, xs] of Object.entries(samples)) per[name] = median(xs);
        const pct = (x: number) => `${(((x - per.plain!) / per.plain!) * 100).toFixed(1)}%`;
        report.push(
          `  ${subject.name}: plain ${per.plain!.toFixed(3)} · ${["copy", "in-place", "proxy", "store"].map((n) => `${n} ${per[n]!.toFixed(3)} (${pct(per[n]!)})`).join(" · ")}`
        );
        // Paired within each round (same moment in the run, so the drift below
        // cancels): the median of one variant's run minus another's.
        const paired = (a: string, b: string) => median(samples[a]!.map((x, i) => x - samples[b]![i]!));
        report.push(
          `    paired medians, ms: store − plain ${paired("store", "plain").toFixed(3)} · in place − copy ${paired("in-place", "copy").toFixed(3)} · proxy − copy ${paired("proxy", "copy").toFixed(3)} · copy − plain ${paired("copy", "plain").toFixed(3)} (the copied flow)`
        );
        // What the rotation cancels: the median run by its position in a round, every variant mixed.
        report.push(`    by position: ${bySlot.map((xs, k) => `slot ${k + 1} ${median(xs).toFixed(3)}`).join(" · ")}`);
        // Not the recorders': how an unrecorded read's time moves across the run.
        report.push(`    plain drift: first ${N} runs ${median(samples.plain!.slice(0, N)).toFixed(3)} · last ${N} runs ${median(samples.plain!.slice(-N)).toFixed(3)}`);
      }
    } finally {
      await board.dispose();
    }
  }, 7_200_000);
});
