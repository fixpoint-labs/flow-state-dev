/**
 * One-command demo of the static board-notify path.
 *
 *   pnpm --filter @flow-state-dev/workforce-poc-board-notify demo
 */
import { boardNotifyFlow, FLOW_KIND } from "./flow";
import { bootLab, until } from "./bootstrap";

const host = await bootLab();
const topic = "standup";

try {
  const poster = await host.createSession(FLOW_KIND, "poster", "poster");
  const alice = await host.createSession(FLOW_KIND, "alice", "alice");
  const bob = await host.createSession(FLOW_KIND, "bob", "bob");
  const replay = await host.createSession(FLOW_KIND, "poster", "poster");

  await host.call(FLOW_KIND, "openBoard", { topic }, poster.id);
  await host.call(FLOW_KIND, "subscribe", { topic, seat: "alice" }, alice.id);
  await host.call(
    FLOW_KIND,
    "subscribe",
    { topic, seat: "bob", entry: "invented-from-data" },
    bob.id
  );
  await host.call(
    FLOW_KIND,
    "subscribe",
    { topic, seat: "bob", sessionId: "ghost-gone" },
    poster.id
  );

  const posted = await host.call(
    FLOW_KIND,
    "post",
    { topic, body: "standup in 10", brief: "daily standup" },
    poster.id
  );
  if (posted.error) {
    throw new Error(posted.error.message ?? "post failed");
  }

  await until(async () => {
    const [a, b] = await Promise.all([
      host.sessionState(alice.id),
      host.sessionState(bob.id)
    ]);
    return a?.lastNotify != null && b?.lastNotify != null;
  }, "alice and bob to record onNotify");

  const board = await host.call(FLOW_KIND, "read", { topic }, poster.id);
  const wakes = {
    alice: (await host.sessionState(alice.id))?.lastNotify,
    bob: (await host.sessionState(bob.id))?.lastNotify,
    poster: (await host.sessionState(poster.id))?.lastNotify ?? null
  };

  console.log(
    JSON.stringify(
      {
        flow: boardNotifyFlow.kind,
        staticTargets: { alice: "onNotify", bob: "onNotify" },
        existingSessionRefuse: {
          status: replay.status,
          paperedOver: false
        },
        posted: posted.output,
        wakes,
        board: board.output
      },
      null,
      2
    )
  );
} finally {
  await host.dispose();
}
