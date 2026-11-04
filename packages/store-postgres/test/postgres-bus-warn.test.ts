/**
 * The Postgres bus's one warning when its listening connection can't open
 * (FIX-2427). Its own file: the warning is once per process, and another
 * test's failed connects would use it up first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresBus } from "../src/bus";
import { FakeNotifyNetwork, until } from "./fake-notify-network";

afterEach(() => vi.restoreAllMocks());

describe("the Postgres bus · a listening connection that won't open", () => {
  it("says why once, with the first error, and keeps retrying", async () => {
    const network = new FakeNotifyNetwork();
    network.failConnects = 3;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = createPostgresBus({
      executor: network.executor,
      liveTailPool: network.pool,
      notify: true,
      timings: { pingIntervalMs: 20, staleAfterMs: 50, reconnectMinMs: 5, reconnectMaxMs: 20 }
    });
    bus.subscribe({ scope: "session", id: "s1", tenantId: "" }, () => {});
    await until(() => bus.crossesProcesses, 2_000);
    const lines = warn.mock.calls.filter((call) => String(call[0]).includes("could not open"));
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toBeInstanceOf(Error);
    expect(String((lines[0]![1] as Error).message)).toMatch(/connect refused/);
    await bus.close();
  });
});
