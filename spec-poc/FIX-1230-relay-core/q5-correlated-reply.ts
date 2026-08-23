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
import { itemToLLMMessages } from "../../packages/engine/src/context/history";

async function main(): Promise<void> {
  const { host, stores } = boot();

  // Three sessions, one owner. Cross-user is refused by an existing invariant
  // (epic Q1) and is not what this asks about.
  const USER = "user_a";
  for (const s of ["sess_sender", "sess_peer_a", "sess_peer_b"]) {
    await fromOutside(host, "seed", { note: s }, s, USER);
  }

  const { requestId: senderRequestId, result } = await fromOutside(
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
  // THROUGH PERSISTENCE, not just the live emitter. A reply that only ever
  // existed in memory would satisfy everything above and still be absent from
  // the history a later turn rebuilds from.
  const record = await stores.request.get(senderRequestId);
  const persisted = (record?.items ?? []) as Array<{
    id?: string;
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  const persistedReplies = persisted.filter((i) => i.id?.startsWith("relay_reply_"));
  show(
    "the sender's PERSISTED items (what a later turn rebuilds from)",
    persistedReplies.map((i) => ({
      id: i.id,
      type: i.type,
      role: i.role,
      contentText: i.content?.[0]?.text
    }))
  );

  const shaped = persistedReplies.every(
    (i) =>
      i.type === "message" &&
      typeof i.role === "string" &&
      Array.isArray(i.content) &&
      typeof i.content[0]?.text === "string"
  );
  const persistedPayloads = persistedReplies.map((i) => {
    try {
      return JSON.parse(i.content?.[0]?.text ?? "{}") as { correlationId?: string };
    } catch {
      return {};
    }
  });

  Object.assign(verdict, {
    // Both replies survived to the request record, still shaped as valid
    // MessageItems — the half the live-emitter assertions cannot see.
    bothRepliesPersisted: persistedReplies.length === 2,
    persistedRepliesAreValidMessageItems: shaped,
    persistedPayloadsCarryBothCorrelationIds:
      persistedPayloads.some((x) => x.correlationId === "corr_A") &&
      persistedPayloads.some((x) => x.correlationId === "corr_B")
  });

  // THE PROPERTY THAT ACTUALLY MATTERS, and presence-in-the-store does not test it:
  // run the persisted items through the real history reconstruction and confirm the
  // reply carrier contributes NOTHING. `message` is a conversational type, so an
  // unstamped carrier would come back as a fake `user` turn and the sender's next
  // generator step would read its own answer twice.
  const allItems = persisted as never[];
  const reconstructed = allItems.flatMap((i) => itemToLLMMessages(i, allItems));
  const replyTextInHistory = reconstructed.filter((m) =>
    JSON.stringify(m).includes("relay_reply_") || JSON.stringify(m).includes("correlationId")
  );
  show("reply carrier's contribution to reconstructed LLM history", {
    totalReconstructedMessages: reconstructed.length,
    messagesMentioningTheReply: replyTextInHistory.length
  });

  Object.assign(verdict, {
    replyIsAbsentFromReconstructedLLMHistory: replyTextInHistory.length === 0
  });

  show("VERDICT", verdict);
}

void main();
