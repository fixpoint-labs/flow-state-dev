/**
 * One-command demo of lab A. Prints the three observables.
 *
 *   pnpm --filter @flow-state-dev/workforce-poc-a demo
 */
import { bootLab, clerkWorker, until } from "./bootstrap";
import { createWorkerFlow } from "./factory";

const clerk = clerkWorker();
const editor = createWorkerFlow({
  name: "editor",
  role: "edit copy",
  personality: "brief",
  tools: [],
  skills: []
});
const host = await bootLab({ [clerk.kind]: clerk, [editor.kind]: editor });

try {
  const dm = await host.createSession(clerk.kind, "talk-to-clerk", "talk-to-clerk");
  const subscriberIds = ["sub-alice", "sub-bob", "sub-cara"] as const;
  const subs: Array<{ id: string; flowKind: string; title?: string }> = [];
  for (const id of subscriberIds) {
    subs.push(await host.createSession(clerk.kind, id, id));
  }

  const who = await host.call(clerk.kind, "whoami", {}, dm.id);
  const talked = await host.call(clerk.kind, "talk", { message: "hello clerk" }, dm.id);

  for (const sub of subs) {
    const subscribed = await host.call(clerk.kind, "subscribe", {}, sub.id);
    if (subscribed.error) {
      throw new Error(subscribed.error.message ?? "subscribe failed");
    }
  }

  const posted = await host.call(clerk.kind, "post", { body: "standup in 10" }, dm.id);
  if (posted.error) {
    throw new Error(posted.error.message ?? "post failed");
  }

  await until(async () => {
    const states = await Promise.all(subs.map((s) => host.sessionState(s.id)));
    return states.every((state) => state?.lastWake != null);
  }, "N subscriber wakes");

  const wakes = await Promise.all(
    subs.map(async (s) => ({
      id: s.id,
      lastWake: (await host.sessionState(s.id))?.lastWake
    }))
  );

  const editorDm = await host.createSession(editor.kind, "talk-to-editor", "talk-to-editor");
  const cross = await host.call(
    clerk.kind,
    "deliver",
    {
      sessionId: editorDm.id,
      postId: "cross",
      body: "should refuse",
      fromSessionId: dm.id
    },
    dm.id
  );

  console.log(
    JSON.stringify(
      {
        factory: who.output,
        dm,
        talked: talked.output,
        subscribers: subs.map((s) => s.id),
        posted: posted.output,
        wakes,
        sharedGroupSession: false,
        crossFlow: {
          refused: Boolean(cross.error),
          message: cross.error?.message
        }
      },
      null,
      2
    )
  );
} finally {
  await host.dispose();
}
