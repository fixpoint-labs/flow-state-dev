/**
 * Who signs in to the goal-local Lab, and the organization it puts them in.
 * Shared by the Lab (`fsdev.config.mts`) and the check, which signs in as them.
 */

/** The organization both people sign in to. */
export const ORG = "goal-org";

/** The two people, each with their own verified bearer. */
export const PEOPLE = {
  alice: { userId: "u_goal_alice", bearer: "goal-verified-alice" },
  bob: { userId: "u_goal_bob", bearer: "goal-verified-bob" },
} as const;
