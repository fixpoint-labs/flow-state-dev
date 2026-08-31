/**
 * The relay door — which handler a session-to-session message may reach, and
 * whether it may reach one at all (FIX-1230).
 *
 * This is the whole security property of relay, and it is decided **once, at
 * the `sendMessage` verb**, which is the single place a relay message is
 * created. A guard added at the tool is a guard the verb's other callers skip.
 * The answer is then *stamped onto the message* (`metadata.relay.door`) and
 * `resolveActionCore` honours the stamp rather than recomputing it — see "The
 * door's ANSWER travels" below.
 *
 * ## Two axes, and conflating them is how a hole gets opened
 *
 * A declared `flow.relay.on[kind]` handler resolves **first** and is reachable
 * on every session kind: it is a surface the flow's own author wrote down for
 * exactly this purpose. What is gated is the **fallthrough to `flow.actions`**,
 * and it is gated on both ends of the send:
 *
 * 0. Either end's `sessionKind` is absent → refuse, *before any door is
 *    resolved*. The ordering is the rule, not a detail of it: placed among the
 *    fallthrough gates instead, a legacy sender or recipient would still reach a
 *    declared handler while the contract says absence is refused
 *    unconditionally. Fail-closed that covers one of two doors is not
 *    fail-closed.
 * 1. The **recipient** is a workstream → the fallthrough is refused. Terminal.
 *    Protects the recipient's narrow declared surface.
 * 2. The **sender** is a workstream → the fallthrough is refused, whatever the
 *    recipient is. Confines the agent. The two properties read alike and are not
 *    the same: one is about whose surface is exposed, the other about who is
 *    allowed to reach out, and closing only the first still leaves a worker able
 *    to reach an undeclared public action on a peer.
 * 3. Otherwise the message falls through to `flow.actions[kind]`…
 * 4. …**but not to an action declared `durable`.** Rules 1 and 2 narrow *who*
 *    may use the second door; this narrows *what it opens onto*. It has to live
 *    here rather than at construction because the fallthrough's `kind` is
 *    caller-supplied, so there is no static pairing to validate.
 *
 *    **Rule 4 is the early, nameable case and is NOT the guarantee.**
 *    `ActionCore.durable` is not what enables suspension — `ctx.suspend()` is
 *    gated on the *host* having a `DurabilityProvider` and never consults the
 *    action's flag — so an action with `durable` unset can suspend on a
 *    durability-enabled host and no construction-time or resolution-time flag
 *    check can see it. The guarantee is the runtime refusal at the suspend guard
 *    itself (`createExecutionContext`), which sees exactly the requests that
 *    actually reach suspension. The two checks cover **different sets**, not one
 *    set at two times, which is why neither is redundant.
 *
 * ## Both kinds are server-derived, so gating on them is BP-031-clean
 *
 * The recipient's comes off the session record the send already loads; the
 * sender's off the request-host identity closure, where `createExecutionContext`
 * has already loaded and identity-checked that record. Neither is ever read off
 * the message.
 *
 * ## The door's ANSWER travels; the door's implementation cannot
 *
 * `runActionInternal` resolves the action core **before** the recipient's
 * session record is loaded, so a worker has no `sessionKind` at the moment it
 * routes; `DispatchEnvelope` carries no session kind; and the sender's kind
 * lives in a request-host closure that does not cross a queue boundary at all.
 * So the sending side writes the routing answer onto the message and the worker
 * does not recompute it. `metadata` is plain data and crosses a queue intact,
 * while `resolvedActionCore` is explicitly non-serializable and dropped by
 * external dispatchers.
 *
 * *Freeze-at-send is accepted, not overlooked:* a session whose kind changes
 * between send and run is routed on the older answer.
 *
 * ## Refusal codes are deliberately coarse
 *
 * A closed workstream-axis door and a legacy record share one code with each
 * other, on the same isolation reasoning as `unknown-recipient`: *which* door
 * was shut is exactly what a confined sender should not learn. `durable-action`
 * is the one door refusal with its own code, because an app author whose durable
 * action stopped receiving messages must be able to tell that from a security
 * refusal — collapsing them would make a supported configuration
 * undiagnosable.
 */
import type {
  ActionCore,
  FlowInstance,
  RelayMessageBinding,
  SendMessageRefusal
} from "@flow-state-dev/core/types";
import type { SessionKind } from "../stores/types";

/**
 * Which door a send resolved. Stamped onto the delivery so the worker routes on
 * the sending side's answer rather than recomputing one.
 */
export type RelayDoorForm = "declared" | "action";

/**
 * The door decision for one send.
 *
 * The two success arms are **discriminated by door form**, so a caller that has
 * narrowed to `"declared"` holds the binding — with its `input` mapper — rather
 * than a bare `ActionCore` it would have to cast back. A cast there would be the
 * one place the two doors could be confused, which is the last place to allow
 * one.
 *
 * The core is returned so the send can inspect it — rule 4 reads `durable` — and
 * deliberately **not** carried on the dispatch envelope: a block cannot cross a
 * queue boundary, and the stamp is what survives where a carried core cannot.
 */
export type RelayDoorVerdict =
  | { readonly ok: true; readonly door: "declared"; readonly core: RelayMessageBinding }
  | { readonly ok: true; readonly door: "action"; readonly core: ActionCore }
  | {
      readonly ok: false;
      readonly refused: SendMessageRefusal;
      readonly detail: string;
    };

/** Whether a session kind is one that may use the `flow.actions` fallthrough. */
function isAddressable(kind: SessionKind): boolean {
  return kind === "top-level" || kind === "sibling";
}

/**
 * Decide which door a relay message may enter, from the sender's and
 * recipient's server-derived session kinds.
 *
 * @param inputs `flow` is the **recipient's** flow instance; `kind` is the
 * caller-supplied message kind (the deliberate BP-031 exception — a locator, not
 * an authority); the two session kinds come off session records and never off
 * the message.
 */
export function resolveRelayDoor(inputs: {
  flow: Pick<FlowInstance, "actions" | "relay">;
  kind: string;
  senderKind: SessionKind | undefined | null;
  recipientKind: SessionKind | undefined | null;
}): RelayDoorVerdict {
  const { flow, kind, senderKind, recipientKind } = inputs;

  // Rule 0 — FIRST, ahead of the declared handler. A record written before
  // session kinds existed reads back `undefined`, and a store that nulls absent
  // keys hands back `null` (BP-030). Absent REFUSES; it never falls through to a
  // permissive default, because here the tolerant reading is the exploitable
  // one. The one-time `backfillSessionKind` sweep repairs the rows; this is what
  // holds until it has run.
  if (senderKind == null || recipientKind == null) {
    return {
      ok: false,
      refused: "recipient-not-addressable",
      detail:
        "this send names a session recorded before session kinds existed, so the framework " +
        "cannot tell whether the message may be delivered. Run `fsdev migrate session-kind` " +
        "to classify existing sessions."
    };
  }

  // Rule 1 (as the positive case) — a declared binding is the flow author's own
  // statement of what this session accepts, so it is reachable on every session
  // kind and never asks either question below.
  const declared = flow.relay?.on?.[kind];
  if (declared !== undefined) {
    return { ok: true, door: "declared", core: declared };
  }

  if (!isAddressable(recipientKind) || !isAddressable(senderKind)) {
    return {
      ok: false,
      refused: "recipient-not-addressable",
      detail:
        `no relay binding is declared for "${kind}", and this sender and recipient pair may ` +
        "not fall through to the flow's public actions."
    };
  }

  const action = flow.actions[kind];
  if (action === undefined) {
    return {
      ok: false,
      refused: "no-relay-door",
      detail:
        `the recipient's flow declares neither a relay binding nor a public action named ` +
        `"${kind}".`
    };
  }

  // Rule 4. Named separately from the refusals above on purpose: this is a
  // supported configuration meeting a narrowed door, not a security refusal.
  if (action.durable === true) {
    return {
      ok: false,
      refused: "durable-action",
      detail:
        `the public action "${kind}" is declared durable, and a relay delivery may not suspend ` +
        "— a relay request has no caller-facing entry and therefore no caller-facing re-entry, " +
        "so a suspended one could never be resumed. Declare a relay binding for this kind " +
        "instead, or make the action non-durable."
    };
  }

  return { ok: true, door: "action", core: action };
}
