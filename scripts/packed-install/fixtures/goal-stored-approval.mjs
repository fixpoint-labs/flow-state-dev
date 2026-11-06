/**
 * Runs inside the consumer project for `shims.stored-human-approval`: a
 * suspension a 0.2 host stored with `reason: "human_approval"` must read as a
 * user's stop through the installed `isUserSuspension` (from
 * `@flow-state-dev/core/types`, where the core README points adopters).
 *
 * The record goes through a JSON round trip, as it would out of a store.
 * An installed core without `isUserSuspension` fails the assertion; it does
 * not crash it.
 *
 * Prints `stored-approval: ok`, or `stored-approval: FAIL at <step>: …`.
 */
const stored = JSON.parse(
  JSON.stringify({
    id: "susp_goal_1",
    requestId: "req_goal_1",
    reason: "human_approval",
    status: "pending",
    createdAt: 1_700_000_000_000,
  }),
);

let isUserSuspension;
try {
  ({ isUserSuspension } = await import("@flow-state-dev/core/types"));
} catch (err) {
  console.log(`stored-approval: FAIL at import: ${String(err?.message ?? err).slice(0, 200)}`);
  process.exit(0);
}
if (typeof isUserSuspension !== "function") {
  console.log("stored-approval: FAIL at import: @flow-state-dev/core/types has no isUserSuspension");
  process.exit(0);
}
console.log(
  isUserSuspension(stored)
    ? "stored-approval: ok"
    : "stored-approval: FAIL at read: a stored human_approval suspension is not a user's stop",
);
