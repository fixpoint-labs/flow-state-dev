/**
 * One-command demo of lab D. Prints load → registries → session → dispatch.
 *
 *   pnpm --filter @flow-state-dev/workforce-poc-d demo
 */
import { bootLab, loadCommittedTree, until } from "./bootstrap";

const loaded = loadCommittedTree();
const host = await bootLab(loaded);

try {
  const listed = await host.agents.list();
  const clerk = await host.agents.get("clerk");
  const intake = await host.agents.get("intake");

  const dm = await host.createSession("clerk", "talk-to-clerk", "talk-to-clerk");
  const who = await host.call("clerk", "whoami", {}, dm.id);
  const talked = await host.call("clerk", "talk", { message: "hello clerk" }, dm.id);

  const delivered = await host.call(
    "clerk",
    "deliver",
    { sessionId: dm.id, body: "standup in 10", fromSessionId: dm.id },
    dm.id
  );
  if (delivered.error) {
    throw new Error(delivered.error.message ?? "deliver failed");
  }

  await until(async () => {
    const state = await host.sessionState(dm.id);
    return state?.lastWake != null;
  }, "clerk session wake");

  console.log(
    JSON.stringify(
      {
        loaded: {
          seats: loaded.seats.map((s) => s.name),
          skipped: loaded.skipped
        },
        agentRegistry: listed.map((a) => a.name),
        clerkAgent: clerk && { name: clerk.name, description: clerk.description },
        intakeAgent: intake && { name: intake.name },
        flowKinds: host.runtime.registry.list().map((f) => f.kind),
        dm,
        who: who.output,
        talked: talked.output,
        lastWake: (await host.sessionState(dm.id))?.lastWake,
        secondRegistry: false,
        hotDynamicKinds: false
      },
      null,
      2
    )
  );
} finally {
  await host.dispose();
}
