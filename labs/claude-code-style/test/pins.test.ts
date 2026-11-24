/** The board sees the same user's pins across sessions through the real pins flow. */
import { createClient } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import { expect, it } from "vitest";
import { definePinsFlow } from "../workforce/flows/pins.mts";

it("starts empty and lists each pinned task once until it is unpinned", async () => {
  const app = createFlowState({
    flows: { pins: definePinsFlow()() },
    stores: { default: { primary: inMemoryStores() } },
  });
  try {
    const client = createClient({ userId: "reader", fetcher: createInProcessFetch(app) });
    const flow = client.flow("pins");
    const first = await flow.createSession();
    const second = await flow.createSession();
    const list = () => flow.read("listPins", {}, { sessionId: second.id });
    const change = async (action: "pin" | "unpin") => {
      const request = await flow.send(action, { taskId: "t1" }, { sessionId: first.id });
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
  } finally {
    await app.dispose();
  }
});
