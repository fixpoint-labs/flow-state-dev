/**
 * POC — throwaway, never merged. See harness.ts header.
 *
 * Q6. Which arbitration key should a relay delivery resolve to?
 *
 * The epic-spec settled that a blocking send must be REFUSED when the delivery
 * resolves to a key the sender already holds, and named the severity: under the
 * supported `{policy:"queue", key:"user"}` every blocking send would otherwise
 * deadlock, because every relay send is same-owner by design. What it did NOT
 * settle is what key a relay delivery resolves to in the first place — and that
 * decides whether "refuse on collision" leaves the blocking mode usable or
 * kills it on the default config.
 *
 * Two candidate keyings crossed with the flow's declared key and the target:
 *
 *   inherit  the delivery takes the flow's declared concurrency key, like any
 *            other request on that session
 *   pin      the delivery is keyed to the RECIPIENT's session regardless of
 *            what the flow declared
 *
 * Run: pnpm tsx spec-poc/FIX-1230-relay-core/q6-arbiter-key.ts   (~6s)
 */
import {
  createConcurrencyArbiter,
  type ConcurrencyArbiter
} from "../../packages/engine/src/transports/concurrency/arbiter";
import { boot, fromOutside, received, show } from "./harness";

/**
 * The "pin" candidate, as an injected arbiter rather than an engine patch.
 * `createInboundTransportHost` already takes one (`:106-113`), which is what
 * lets this run without touching shipped code.
 *
 * Stands in for `source === "relay"`; the POC has no relay source, so the
 * recipient's action name identifies the delivery.
 */
function pinRelayToRecipientSession(): ConcurrencyArbiter {
  const inner = createConcurrencyArbiter();
  return {
    resolve(flow, actionName, envelope) {
      const base = inner.resolve(flow, actionName, envelope);
      if (actionName !== "receiveAndReply") return base;
      return {
        policy: base.policy,
        key: envelope.sessionId === undefined ? undefined : envelope.sessionId
      };
    },
    gate: (decision, requestId) => inner.gate(decision, requestId)
  };
}

type Case = {
  label: string;
  /** "none" = the flow declares NO `concurrency` — what most apps have. */
  declared: "queue" | "none";
  flowKey: "user" | "session";
  keying: "inherit" | "pin";
  target: "peer" | "self";
};

async function run(c: Case): Promise<Record<string, unknown>> {
  received.length = 0;
  const { host } = boot(
    c.declared === "none" ? undefined : { policy: "queue", key: c.flowKey },
    c.keying === "pin" ? pinRelayToRecipientSession() : undefined
  );
  const USER = "user_a";
  for (const s of ["sess_sender", "sess_peer"]) {
    await fromOutside(host, "seed", { note: s }, s, USER);
  }
  const to = c.target === "self" ? "sess_sender" : "sess_peer";
  const { result } = await fromOutside(
    host,
    "sendOne",
    { to, timeoutMs: 4_000 },
    "sess_sender",
    USER
  );
  const output = (result as { output?: { timedOut?: boolean; elapsedMs?: number } }).output;

  // THE DISTINCTION THIS CASE SET EXISTS FOR: a RESOLVED key is not a HELD key.
  // `normalizeConfig(undefined)` returns `{ policy: "allow", key: "session" }`
  // (`arbiter.ts:88-93`), so an undeclared flow still RESOLVES a populated
  // session key — but `gate` short-circuits on `policy === "allow"` and acquires
  // NOTHING (`:164-167`). Comparing the resolved key would refuse here; comparing
  // what is actually held does not.
  const senderResolvedKey = c.flowKey === "user" ? "user_a" : "sess_sender";
  const senderHoldsIt = c.declared !== "none";
  const senderHeldKey = senderHoldsIt ? senderResolvedKey : undefined;
  const deliveryKey = c.keying === "pin" ? to : c.flowKey === "user" ? "user_a" : to;

  const row = {
    ...c,
    senderResolvedKey,
    senderHeldKey: senderHeldKey ?? "(none held)",
    deliveryKey,
    naiveResolvedKeyCollide: senderResolvedKey === deliveryKey,
    keysCollide: senderHeldKey !== undefined && senderHeldKey === deliveryKey,
    recipientRanWhileSenderWaited: received.length > 0,
    senderTimedOut: output?.timedOut,
    senderWaitedMs: output?.elapsedMs
  };
  show(c.label, row);
  return row;
}

async function main(): Promise<void> {
  const cases: Case[] = [
    { label: "1. queue key:user · inherit · peer", declared: "queue", flowKey: "user", keying: "inherit", target: "peer" },
    { label: "2. queue key:user · pin · peer", declared: "queue", flowKey: "user", keying: "pin", target: "peer" },
    { label: "3. queue key:user · pin · SELF", declared: "queue", flowKey: "user", keying: "pin", target: "self" },
    { label: "4. queue key:session · inherit · peer", declared: "queue", flowKey: "session", keying: "inherit", target: "peer" },
    { label: "5. queue key:session · inherit · SELF", declared: "queue", flowKey: "session", keying: "inherit", target: "self" },
    // 6 and 7 are THE DEFAULT CONFIGURATION — no `concurrency` declared at all,
    // which is what most apps have and what cases 1-5 never exercised.
    { label: "6. NO concurrency declared · peer", declared: "none", flowKey: "session", keying: "inherit", target: "peer" },
    { label: "7. NO concurrency declared · SELF", declared: "none", flowKey: "session", keying: "inherit", target: "self" }
  ];
  const rows: Array<Record<string, unknown>> = [];
  for (const c of cases) rows.push(await run(c));

  show(
    "MATRIX",
    rows.map((r) => ({
      case: r.label,
      collide: r.keysCollide,
      recipientRan: r.recipientRanWhileSenderWaited,
      senderTimedOut: r.senderTimedOut
    }))
  );

  show("VERDICT", {
    "the deadlock is specific to a SHARED key, not to relay":
      rows[0].recipientRanWhileSenderWaited === false &&
      rows[3].recipientRanWhileSenderWaited === true,
    "predicted collision matched observed stall in every case": rows.every(
      (r) => r.keysCollide === (r.recipientRanWhileSenderWaited === false)
    ),
    "case 7 IS THE TRAP: on the default config a self-addressed send is PERMITTED, and comparing the RESOLVED key instead of the HELD key would have refused it":
      rows[6].recipientRanWhileSenderWaited === true &&
      rows[6].senderTimedOut === false &&
      rows[6].naiveResolvedKeyCollide === true &&
      rows[6].keysCollide === false,
    "pinning rescues key:user (case 2) …": rows[1].recipientRanWhileSenderWaited === true,
    "… but case 3 is the price: a SELF-addressed delivery ran CONCURRENTLY with the sender's own open request on the same session, which the queue policy exists to prevent":
      rows[2].recipientRanWhileSenderWaited === true && rows[2].senderTimedOut === false,
    "case 5 is what a session-keyed flow does with no relay change at all: the collision is real and the wait stalls":
      rows[4].recipientRanWhileSenderWaited === false,
    note:
      "A stalled delivery is not a dropped one — unbounded admission keeps it queued " +
      "and it runs once the sender's request ends (epic Q3/Q4). That is AC 2's " +
      "late-delivery case, and it is why the refusal has to happen at SEND time."
  });
}

void main();
