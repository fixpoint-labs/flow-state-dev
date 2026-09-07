/**
 * One-command demo of lab F. Prints the three intake routes and the gap.
 *
 *   pnpm --filter @flow-state-dev/workforce-poc-f demo
 */
import { bootLab } from "./bootstrap";
import { ENGINEERING, MARKETING, MEMBER_KIND, memberSeats } from "./roster";

const host = await bootLab();

try {
  const eng = await host.openInbox(ENGINEERING.id);
  const mkt = await host.openInbox(MARKETING.id);

  for (const seat of memberSeats(ENGINEERING)) {
    await host.createSession(seat.flowKind, seat.sessionId, seat.sessionId);
  }

  const claimed = await host.call(
    eng.flowKind,
    "talk",
    {
      message: "@alice take the API review",
      roster: ENGINEERING.id,
      postId: "p-claim",
    },
    eng.id,
  );
  if (claimed.error) throw new Error(claimed.error.message ?? "claim talk failed");

  const alicePickup = await host.call(
    MEMBER_KIND,
    "pickup",
    { seat: "alice" },
    "dm-alice",
  );

  const ordered = await host.call(
    eng.flowKind,
    "talk",
    {
      message: "ordered: status from each of you",
      roster: ENGINEERING.id,
      postId: "p-ordered",
    },
    eng.id,
  );
  if (ordered.error) throw new Error(ordered.error.message ?? "ordered talk failed");

  const bobBeforeAlice = await host.call(
    MEMBER_KIND,
    "pickup",
    { seat: "bob", taskId: "p-ordered:bob" },
    "dm-bob",
  );
  const aliceOrdered = await host.call(
    MEMBER_KIND,
    "pickup",
    { seat: "alice", taskId: "p-ordered:alice" },
    "dm-alice",
  );
  const bobAfterAlice = await host.call(
    MEMBER_KIND,
    "pickup",
    { seat: "bob", taskId: "p-ordered:bob" },
    "dm-bob",
  );

  const fanout = await host.call(
    eng.flowKind,
    "talk",
    {
      message: "standup in 10",
      roster: ENGINEERING.id,
      postId: "p-fanout",
    },
    eng.id,
  );
  if (fanout.error) throw new Error(fanout.error.message ?? "fan-out talk failed");

  const wake = await host.call(
    eng.flowKind,
    "wake",
    {
      sessionId: "dm-alice",
      postId: "p-fanout",
      body: "should refuse",
      fromSessionId: eng.id,
    },
    eng.id,
  );

  const inspect = await host.call(eng.flowKind, "inspect", {}, eng.id);

  console.log(
    JSON.stringify(
      {
        engineeringInbox: eng,
        marketingInbox: mkt,
        sameInbox: eng.id === mkt.id,
        claimed: claimed.output,
        alicePickup: alicePickup.output,
        ordered: ordered.output,
        aliceOrdered: aliceOrdered.output,
        bobBlockedUntilAlice: bobBeforeAlice.output,
        bobAfterAlice: bobAfterAlice.output,
        fanout: fanout.output,
        crossFlowWake: {
          refused: Boolean(wake.error),
          message: wake.error?.message,
        },
        inspect: inspect.output,
        teamFlow: false,
      },
      null,
      2,
    ),
  );
} finally {
  await host.dispose();
}
