/** The board sees the same user's pins across sessions through the real pins flow. */
import { createClient } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import { expect, it } from "vitest";
import { definePinsFlow } from "../workforce/flows/pins.mts";

it("keeps pins across sessions when users repeat or overlap changes", async () => {
  const app = createFlowState({
    flows: { pins: definePinsFlow()() },
    stores: { default: { primary: inMemoryStores() } },
  });
  try {
    const client = createClient({ userId: "reader", fetcher: createInProcessFetch(app) });
    const flow = client.flow("pins");
    const first = await flow.createSession();
    const second = await flow.createSession();
    const list = () => flow.read<{ pinned: string[] }>("listPins", {}, { sessionId: second.id });
    const change = async (action: "pin" | "unpin", taskId = "t1", sessionId = first.id) => {
      const request = await flow.send(action, { taskId }, { sessionId });
      expect((await request.wait()).status).toBe("completed");
    };

    expect(await list()).toEqual({ pinned: [] });
    await change("unpin");
    expect(await list()).toEqual({ pinned: [] });
    await change("pin");
    await change("pin");
    expect(await list()).toEqual({ pinned: ["t1"] });
    await change("unpin");
    expect(await list()).toEqual({ pinned: [] });

    await Promise.all([change("pin", "a", first.id), change("pin", "b", second.id)]);
    const { pinned } = await list();
    expect(pinned.sort()).toEqual(["a", "b"]);
  } finally {
    await app.dispose();
  }
});
