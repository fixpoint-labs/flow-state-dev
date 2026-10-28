/**
 * The names the coordinator pins: its flow, its record, its internal
 * entries, and its routing's server-written session state.
 * The delegate actions and the delegate list's state are any worker's
 * (`../delegates/delegate-keys`).
 *
 * A leaf with no imports, so the flow, its rounds and the delegate modules
 * share one spelling of each.
 */

/** The coordinator flow's name. **Pinned**: a worker's `flow:` names it. */
export const COORDINATOR_FLOW = "coordinator";

/**
 * The component every routing decision is recorded under, and the name of
 * best fit's fit check (`../fit-check.ts`). **Pinned**: a client tells a
 * record from a line by it, and a scripted model resolves the check's
 * evaluator by it, and its language-model ask by `coordinator-route-ask`.
 */
export const COORDINATOR_ROUTE = "coordinator-route";

/** The judgment turn's generator block, which a scripted model resolves by name. */
export const COORDINATOR_JUDGMENT = "coordinator-judgment";

/**
 * The internal entry a round's deadline wakes its conversation on (D2): the
 * entry of the wake the conversation owes at its earliest open deadline, or,
 * on a host that keeps no wakes, of its in-process timer. It carries nothing:
 * the conversation closes every round past its deadline. **Pinned**: a wake
 * stores it by name.
 */
export const ROUND_DEADLINE_ACTION = "roundDeadline";

/**
 * The internal entry a conversation sends answers back out on, in the round
 * after the one they landed in. Only the conversation's own code dispatches to
 * it, into its own session.
 */
export const ROUTE_ON_ACTION = "routeOn";

/**
 * The coordinator's internal entry an entry path dispatches into the user's
 * coordinator session, to add or remove one workstream's record. **Pinned**:
 * the workstream writes name it.
 */
export const WORKSTREAM_DELEGATE_ACTION = "changeWorkstreamDelegate";

/** The highest `rounds:` a coordinator may set. */
export const MAX_ROUNDS = 3;

/** How long a round waits for its answers before it closes without the rest, unless the flow sets its own. */
export const ROUND_DEADLINE_MS = 5 * 60_000;

/** Server-written session state: who best fit holds the user's next post for. */
export const HOLD_STATE = "bestFitHold";
/** Server-written session state: the delegate round robin gave the user's last post to. */
export const ROUND_ROBIN_STATE = "roundRobin";
/** Server-written session state: the rounds still open, each waiting for its answers. */
export const ROUNDS_STATE = "openRounds";
/**
 * Server-written session state: the answers that landed last, each with the
 * request that landed it, so a post routed before that request has finished
 * still reads the answer as a line.
 */
export const LANDED_STATE = "landedAnswers";
