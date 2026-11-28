/**
 * Goal check — one definition per name: a block in one flow reads and writes
 * a definition both flows declare in another flow's session, two shapes
 * under one session-scoped name refuse start, and index declarations isolated
 * to their flows never clash (FIX-2943).
 *
 * **Model-free.** Real `createFlowState` hosts on in-memory stores. The flows
 * are built from blocks, and a flow declares a definition only by including a
 * block that uses it, as an app does.
 *
 * Legs (each failure is tagged with its leg):
 *   reach   the visitor flow, in its own session, writes the definition in
 *           the owner flow's session through `ctx.resources.at({ session })`,
 *           and the owner flow reads the write back from its own session; then the
 *           owner writes and the visitor reads it back. Both flows include one
 *           declaring block. The rows are read through actions, never a store.
 *   clash   a flow declaring the same session-scoped name with another shape
 *           is refused at start, and the error names both flows and the name.
 *   isolated  two flows declaring one index name at two versions, each on a
 *           collection isolated to its flow, start, and each writes and reads
 *           a row of its own.
 *
 * Controls (`GOAL_CONTROL`):
 *   skip-session-scope  the start-up check skips session scope. Must FAIL
 *     `clash` (the app starts), and nothing else.
 *
 * Run: pnpm tsx goals/sessions-reach/one-definition-per-name/run.mts
 * Fixture: GOAL_FIXTURE=<file in fixtures/> (default `default.json`)
 */
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createFlowRegistry, createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";

// Model-free: an ambient model ladder would only make the host refuse to build its resolver.
stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!["", "skip-session-scope"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL ${JSON.stringify(CONTROL)}`);

const fixture = z
  .object({
    definition: z.string().min(1),
    reachers: z.object({ owner: z.string().min(1), visitor: z.string().min(1) }),
    clashing: z.string().min(1),
    index: z.object({ pattern: z.string().min(1), name: z.string().min(1) }),
    notes: z.object({ fromVisitor: z.string().min(1), fromOwner: z.string().min(1) })
  })
  .parse(loadFixture(import.meta.url, process.env.GOAL_FIXTURE ?? "default.json"));

const USER = "u_one_definition";
const OWNER_SESSION = "s_owner";
const VISITOR_SESSION = "s_visitor";
const DEF = fixture.definition;

// ── the control ──────────────────────────────────────────────────────────────

if (CONTROL === "skip-session-scope") {
  // The registry's one comparison point, with session scope taken out.
  const proto = Object.getPrototypeOf(createFlowRegistry()) as {
    validateScope?: (scope: string, ...rest: unknown[]) => void;
  };
  const original = proto.validateScope;
  if (typeof original !== "function") throw new Error("control: the registry has no validateScope to patch");
  proto.validateScope = function (scope: string, ...rest: unknown[]) {
    if (scope === "session") return;
    return original.call(this, scope, ...rest);
  };
}

// ── the declaring block, shared by both reaching flows ──────────────────────

const shape = z.object({ notes: z.array(z.string()).default([]) });
const definition = defineResource({ scope: "session", ref: DEF, stateSchema: shape, default: { notes: [] } });

const entryInput = z.object({
  op: z.enum(["write", "read"]),
  /** The session to reach; omitted, the block's own. */
  session: z.string().optional(),
  note: z.string().optional()
});

type Accessors = Record<string, { state: { notes: string[] }; patchState(u: { notes: string[] }): Promise<void> }>;

/** Reads or writes this session's `DEF`, or the named session's through reach. */
const entry = handler({
  name: `${DEF}-entry`,
  inputSchema: entryInput,
  outputSchema: z.array(z.string()),
  resources: { [DEF]: definition },
  execute: async (input, ctx) => {
    let accessors = ctx.resources as unknown as Accessors & { at?: (where: { session: string }) => Accessors };
    if (input.session !== undefined) {
      if (typeof accessors.at !== "function") throw new Error("ctx.resources.at is not available");
      accessors = accessors.at({ session: input.session }) as typeof accessors;
    }
    const ref = accessors[DEF];
    if (ref === undefined) throw new Error(`no accessor for "${DEF}"`);
    if (input.op === "write") await ref.patchState({ notes: [...ref.state.notes, input.note ?? ""] });
    return [...ref.state.notes];
  }
});

const reachingFlow = (kind: string) =>
  defineFlow({ kind, actions: { entry: { inputSchema: entryInput, block: entry } } })();

/** A flow declaring `DEF` at session scope with another shape. */
function clashingFlow(kind: string) {
  const other = defineResource({
    scope: "session",
    ref: DEF,
    stateSchema: z.object({ notes: z.number().default(0) }),
    default: { notes: 0 }
  });
  return defineFlow({
    kind,
    actions: {
      noop: {
        inputSchema: z.object({}),
        block: handler({ name: `${kind}-noop`, resources: { [DEF]: other }, execute: () => ({}) })
      }
    }
  })();
}

/** A flow declaring `index.name` at `version` on a collection isolated to the flow. */
function isolatedIndexFlow(kind: string, version: number) {
  const collection = defineResourceCollection({
    scope: "org",
    pattern: fixture.index.pattern,
    flowIsolation: true,
    stateSchema: z.object({ owner: z.string() }),
    indexes: { [fixture.index.name]: { version, value: (_key: string, state: { owner: string }) => state.owner } }
  } as never);
  const io = z.object({ key: z.string(), owner: z.string() });
  return defineFlow({
    kind,
    actions: {
      put: {
        inputSchema: io,
        block: handler({
          name: `${kind}-put`,
          inputSchema: io,
          outputSchema: z.string(),
          resources: { rows: collection },
          execute: async (input, ctx) => {
            const rows = (ctx.resources as unknown as Record<string, { create(k: string, s: unknown): Promise<unknown>; get(k: string): Promise<{ state: { owner: string } } | undefined> }>).rows!;
            await rows.create(input.key, { owner: input.owner });
            return (await rows.get(input.key))?.state.owner ?? "";
          }
        })
      }
    }
  })();
}

function host(flows: unknown[]) {
  const state = createFlowState({ flows: flows as never, stores: { default: { primary: inMemoryStores() } } });
  return async (flow: { id: string }, actionName: string, input: unknown, sessionId: string) => {
    const runtime = await state.getRuntime();
    const result = await runAction({
      flow,
      actionName,
      input,
      userId: USER,
      orgId: DEFAULT_ORG_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger }
    } as never);
    if (result.error !== undefined) throw result.error;
    return result.output;
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];

  // ── reach ──────────────────────────────────────────────────────────────────
  {
    const owner = reachingFlow(fixture.reachers.owner);
    const visitor = reachingFlow(fixture.reachers.visitor);
    try {
      const act = host([owner, visitor]);
      await act(owner, "entry", { op: "read" }, OWNER_SESSION);
      await act(visitor, "entry", { op: "write", session: OWNER_SESSION, note: fixture.notes.fromVisitor }, VISITOR_SESSION);
      const ownerSees = tell.over("reach · owner's notes after the visitor's write", (await act(owner, "entry", { op: "read" }, OWNER_SESSION)) as string[]);
      if (!ownerSees.includes(fixture.notes.fromVisitor)) failures.push(`reach: the owner's notes lack the visitor's write (${JSON.stringify(ownerSees)})`);

      await act(owner, "entry", { op: "write", note: fixture.notes.fromOwner }, OWNER_SESSION);
      const visitorSees = tell.over("reach · owner's notes read by the visitor", (await act(visitor, "entry", { op: "read", session: OWNER_SESSION }, VISITOR_SESSION)) as string[]);
      if (!visitorSees.includes(fixture.notes.fromOwner)) failures.push(`reach: the visitor did not read the owner's write (${JSON.stringify(visitorSees)})`);

      const visitorOwn = (await act(visitor, "entry", { op: "read" }, VISITOR_SESSION)) as string[];
      tell.over("reach · visitor's own notes stay apart", visitorOwn.filter((n) => n === fixture.notes.fromVisitor), { emptyIs: "the claim: the write went to the owner's notes" });
      if (visitorOwn.includes(fixture.notes.fromVisitor)) failures.push("reach: the visitor's write landed in its own notes");
      evidence.push(`reach: both ways through "${DEF}"`);
    } catch (error) {
      failures.push(`reach: ${message(error)}`);
    }
  }

  // ── clash ──────────────────────────────────────────────────────────────────
  {
    const owner = reachingFlow(fixture.reachers.owner);
    const clashing = clashingFlow(fixture.clashing);
    let refusal: string | undefined;
    try {
      const act = host([owner, clashing]);
      await act(owner, "entry", { op: "read" }, OWNER_SESSION);
    } catch (error) {
      refusal = message(error);
    }
    const named = tell.over("clash · start refusals", refusal === undefined ? [] : [refusal], { emptyIs: "only under a broken check" });
    if (named.length === 0) failures.push(`clash: the app started with two shapes under session-scoped "${DEF}"`);
    for (const text of named) {
      for (const flow of [fixture.reachers.owner, fixture.clashing]) {
        if (!text.includes(`"${flow}"`)) failures.push(`clash: the refusal does not name flow "${flow}": ${text}`);
      }
      if (!new RegExp(`\\b${DEF}\\b`).test(text)) failures.push(`clash: the refusal does not name "${DEF}": ${text}`);
    }
    if (named.length > 0) evidence.push("clash: start refused naming both flows and the name");
  }

  // ── isolated ───────────────────────────────────────────────────────────────
  {
    const one = isolatedIndexFlow("isolated-one", 1);
    const two = isolatedIndexFlow("isolated-two", 2);
    try {
      const act = host([one, two]);
      const read = [
        (await act(one, "put", { key: "r1", owner: "one" }, "s_iso_1")) as string,
        (await act(two, "put", { key: "r1", owner: "two" }, "s_iso_2")) as string
      ];
      tell.over("isolated · rows read back", read.filter((r) => r !== ""));
      if (read[0] !== "one" || read[1] !== "two") failures.push(`isolated: each flow should read its own row, read ${JSON.stringify(read)}`);
      else evidence.push(`isolated: "${fixture.index.name}" at versions 1 and 2 started, each flow kept its own row`);
    } catch (error) {
      failures.push(`isolated: ${message(error)}`);
    }
  }

  return { failures, evidence: evidence.join(" · ") };
});
