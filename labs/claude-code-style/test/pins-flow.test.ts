/**
 * The `pins` flow on the real engine: pins are kept in user state that
 * starts empty, so a user who has never pinned can still pin and unpin.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import { definePinsFlow, PINS_FLOW } from "../workforce/flows/pins.mts";

async function pinsSession() {
  const state = createFlowState({ flows: { [PINS_FLOW]: definePinsFlow()({ id: PINS_FLOW }) }, stores: { default: { primary: inMemoryStores() } } } as never);
  const fsd = createClient({ userId: "u_new", baseUrl: "", fetcher: createInProcessFetch(state) as never });
  const flow = fsd.flow(PINS_FLOW);
  const { id } = await flow.createSession();
  const act = async (action: "pin" | "unpin", taskId: string) => {
    const started = await flow.send(action, { taskId }, { sessionId: id });
    const { status } = await started.wait();
    const row = (await fsd.sessions.requests(id, { includeResultOutput: true })).find((r) => r.id === started.id);
    return { status, output: row?.result?.output, error: row?.result?.error };
  };
  const list = async () => (await flow.read<{ pinned: string[] }>("listPins", {}, { sessionId: id })).pinned;
  return { act, list };
}

describe("the pins flow", () => {
  it("lets a user who has never pinned unpin, then pin, a thread", async () => {
    const pins = await pinsSession();
    expect(await pins.list()).toEqual([]);
    // Their user state has no `pinned` yet: neither action may assume it does.
    expect(await pins.act("unpin", "t0")).toMatchObject({ status: "completed", output: { pinned: [] } });
    expect(await pins.act("pin", "t1")).toMatchObject({ status: "completed", output: { pinned: ["t1"] } });
    expect(await pins.list()).toEqual(["t1"]);
  });

  it("keeps a thread pinned once however often it is pinned, and unpins it", async () => {
    const pins = await pinsSession();
    await pins.act("pin", "t1");
    await pins.act("pin", "t1");
    expect(await pins.list()).toEqual(["t1"]);
    await pins.act("unpin", "t1");
    expect(await pins.list()).toEqual([]);
  });
});
