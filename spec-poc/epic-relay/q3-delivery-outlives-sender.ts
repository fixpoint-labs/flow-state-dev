/**
 * POC CODE ON A NEVER-MERGED BRANCH (`epic/relay`, epic FIX-1197, PR #1357).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 *
 * Q3 — does a queued-but-not-yet-admitted dispatch survive the SENDER's request
 * ending?
 *
 * Fire-and-forget's entire value rests on this. The design asserts that delivery
 * is attached to the process, not to the originating web request. Nobody has run
 * it. If the queued run is bound to the sender's request lifetime, then the
 * moment the sender returns the message is lost — and fire-and-forget needs
 * delivery owned by something other than the sending request, which is a real
 * scope change to issue 2.
 *
 * Shape:
 *   1. Recipient session runs `busy` (holds its concurrency key) — not awaited.
 *   2. A DIFFERENT sender session runs `send` fire-and-forget at the recipient,
 *      awaiting `handle.accepted` (the amended theme 6's acknowledgement) but
 *      never `handle.finished`.
 *   3. The sender's own request is driven to a terminal status and verified
 *      terminal in the store — the sender is genuinely gone.
 *   4. Poll the recipient's request records for the queued `receive`.
 *
 * CONFIRMED  = the queued `receive` reaches `completed` after the sender is
 *              terminal, and the recipient's handler actually ran.
 * REFUTED    = it never runs, or lands terminal-but-not-completed.
 * INCONCLUSIVE = anything that stops the question being asked (the recipient was
 *              never actually busy, acceptance never settled, etc).
 *
 * IN-PROCESS PATH ONLY. `arbiter.ts:22-27` and
 * `createInboundTransportHost.ts:299-301` skip arbitration entirely when an
 * external dispatcher is configured, so nothing here says anything about the
 * durable path.
 *
 *   pnpm tsx spec-poc/epic-relay/q3-delivery-outlives-sender.ts     # ~10s
 */
import { FLOW_KIND, boot, fromOutside, received, show } from "./harness";

const RECIPIENT = "sess_busy_recipient";
const SENDER = "sess_sender";
const USER = "user_a";
/** Long enough that the send definitely lands while the key is held. */
const BUSY_MS = 4_000;
/** Comfortably inside QUEUE_WAIT_TIMEOUT_MS (30_000, arbiter.ts:40). */
const POLL_BUDGET_MS = 20_000;

type Verdict = "CONFIRMED" | "REFUTED" | "INCONCLUSIVE";

async function requestsOn(
  stores: ReturnType<typeof boot>["stores"],
  sessionId: string
): Promise<Array<Record<string, unknown>>> {
  const records = await stores.request.list({ sessionId });
  return records.map((r) => ({ requestId: r.id, action: r.actionName, status: r.status }));
}

async function main(): Promise<void> {
  const { host, stores } = boot("queue");

  await fromOutside(host, "seed", { note: "the busy recipient" }, RECIPIENT, USER);
  await fromOutside(host, "seed", { note: "the sender" }, SENDER, USER);

  // 1. Occupy the recipient's concurrency key. Deliberately NOT awaited.
  console.log(`\noccupying "${RECIPIENT}" for ${BUSY_MS}ms …`);
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
  // Let the run get past its first await and actually hold the key.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const duringBusy = await requestsOn(stores, RECIPIENT);
  const recipientIsBusy = duringBusy.some(
    (r) => r.action === "busy" && r.status === "in_progress"
  );
  show("recipient's records while it is mid-run", duringBusy);

  // 2 + 3. The sender fires and forgets, then its own request ends.
  const sendStarted = Date.now();
  const sender = await fromOutside(
    host,
    "send",
    {
      to: RECIPIENT,
      text: "does this outlive me?",
      asUserId: USER,
      wait: false,
      ackAccepted: true
    },
    SENDER,
    USER
  );
  const senderRecords = await requestsOn(stores, SENDER);
  const senderRow = senderRecords.find((r) => r.action === "send");
  show("sender's request, after it returned", {
    wallClockMs: Date.now() - sendStarted,
    senderStatusFromResult: sender.result.error === undefined ? "completed" : "failed",
    senderError: sender.result.error?.message,
    senderRecordInStore: senderRow,
    blockOutput: sender.result.output
  });

  const senderTerminal = senderRow !== undefined && senderRow.status !== "in_progress";

  // 4. The sender is gone. Does the queued receive still run?
  console.log(`\nsender is terminal — polling "${RECIPIENT}" for the queued receive …`);
  const pollStarted = Date.now();
  let receiveRow: Record<string, unknown> | undefined;
  while (Date.now() - pollStarted < POLL_BUDGET_MS) {
    const rows = await requestsOn(stores, RECIPIENT);
    receiveRow = rows.find((r) => r.action === "receive");
    if (receiveRow !== undefined && receiveRow.status !== "in_progress") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const finalRows = await requestsOn(stores, RECIPIENT);
  show("recipient's records after the poll", {
    polledForMs: Date.now() - pollStarted,
    records: finalRows,
    handlerActuallyRan: received.map((r) => ({
      sessionId: r.sessionId,
      userId: r.userId,
      from: r.from,
      text: r.text
    }))
  });

  const ran = receiveRow?.status === "completed";
  const handlerRan = received.some((r) => r.sessionId === RECIPIENT);

  let verdict: Verdict;
  let because: string;
  if (!recipientIsBusy) {
    verdict = "INCONCLUSIVE";
    because =
      "the recipient was never observed mid-run, so the dispatch may never have queued at all";
  } else if (!senderTerminal) {
    verdict = "INCONCLUSIVE";
    because = "the sender's own request never reached a terminal status in the store";
  } else if (ran && handlerRan) {
    verdict = "CONFIRMED";
    because =
      "the queued receive ran to completion on the recipient AFTER the sender's request was terminal";
  } else {
    verdict = "REFUTED";
    because = `the queued receive did not complete (status: ${String(receiveRow?.status ?? "no record")})`;
  }

  show("Q3 VERDICT", { verdict, because, senderTerminal, recipientIsBusy });
  if (verdict === "REFUTED") {
    console.error(
      "\nREFUTED — delivery did NOT outlive the sending request. Fire-and-forget " +
        "needs delivery owned by something other than the sender. Scope change to issue 2."
    );
  }

  await busy.finished;
  await host.close?.();
}

main().catch((error) => {
  console.error("POC FAILED", error);
  process.exitCode = 1;
});
