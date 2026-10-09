/**
 * The names the coordinator pins: its flow, its record, its actions, the
 * entry a delegate's flow declares, and the server-written session state.
 *
 * A leaf with no imports, so the flow, the delegated-post entry and the
 * delegate modules share one spelling of each.
 */

/** The coordinator flow's kind. **Pinned**: a worker's `flow:` names it. */
export const COORDINATOR_KIND = "coordinator";

/**
 * The component every routing decision is recorded under, and the name of
 * best fit's evaluator block. **Pinned**: a client tells a record from a
 * line by it, and a scripted model resolves the evaluator by it.
 */
export const COORDINATOR_ROUTE = "coordinator-route";

/** The judgment turn's generator block, which a scripted model resolves by name. */
export const COORDINATOR_JUDGMENT = "coordinator-judgment";

/** The four delegate actions. **Pinned**: an app sends them by name. */
export const ADD_DELEGATE = "addDelegate";
export const REMOVE_DELEGATE = "removeDelegate";
export const SET_FALLBACK = "setFallback";
export const LIST_DELEGATES = "listDelegates";

/** The coordinator's tool that hands the post it is reading to one delegate. */
export const HAND_OFF = "handOff";

/**
 * The internal entry a delegate's answer arrives on. Internal only: an answer
 * names the delivery it answers, so a caller who could reach it could take
 * that delivery's one answer.
 */
export const DELEGATE_ANSWER_ACTION = "delegateAnswer";

/**
 * The internal entry a delegate reports a delivery it has no answer for on:
 * its turn failed, or the round's deadline came first. Internal only, like
 * {@link DELEGATE_ANSWER_ACTION}.
 */
export const DELEGATE_MISSED_ACTION = "delegateMissed";

/**
 * The internal entry a conversation sends answers back out on, in the round
 * after the one they landed in. Only the conversation's own code dispatches to
 * it, into its own session.
 */
export const ROUTE_ON_ACTION = "routeOn";

/**
 * The internal entry a worker flow declares to take a delegated post. A
 * worker whose flow declares it can be a delegate that takes posts.
 */
export const DELEGATED_POST_ENTRY = "onDelegatedPost";

/** The most delegate records one conversation holds. */
export const MAX_DELEGATES = 25;

/** The highest `rounds:` a coordinator may set. */
export const MAX_ROUNDS = 3;

/** How long a round waits for its answers before it closes without the rest, unless the flow sets its own. */
export const ROUND_DEADLINE_MS = 5 * 60_000;

/** Server-written session state: the conversation's delegate records, `null` until first read or changed. */
export const DELEGATES_STATE = "delegates";
/** Server-written session state: the conversation's fallback delegate record, or `null`. */
export const FALLBACK_STATE = "fallback";
/** Server-written session state: who best fit holds the person's next post for. */
export const HOLD_STATE = "bestFitHold";
/** Server-written session state: the delivery ledger. */
export const DELIVERIES_STATE = "deliveries";
/** Server-written session state: the delegate round robin gave the person's last post to. */
export const ROUND_ROBIN_STATE = "roundRobin";
/** Server-written session state: the rounds still open, each waiting for its answers. */
export const ROUNDS_STATE = "openRounds";
/**
 * Server-written session state: the answers that landed last, each with the
 * request that landed it, so a post routed before that request has finished
 * still reads the answer as a line.
 */
export const LANDED_STATE = "landedAnswers";
