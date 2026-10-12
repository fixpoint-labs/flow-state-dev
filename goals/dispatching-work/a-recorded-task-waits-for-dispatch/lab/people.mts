/**
 * Who signs in to the goal-local Lab, and the organization it puts them in.
 * Shared by the Lab (`fsdev.config.mts`) and the check, which signs in as them.
 */

/** The organization the person signs in to. */
export const ORG = "goal-org";

/** The one person, with a verified bearer. */
export const ALICE = { userId: "u_goal_alice", bearer: "goal-verified-alice" } as const;
