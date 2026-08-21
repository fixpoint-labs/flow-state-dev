/**
 * POC CODE ON A NEVER-MERGED BRANCH (`epic/relay`, epic FIX-1197, PR #1357).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 *
 * Q4 — is an ACCEPTED delivery dropped when the recipient stays busy past the
 * admission budget, and does anything record it?
 *
 * Q3 confirmed that a queued delivery outlives the sending request and that
 * acceptance settles at 0ms while the message is still behind the recipient's
 * concurrency key. But Q3's recipient was busy for ~4s — well inside the 30s
 * admission budget — so it never tested the window that matters.
 *
 * The mechanism says the budget bounds the DELIVERY, not merely a caller
 * awaiting the kickoff: `packages/engine/src/utils/keyed-async-gate.ts:39-44`
 * — "`waitTimeoutMs` bounds the wait for the key to free up: if the slot isn't
 * reached in time the call rejects with `ConcurrencyQueueTimeoutError` and
 * never runs `fn`." The arbiter hardcodes `QUEUE_WAIT_TIMEOUT_MS = 30_000`
 * into it (`arbiter.ts:40`, passed at `arbiter.ts:219`). If that reading
 * holds, a recipient busy longer than 30s loses the message AFTER the sender
 * was already told it was accepted.
 *
 * Acceptance at 0ms plus silent loss at 30s is the one combination that makes
 * a receipt insufficient on its own, so it decides a scope item for issues 1
 * and 2. Read once, wrongly. This RUNS it.
 *
 * Shape (phase A — the shipped arbiter):
 *   1. Recipient session runs `busy` for 35s, holding its concurrency key.
 *   2. A DIFFERENT sender session dispatches `receive` onto it fire-and-forget,
 *      awaiting `handle.accepted` but never `handle.finished`, then its own
 *      request ends.
 *   3. Once the recipient's in-flight work finishes, inspect EVERYTHING: the
 *      recipient's request records, its session items, the sender's record, the
 *      activeRequests registry, the host's warn/error log, and any unhandled
 *      rejection.
 *
 * Phase B is the adjacent mechanical claim, verified BY CONSTRUCTION rather
 * than by reading: `runExclusive`'s timer is guarded by
 * `waitTimeoutMs !== undefined && waitTimeoutMs !== Infinity && waitTimeoutMs > 0`
 * (`keyed-async-gate.ts:141-145`), so `Infinity` disables the admission timeout
 * entirely. Phase B reruns the identical scenario against an arbiter whose only
 * difference is a configurable budget set to `Infinity` — which is exactly the
 * shape of the eventual fix, so running it is what lets the epic claim the fix
 * is small rather than structural. `createInboundTransportHost` already accepts
 * an arbiter (`createInboundTransportHost.ts:106-113`), so no engine code is
 * patched to do this.
 *
 * CONFIRMED  = phase A's accepted delivery never runs — the message is lost
 *              after the sender was told it was accepted.
 * REFUTED    = the delivery survives past the budget and runs.
 * INCONCLUSIVE = anything that stops the question being asked (the recipient was
 *              never actually busy long enough, acceptance never settled, etc).
 *
 * IN-PROCESS PATH ONLY. `arbiter.ts:22-27` and
 * `createInboundTransportHost.ts:299-301` skip arbitration ENTIRELY when an
 * external dispatcher is configured, so nothing here says anything about the
 * durable path.
 *
 *   pnpm tsx spec-poc/epic-relay/q4-admission-budget-drop.ts     # ~80s
 */
import { FLOW_KIND, boot, fromOutside, hostLogs, received, show } from "./harness";
import { createKeyedAsyncGate } from "../../packages/engine/src/utils/keyed-async-gate";
import {
  createConcurrencyArbiter,
  type ConcurrencyArbiter
} from "../../packages/engine/src/transports/concurrency/arbiter";
import { ConcurrencyQueueTimeoutError } from "../../packages/engine/src/transports/errors";
import type { StoreRegistry } from "../../packages/engine/src/stores/types";

const USER = "user_a";
/** The shipped constant under test (`arbiter.ts:40`). */
const SHIPPED_BUDGET_MS = 30_000;
/** Comfortably PAST the budget — the window Q3 did not test. */
const BUSY_MS = 35_000;
/** After the recipient frees its key, how long to keep looking for the run. */
const TAIL_POLL_MS = 8_000;

type Verdict = "CONFIRMED" | "REFUTED" | "INCONCLUSIVE";

/** Anything Node would otherwise have printed as an unhandled rejection. */
const unhandled: string[] = [];
process.on("unhandledRejection", (reason) => {
  unhandled.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
});

/**
 * The eventual fix, built rather than described: the shipped arbiter with the
 * admission budget as a parameter instead of a constant.
 *
 * `resolve` and the non-`queue` policies delegate to the real arbiter; only the
 * `queue` branch is re-expressed, and it calls the REAL `createKeyedAsyncGate`.
 * So the `Infinity` guard being demonstrated is shipped code, not a copy of it.
 * Mirrors `arbiter.ts:206-221`.
 */
function budgetedArbiter(waitTimeoutMs: number): ConcurrencyArbiter {
  const real = createConcurrencyArbiter();
  const keyedGate = createKeyedAsyncGate();
  return {
    resolve: (flow, actionName, envelope) => real.resolve(flow, actionName, envelope),
    gate: (decision, requestId) => {
      const { policy, key } = decision;
      // Only `queue` reads the budget. `reject`/`allow` go to the real arbiter,
      // which keeps its own in-flight `holders` map for naming a rejected
      // caller's blocker — nothing this branch needs.
      if (key === undefined || policy !== "queue") return real.gate(decision, requestId);
      return (start) => keyedGate.runExclusive(key, start, { waitTimeoutMs });
    }
  };
}

async function recordsOn(
  stores: StoreRegistry,
  sessionId: string
): Promise<Array<Record<string, unknown>>> {
  const records = await stores.request.list({ sessionId });
  return records.map((r) => ({
    requestId: r.id,
    action: r.actionName,
    status: r.status,
    startedAtMs: r.startedAtMs,
    completedAtMs: r.completedAtMs,
    failedAtMs: r.failedAtMs,
    // There is no `error` field on RequestRecord (`stores/types.ts:117-172`).
    // Listed explicitly so "no reason is recorded" is shown, not asserted.
    errorFieldOnRecord: (r as { error?: unknown }).error ?? "(no such field)"
  }));
}

type PhaseResult = {
  label: string;
  acceptedPresent: unknown;
  acceptedAfterMs: unknown;
  senderWallClockMs: number;
  senderRecord: Record<string, unknown> | undefined;
  recipientRecords: Array<Record<string, unknown>>;
  receiveRow: Record<string, unknown> | undefined;
  handlerRan: boolean;
  recipientItems: string[];
  activeRequestsLeft: Array<Record<string, unknown>>;
  logsDuringPhase: Array<Record<string, unknown>>;
  unhandledDuringPhase: string[];
  recipientWasBusyPastBudget: boolean;
};

/**
 * One full run of the scenario. `arbiter` omitted → the shipped 30s budget.
 */
async function runPhase(
  label: string,
  arbiter: ConcurrencyArbiter | undefined,
  suffix: string
): Promise<PhaseResult> {
  const RECIPIENT = `sess_long_busy_${suffix}`;
  const SENDER = `sess_sender_${suffix}`;

  const logMark = hostLogs.length;
  const unhandledMark = unhandled.length;

  const { host, stores } = boot("queue", arbiter);

  await fromOutside(host, "seed", { note: "the long-busy recipient" }, RECIPIENT, USER);
  await fromOutside(host, "seed", { note: "the sender" }, SENDER, USER);

  console.log(`\n[${label}] occupying "${RECIPIENT}" for ${BUSY_MS}ms (budget is ${SHIPPED_BUDGET_MS}ms) …`);
  const busyStarted = Date.now();
  const busy = host.dispatch({
    source: "http",
    flowKind: FLOW_KIND,
    action: "busy",
    input: { ms: BUSY_MS },
    sessionId: RECIPIENT,
    principal: { userId: USER },
    responseEmitter: null
  });
  await busy.accepted;
  await new Promise((resolve) => setTimeout(resolve, 300));

  // The sender fires and forgets, awaiting only acceptance, then ends.
  const sendStarted = Date.now();
  const sender = await fromOutside(
    host,
    "send",
    {
      to: RECIPIENT,
      text: "am I dropped at 30s?",
      asUserId: USER,
      wait: false,
      ackAccepted: true
    },
    SENDER,
    USER
  );
  const senderWallClockMs = Date.now() - sendStarted;
  const blockOutput = (sender.result.output ?? {}) as Record<string, unknown>;
  console.log(
    `[${label}] sender returned in ${senderWallClockMs}ms — ` +
      `accepted=${String(blockOutput.acceptedPresent)} at ${String(blockOutput.acceptedAfterMs)}ms`
  );

  // Wait out the busy run, then keep looking for the delivery a while longer.
  console.log(`[${label}] waiting out the ${BUSY_MS}ms busy run, then polling …`);
  await busy.finished;
  const freedAfterMs = Date.now() - busyStarted;
  const pollStarted = Date.now();
  let receiveRow: Record<string, unknown> | undefined;
  while (Date.now() - pollStarted < TAIL_POLL_MS) {
    const rows = await recordsOn(stores, RECIPIENT);
    receiveRow = rows.find((r) => r.action === "receive");
    if (receiveRow?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const recipientRecords = await recordsOn(stores, RECIPIENT);
  receiveRow = recipientRecords.find((r) => r.action === "receive");
  const senderRecords = await recordsOn(stores, SENDER);
  const senderRecord = senderRecords.find((r) => r.action === "send");

  // The recipient's own view of its history, through the framework rather than
  // the store — "is the drop visible to the session it happened to?"
  const inspected = await fromOutside(host, "inspect", {}, RECIPIENT, USER);
  const recipientItems = ((inspected.result.output ?? {}) as { items?: string[] }).items ?? [];

  const activeRequestsLeft = (await stores.activeRequests.listAll()).map((e) => ({
    requestId: e.requestId,
    actionName: e.actionName,
    sessionId: e.sessionId
  }));

  await host.close?.();
  // Give Node a turn to surface any rejection it considers unhandled.
  await new Promise((resolve) => setTimeout(resolve, 250));

  return {
    label,
    acceptedPresent: blockOutput.acceptedPresent,
    acceptedAfterMs: blockOutput.acceptedAfterMs,
    senderWallClockMs,
    senderRecord,
    recipientRecords,
    receiveRow,
    handlerRan: received.some((r) => r.sessionId === RECIPIENT),
    recipientItems,
    activeRequestsLeft,
    logsDuringPhase: hostLogs.slice(logMark).map((l) => ({ level: l.level, message: l.message })),
    unhandledDuringPhase: unhandled.slice(unhandledMark),
    recipientWasBusyPastBudget: freedAfterMs > SHIPPED_BUDGET_MS
  };
}

/**
 * The guard itself, on the real gate, in ~1s — three waiters behind one held
 * key, differing only in `waitTimeoutMs`. Nothing about a host or a flow is
 * involved, so this isolates `keyed-async-gate.ts:141-145` on its own.
 */
async function guardByConstruction(): Promise<Record<string, unknown>> {
  const gate = createKeyedAsyncGate();
  const KEY = "one_key";
  const HELD_MS = 1_200;
  const SHORT_MS = 300;

  let releaseHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const holder = gate.runExclusive(KEY, async () => {
    await held;
    return "holder";
  });
  await new Promise((r) => setTimeout(r, 20));

  const outcome = async (
    waitTimeoutMs: number | undefined,
    tag: string
  ): Promise<string> => {
    try {
      return await gate.runExclusive(
        KEY,
        async () => `${tag}: fn RAN`,
        waitTimeoutMs === undefined ? undefined : { waitTimeoutMs }
      );
    } catch (error) {
      return error instanceof ConcurrencyQueueTimeoutError
        ? `${tag}: ConcurrencyQueueTimeoutError — fn NEVER RAN`
        : `${tag}: ${String(error)}`;
    }
  };

  const finite = outcome(SHORT_MS, `waitTimeoutMs=${SHORT_MS}`);
  const infinite = outcome(Infinity, "waitTimeoutMs=Infinity");
  const omitted = outcome(undefined, "waitTimeoutMs omitted");

  setTimeout(releaseHeld, HELD_MS);
  const results = await Promise.all([finite, infinite, omitted]);
  await holder;
  return { heldForMs: HELD_MS, results };
}

async function main(): Promise<void> {
  show("the guard, on the real gate (keyed-async-gate.ts:141-145)", await guardByConstruction());

  const a = await runPhase("A · shipped arbiter, 30s budget", undefined, "shipped");
  show("PHASE A — the shipped 30s admission budget", {
    "1. accepted": { present: a.acceptedPresent, afterMs: a.acceptedAfterMs },
    "2. did the queued handler ever execute": {
      handlerSideEffect: a.handlerRan,
      receivedEntries: received
        .filter((r) => String(r.sessionId).includes("shipped"))
        .map((r) => ({ sessionId: r.sessionId, from: r.from, text: r.text }))
    },
    "3. recipient's records": a.recipientRecords,
    "3b. recipient's session items": a.recipientItems,
    "4. sender's record": a.senderRecord,
    "5. discoverability": {
      requestRecordForTheDelivery: a.receiveRow,
      activeRequestsEntriesLeft: a.activeRequestsLeft,
      hostWarnErrorLogs: a.logsDuringPhase
    },
    "6. ConcurrencyQueueTimeoutError surfacing": {
      unhandledRejections: a.unhandledDuringPhase,
      senderSawIt: a.senderRecord?.status
    },
    recipientWasBusyPastBudget: a.recipientWasBusyPastBudget
  });

  const b = await runPhase(
    "B · same scenario, waitTimeoutMs = Infinity",
    budgetedArbiter(Infinity),
    "unbounded"
  );
  show("PHASE B — identical scenario, admission budget = Infinity", {
    accepted: { present: b.acceptedPresent, afterMs: b.acceptedAfterMs },
    handlerRan: b.handlerRan,
    recipientRecords: b.recipientRecords,
    receiveRow: b.receiveRow,
    recipientItems: b.recipientItems,
    recipientWasBusyPastBudget: b.recipientWasBusyPastBudget
  });

  let verdict: Verdict;
  let because: string;
  if (!a.recipientWasBusyPastBudget) {
    verdict = "INCONCLUSIVE";
    because = "the recipient never actually held its key past the 30s budget";
  } else if (a.acceptedPresent !== true) {
    verdict = "INCONCLUSIVE";
    because = "acceptance never settled, so there was no accepted delivery to drop";
  } else if (!a.handlerRan && a.receiveRow?.status !== "completed") {
    verdict = "CONFIRMED";
    because =
      "the delivery was accepted and then never ran — the recipient stayed busy past the " +
      "admission budget and the queued run was dropped";
  } else {
    verdict = "REFUTED";
    because =
      "the delivery RAN despite the recipient being busy past the admission budget — the " +
      "budget does NOT bound a delivery nobody is awaiting";
  }

  show("Q4 VERDICT", {
    verdict,
    because,
    unboundedPathLandedTheDelivery: b.handlerRan && b.receiveRow?.status === "completed"
  });

  if (verdict === "REFUTED") {
    console.error(
      "\n" +
        "########################################################################\n" +
        "# REFUTED — THE DELIVERY SURVIVED PAST THE ADMISSION BUDGET.           #\n" +
        "# The correction sent to the owner was itself WRONG. The 30s budget    #\n" +
        "# does not drop a delivery nobody is awaiting. Theme 14's original     #\n" +
        "# non-change reasoning stands and must NOT be rewritten.               #\n" +
        "########################################################################"
    );
  }
}

main().catch((error) => {
  console.error("POC FAILED", error);
  process.exitCode = 1;
});
