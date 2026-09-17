/**
 * Characterization check — FIX-1355, S3 and DECISIONS → "Decided, not asked".
 *
 * Premise under test: **a delivery addressed `session: { key }` creates the
 * seat's session on first delivery and that child inherits the sender's org**
 * — while `session: { id }` to a session that does not exist refuses
 * `session-not-found`.
 *
 * This is the premise round 1's own P1 fix rests on. Greptile said the host
 * never creates seat sessions and the fan-out would fail; the answer was to
 * pin `{ key }` instead of `{ id }`. That answer was, until this file, read
 * rather than run — a fix to a P1 resting on an unverified reason, which is
 * exactly the failure mode the false `createFlowState` premise was.
 *
 * It also carries the org inheritance the seats' `requireOrg: true` reading
 * depends on: with no org on the child, every file-declared document resolves
 * unregistered and the lab proves nothing.
 *
 * Run:  node_modules/.bin/tsx spec-poc/FIX-1355-runtime-premises/check-key-child-created-and-inherits-org.mts
 *
 * Red states, both exercised in the run rather than asserted about it:
 *   - `{ key }` stops creating, or stops inheriting the org  → checks 1–4 fail.
 *   - `{ id }` starts creating absent sessions               → check 5 fails,
 *     which would mean the fold was unnecessary.
 */

// Relative into the BUILT output, not src: `spec-poc/` is not a workspace
// package, so bare specifiers do not resolve here — and importing core from
// `src` while `workforce` resolves it from `dist` would load two copies, which
// a registry check would then fail for a reason that has nothing to do with
// the claim. One copy, deliberately.
import { dispatcher, handler, sequencer, defineFlow } from "../../packages/core/dist/index.js";
import { createFlowState, inMemoryStores, runAction } from "../../packages/engine/dist/index.js";
import type { StoreRegistry } from "../../packages/engine/dist/index.js";
import { createMockModelResolver } from "../../packages/testing/dist/index.js";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelNotifyInputSchema,
  defineChannelFlow,
  type ChannelNotifyInput,
} from "../../packages/workforce/dist/index.js";

const USER_ID = "u_lab";
const ORG_ID = "org_pentest_lab";
const CHANNEL_ID = "pentest.findings";
const SEAT_KIND = "probe";
const MEMBERS = ["pentest.recon", "pentest.triage"];

let failures = 0;
const check = (label: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        saw: ${saw}`);
  if (!ok) failures += 1;
};

/** What each seat run recorded about the context it actually ran in. */
type SeatRun = {
  seat: string;
  sessionId: string;
  orgId: string | undefined;
  body: string;
  /** Which hired flow INSTANCE actually ran — the "addressed one seat" claim. */
  flowId: string | undefined;
};

/**
 * The seat kind, stripped to the one thing under test: an `internal` entry that
 * records the org its request is bound to. The lab's real kind reads a document
 * and answers; neither matters here.
 */
function seatKind(runs: SeatRun[]) {
  const brief = handler({
    name: "record-run",
    inputSchema: z.object({ channelId: z.string(), body: z.string(), member: z.string() }),
    outputSchema: z.object({}),
    execute: (input: { body: string; member: string }, ctx: any) => {
      runs.push({
        seat: input.member,
        sessionId: ctx.session.identity.id,
        orgId: ctx.identity?.orgId ?? ctx.session?.identity?.orgId ?? ctx.orgId,
        body: input.body,
        flowId: ctx.flow?.id ?? ctx.request?.identity?.flowId ?? ctx.session?.identity?.flowId,
      });
      return {};
    },
  });

  return defineFlow({
    kind: SEAT_KIND,
    cardinality: "collection",
    configSchema: z.object({}).passthrough(),
    actions: {},
    internal: {
      actions: {
        brief: {
          inputSchema: z.object({ channelId: z.string(), body: z.string(), member: z.string() }),
          block: brief,
        },
      },
    },
  } as never);
}

/**
 * The lab's notify block, as S3 describes it: thin policy over a STATIC
 * member-id → dispatcher map. One dispatcher per member, because `flowKind` is
 * a static instance id and not a function — which is itself why the plan says
 * a static map rather than "look the member up and dispatch to it".
 *
 * `target` picks which session form is under test.
 */
function notifyBlock(target: "key" | "id", members: readonly string[], refusals: string[]) {
  // Captures WHY a delivery failed, at the point it fails — the same `.rescue`
  // shape `channel-flow.ts` itself uses for `noteDeliveryRefusal`. Without this
  // the control can only observe that nothing arrived, which is equally true
  // of a harness that never dispatched.
  const recordRefusal = handler({
    name: "record-refusal",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    execute: (error: unknown) => {
      refusals.push(error instanceof Error ? error.message : String(error));
      return {};
    },
  });

  const toSeat = (member: string) =>
    dispatcher({
      name: `deliver-${member.replace(".", "-")}`,
      action: "brief",
      // The seat's exact instance id.
      flowKind: member,
      inputSchema: channelNotifyInputSchema,
      payload: (input: ChannelNotifyInput) => ({
        channelId: input.channelId,
        body: input.body,
        member: input.member,
      }),
      session:
        target === "key"
          ? { key: () => member }
          : // The shape the plan carried before round 1: an exact id nothing created.
            { id: () => `${member}.session` },
    } as never);

  let seq: any = sequencer({
    name: "lab-notify",
    inputSchema: channelNotifyInputSchema,
  });

  for (const member of members) {
    seq = seq.stepIf(
      (input: ChannelNotifyInput) =>
        // The cycle break — a seat's own line wakes nobody (BR-8) — and the
        // static map lookup, which is the whole of the lab's policy.
        input.author === undefined && input.member === member,
      (toSeat(member) as any).rescue([{ block: recordRefusal }]),
    );
  }

  return seq;
}

async function bindChannel(stores: StoreRegistry): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    CHANNEL_ID,
    {
      id: CHANNEL_ID,
      flowKind: CHANNEL_KIND,
      flowId: CHANNEL_KIND,
      userId: USER_ID,
      orgId: ORG_ID,
      state: { members: MEMBERS, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${CHANNEL_ID}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );
}

async function until(p: () => boolean | Promise<boolean>, label: string): Promise<boolean> {
  for (let i = 0; i < 200; i += 1) {
    if (await p()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  console.log(`        (timed out waiting for ${label})`);
  return false;
}

async function run(target: "key" | "id") {
  const runs: SeatRun[] = [];
  const refusals: string[] = [];
  const seats = Object.fromEntries(MEMBERS.map((m) => [m, seatKind(runs)({ id: m })]));
  const channel = defineChannelFlow({ notify: notifyBlock(target, MEMBERS, refusals) })();

  const state = createFlowState({
    flows: { [CHANNEL_KIND]: channel, ...Object.fromEntries(MEMBERS.map((m) => [m, seats[m]])) },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  } as never);

  const runtime = await state.getRuntime();
  await bindChannel(runtime.stores);

  const before = (await runtime.stores.session.list?.({}))?.length ?? 0;

  await runAction({
    flow: channel,
    actionName: "post",
    input: { body: "sweep the scope list" },
    userId: USER_ID,
    orgId: ORG_ID,
    sessionId: CHANNEL_ID,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  } as never);

  // Settle: either every seat ran, or every delivery was refused.
  const landed = await until(
    () => runs.length === MEMBERS.length || refusals.length === MEMBERS.length,
    `${target}: both seats to run or both deliveries to be refused`,
  );

  return { runs, landed, stores: runtime.stores, before, state, reasons: refusals };
}

console.log(`=== target: session: { key } — what the plan now pins ===\n`);
const keyRun = await run("key");

check(
  "both declared members were woken by the framework's fan-out",
  keyRun.landed && keyRun.runs.length === 2,
  `${keyRun.runs.length} seat run(s): ${keyRun.runs.map((r) => r.seat).join(", ") || "<none>"}`,
);

check(
  "each seat ran in its OWN session, not a shared one",
  new Set(keyRun.runs.map((r) => r.sessionId)).size === keyRun.runs.length && keyRun.runs.length > 0,
  keyRun.runs.map((r) => `${r.seat} -> ${r.sessionId}`).join(" | ") || "<none>",
);

// Settles the neighbouring premise in the same run: a dispatcher addressed to
// one hired seat's EXACT instance id reaches that instance and no other.
const addressing = keyRun.runs.map((r) => `${r.seat} ran on instance ${r.flowId}`);
check(
  "a dispatcher addressed to a seat's exact instance id reached THAT seat",
  keyRun.runs.length === MEMBERS.length && keyRun.runs.every((r) => r.flowId === r.seat),
  addressing.join(" | ") || "<none>",
);

// The claim that carries `requireOrg: true`.
const orgs = keyRun.runs.map((r) => r.orgId);
check(
  "each child session INHERITED the sender's org",
  keyRun.runs.length > 0 && orgs.every((o) => o === ORG_ID),
  `orgIds seen: ${JSON.stringify(orgs)} (expected every one === "${ORG_ID}")`,
);

// The children must be sessions that did not exist before the post — the exact
// thing Greptile said the host never creates.
const childRecords = await Promise.all(
  keyRun.runs.map(async (r) => await keyRun.stores.session.get(r.sessionId)),
);
check(
  "each child session was CREATED by the delivery and persisted with its org",
  childRecords.length > 0 &&
    childRecords.every((rec: any) => rec !== undefined && (rec.orgId ?? undefined) === ORG_ID),
  childRecords
    .map((rec: any) => (rec === undefined ? "<absent>" : `${rec.id} orgId=${rec.orgId ?? "<unbound>"}`))
    .join(" | ") || "<none>",
);

console.log(`\n=== CONTROL · target: session: { id } — the shape the plan used to carry ===\n`);
const idRun = await run("id");

// Asserted on the REASON, not just the absence. "Nothing was delivered" is
// equally true when the harness is broken — an earlier draft of this file
// passed this control while the dispatcher was not being invoked at all.
const refusedByName = idRun.reasons.filter((r: string) => r.includes("session-not-found"));

check(
  "CONTROL · an exact id nothing created is refused BY NAME (session-not-found)",
  idRun.runs.length === 0 &&
    refusedByName.length === MEMBERS.length &&
    idRun.reasons.length === refusedByName.length,
  idRun.reasons.length === 0
    ? "no refusal was recorded at all — the control proves nothing, the harness is not dispatching"
    : `${idRun.runs.length} seat run(s); ${refusedByName.length}/${idRun.reasons.length} refusals were session-not-found:\n        ${idRun.reasons.join("\n        ")}`,
);

console.log(
  `\n${failures === 0 ? "CONFIRMED" : "REFUTED"} — ${failures} failing assertion(s)`,
);
process.exit(failures === 0 ? 0 : 1);
