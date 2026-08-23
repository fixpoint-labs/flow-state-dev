/**
 * POC — throwaway, never merged. See harness.ts header.
 *
 * Q5. Can a reply produced by the RECIPIENT's separate request land on the
 * SENDER's live response stream and wake a wait that was built at tool-call
 * runtime — and do TWO sends outstanding at once each wake on their own reply
 * rather than one satisfying both?
 *
 * This is the epic-spec's §8 "runtime correlation-aware wait seam" constraint,
 * run instead of argued. Both halves are in one experiment on purpose: they
 * fail together (a delivery nobody is waiting on, or a wait nothing can reach)
 * and a spec that gets one right and the other wrong reads correct.
 *
 * Run: pnpm tsx spec-poc/FIX-1230-relay-core/q5-correlated-reply.ts   (~1s)
 */
import { boot, deliveries, fromOutside, received, show } from "./harness";

async function main(): Promise<void> {
  const { host } = boot();

  // Three sessions, one owner. Cross-user is refused by an existing invariant
  // (epic Q1) and is not what this asks about.
  const USER = "user_a";
  for (const s of ["sess_sender", "sess_peer_a", "sess_peer_b"]) {
    await fromOutside(host, "seed", { note: s }, s, USER);
  }

  const { result } = await fromOutside(
    host,
    "sendTwo",
    { toA: "sess_peer_a", toB: "sess_peer_b", timeoutMs: 5_000 },
    "sess_sender",
    USER
  );

  const output = (result as { output?: { a?: unknown; b?: unknown; myRequestId?: string } }).output;
  show("sender result", output);
  show("what the recipients saw", received);
  show("what each reply delivery reported", deliveries);

  type R = {
    correlationId: string;
    timedOut: boolean;
    sawItemId?: string;
    replyPayload?: { answerTo?: string; echo?: string };
  };
  const a = output?.a as R;
  const b = output?.b as R;

  const verdict = {
    bothWokeWithoutTimingOut: a?.timedOut === false && b?.timedOut === false,
    eachWokeOnItsOwnReply:
      a?.sawItemId === "relay_reply_corr_A" && b?.sawItemId === "relay_reply_corr_B",
    // THE PROMISE, not the mechanism: the sender got the recipient's ANSWER,
    // and got its OWN one. Waking on the right item id proves neither.
    eachReceivedItsOwnRecipientPayload:
      a?.replyPayload?.answerTo === "corr_A" &&
      a?.replyPayload?.echo === "question A" &&
      b?.replyPayload?.answerTo === "corr_B" &&
      b?.replyPayload?.echo === "question B",
    bothRepliesDelivered: deliveries.every((d) => d.delivered === true),
    tworecipientRequests: received.length === 2,
    recipientsRanOnTheirOwnSessions:
      new Set(received.map((r) => r.sessionId)).size === 2 &&
      !received.some((r) => r.sessionId === "sess_sender"),
    recipientRequestIdsDifferFromSender: !received.some(
      (r) => r.requestId === output?.myRequestId
    )
  };
  show("VERDICT", verdict);
}

void main();
