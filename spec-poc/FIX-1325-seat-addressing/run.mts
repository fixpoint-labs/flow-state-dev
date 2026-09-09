/**
 * FIX-1325 spec POC — characterization: is a seat id containing "/" addressable?
 *
 * The premise under test is FIX-1335 decision 2, which mints a worker's identity
 * as "<teamId>/<name>" (e.g. "engineering/lead"). FIX-1325 proposes to make that
 * identity the seat's FLOW INSTANCE id. Nothing has checked whether an instance
 * id with a "/" in it survives the addresses an instance answers to.
 *
 * Nothing is fixed here. This pins CURRENT behaviour on the real path so the
 * spec's identity decision is made on evidence.
 *
 * NOT covered here, deliberately: that a seat reads its own frozen
 * `ctx.flow.config` once addressed. That property is already proved on `main`
 * by `goals/flow-instances/settings-travel-with-the-copy`, against SQLite and a
 * restart. Re-proving it in a POC would be a weaker check of the same claim.
 *
 * Run: pnpm tsx spec-poc/FIX-1325-seat-addressing/run.mts
 */
import { defineFlow, handler } from "../../packages/core/src/index";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../../packages/engine/src/index";

import { z } from "zod";

const SLASHED = "engineering/lead";       // the FIX-1335 identity, verbatim
const DOTTED = "engineering.lead";        // the URL-safe alternative this spec proposes
const UNDER = "engineering__lead";        // a second candidate separator
const USER = "u_poc";

const seatState = z.object({ ranAs: z.string().nullable().default(null) });

const run = handler({
  name: "seat-run",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ ranAs: ctx.flow.config.seatLabel as string });
    return { ok: true };
  },
});

const seat = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: z.object({ seatLabel: z.string() }),
  requireUser: true,
  session: { stateSchema: seatState },
  actions: { run: { block: run } },
});

function report(label: string, detail: string) {
  console.log(`${label.padEnd(52)} ${detail}`);
}

async function main() {
  // ---- 1. Does the FACTORY accept a slashed instance id? -------------------
  let slashedInstance;
  try {
    slashedInstance = seat({ id: SLASHED, config: { seatLabel: SLASHED } });
    report("1. defineFlow factory, id with '/'", `ACCEPTED — id=${slashedInstance.id}`);
  } catch (err) {
    report("1. defineFlow factory, id with '/'", `REFUSED — ${(err as Error).message}`);
    return;
  }
  const dottedInstance = seat({ id: DOTTED, config: { seatLabel: DOTTED } });
  const underInstance = seat({ id: UNDER, config: { seatLabel: UNDER } });

  // ---- 2. Does the REGISTRY admit it, and resolve it by exact id? ----------
  const registry = createFlowRegistry();
  try {
    registry.registerMany([slashedInstance, dottedInstance, underInstance]);
    report("2. registry.register, id with '/'", "ADMITTED");
  } catch (err) {
    report("2. registry.register, id with '/'", `REFUSED — ${(err as Error).message}`);
    return;
  }
  report("   registry.get('engineering/lead')", registry.get(SLASHED) ? "RESOLVED" : "undefined");

  // ---- 3. Does an HTTP CALLER reach it? -----------------------------------
  // The catch-all hands the router decoded path SEGMENTS. A client that wants to
  // address "engineering/lead" has two things it can send, and both are tried.
  const stores = createInMemoryStores();
  const router = createFlowApiRouter({ registry, stores, runtimeConfig: {} } as never);

  async function createSession(address: string, path: string[]) {
    const res = await router.POST(
      new Request(`http://poc/api/flows/${path.join("/")}/sessions`, {
        method: "POST",
        body: JSON.stringify({ userId: USER }),
      }),
      { params: { path: [...path, "sessions"] } },
    );
    const body = await res.text();
    return { status: res.status, body: body.slice(0, 160), address };
  }

  // (a) the host split the encoded "%2F" back into two segments — what Next.js
  //     and most catch-alls produce once the path is decoded.
  const split = await createSession(SLASHED, ["engineering", "lead"]);
  report("3a. POST …/engineering/lead/sessions (2 segments)", `${split.status} ${split.body}`);

  // (b) the host kept it as ONE segment carrying a literal "/" — what a caller
  //     gets only if the framework preserves %2F without decoding it into a split.
  const single = await createSession(SLASHED, [SLASHED]);
  report("3b. POST …/<one segment 'engineering/lead'>", `${single.status} ${single.body}`);

  // (c) the URL-safe controls — the same seat under a separator that is not "/".
  const dotted = await createSession(DOTTED, [DOTTED]);
  report("3c. POST …/engineering.lead/sessions", `${dotted.status} ${String(dotted.status).startsWith("2") ? "created" : dotted.body}`);
  const under = await createSession(UNDER, [UNDER]);
  report("3d. POST …/engineering__lead/sessions", `${under.status} ${String(under.status).startsWith("2") ? "created" : under.body}`);

  // ---- 4. Is the bare KIND still not an address? --------------------------
  const bare = await createSession("seat", ["seat"]);
  report("4. POST …/seat/sessions (bare kind)", `${bare.status} ${bare.body.slice(0, 60)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
