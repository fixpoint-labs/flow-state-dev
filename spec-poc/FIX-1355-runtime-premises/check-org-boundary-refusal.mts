/**
 * Characterization check — FIX-1355, DECISIONS → Settled.
 *
 * Premise: **a delivery never crosses an org boundary.** The lab's seats read
 * org-scoped documents, so this is what makes the client wrap load-bearing:
 * without it the channel opens unbound and the seats are refused.
 *
 * Run:  node_modules/.bin/tsx spec-poc/FIX-1355-runtime-premises/check-org-boundary-refusal.mts
 *
 * Red state: the cross-org delivery starts being accepted. The check asserts
 * the refusal BY NAME and asserts the same-org delivery succeeds, so neither a
 * blanket refusal nor a blanket acceptance reads as a pass.
 */

import { dispatcher, handler, sequencer, defineFlow } from "../../packages/core/dist/index.js";
import { createFlowState, inMemoryStores, runAction } from "../../packages/engine/dist/index.js";
import { createMockModelResolver } from "../../packages/testing/dist/index.js";
import { z } from "zod";

const USER_ID = "u_lab";
const LAB_ORG = "org_pentest_lab";
const OTHER_ORG = "org_somebody_else";
const SENDER_KIND = "sender";
const SEAT_KIND = "probe";
const SEAT_SESSION = "seat-session";

let failures = 0;
const check = (label: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        saw: ${saw}`);
  if (!ok) failures += 1;
};

function seatFlow(ran: string[]) {
  return defineFlow({
    kind: SEAT_KIND,
    cardinality: "singleton",
    actions: {},
    internal: {
      actions: {
        brief: {
          inputSchema: z.object({ body: z.string() }),
          block: handler({
            name: "seat-ran",
            inputSchema: z.object({ body: z.string() }),
            outputSchema: z.object({}),
            execute: (input: { body: string }) => {
              ran.push(input.body);
              return {};
            },
          }),
        },
      },
    },
  } as never);
}

function senderFlow(refusals: string[]) {
  const record = handler({
    name: "record-refusal",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    execute: (error: unknown) => {
      refusals.push(error instanceof Error ? error.message : String(error));
      return {};
    },
  });

  const deliver = dispatcher({
    name: "deliver",
    action: "brief",
    flowKind: SEAT_KIND,
    inputSchema: z.object({ body: z.string() }),
    // An EXISTING session, addressed by exact id — the path the org check
    // guards. A `{ key }` child could never mismatch, because it inherits.
    session: { id: () => SEAT_SESSION },
  } as never);

  return defineFlow({
    kind: SENDER_KIND,
    cardinality: "singleton",
    actions: {
      send: {
        inputSchema: z.object({ body: z.string() }),
        block: sequencer({ name: "send", inputSchema: z.object({ body: z.string() }) }).step(
          (deliver as any).rescue([{ block: record }]),
        ),
      },
    },
  } as never);
}

/** Runs one delivery from `senderOrg` into a seat session bound to `seatOrg`. */
async function attempt(seatOrg: string, senderOrg: string) {
  const ran: string[] = [];
  const refusals: string[] = [];
  const seat = seatFlow(ran)();
  const sender = senderFlow(refusals)();

  const state = createFlowState({
    flows: { [SEAT_KIND]: seat, [SENDER_KIND]: sender },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  } as never);

  const runtime = await state.getRuntime();

  // The seat's session already exists and is bound to `seatOrg`.
  const now = Date.now();
  await runtime.stores.session.set(
    SEAT_SESSION,
    {
      id: SEAT_SESSION,
      flowKind: SEAT_KIND,
      flowId: SEAT_KIND,
      userId: USER_ID,
      orgId: seatOrg,
      state: {},
      lineageId: `lin_${SEAT_SESSION}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );

  await runAction({
    flow: sender,
    actionName: "send",
    input: { body: "sweep the scope list" },
    userId: USER_ID,
    orgId: senderOrg,
    sessionId: `sender-${senderOrg}`,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  } as never);

  for (let i = 0; i < 200 && ran.length === 0 && refusals.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return { ran, refusals };
}

console.log(`=== CONTROL · same org (${LAB_ORG} -> ${LAB_ORG}) — the delivery must LAND ===\n`);
const same = await attempt(LAB_ORG, LAB_ORG);
check(
  "CONTROL · a same-org delivery into an existing session runs the seat",
  same.ran.length === 1 && same.refusals.length === 0,
  `${same.ran.length} seat run(s), ${same.refusals.length} refusal(s)` +
    (same.refusals.length > 0 ? `: ${same.refusals.join(" | ")}` : ""),
);

console.log(`\n=== the claim · cross org (${OTHER_ORG} -> seat bound to ${LAB_ORG}) ===\n`);
const cross = await attempt(LAB_ORG, OTHER_ORG);
const byName = cross.refusals.filter((r) => r.includes("session-not-addressable"));
check(
  "a delivery across an org boundary is refused BY NAME, and the seat never runs",
  cross.ran.length === 0 && byName.length === 1,
  cross.refusals.length === 0
    ? "no refusal recorded at all — and the seat did not run either; the probe proves nothing"
    : `${cross.ran.length} seat run(s); ${byName.length}/${cross.refusals.length} named the boundary:\n        ${cross.refusals.join("\n        ")}`,
);

console.log(`\n${failures === 0 ? "CONFIRMED" : "REFUTED"} — ${failures} failing assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
