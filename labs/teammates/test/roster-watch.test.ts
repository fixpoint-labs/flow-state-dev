/**
 * The calls' own roster watch: the first conversation opened starts it, so a
 * line under a worker's name reads as that worker's. Whoever made the calls
 * stops it with `close()`, so it never outlives them. A roster read that fails
 * before one lands fails that open, as `ensureWorkerSession`'s own read would,
 * rather than leaving the open waiting forever; the next open watches anew.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient } from "@flow-state-dev/client";

type Watch = { onRoster: (entries: { id: string; settings: Record<string, unknown> }[]) => void; onError?: (error: unknown) => void; stopped: boolean };
const watches = vi.hoisted(() => [] as Watch[]);
vi.mock("@flow-state-dev/workforce/browser", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/workforce/browser")>()),
  createWorkforceClient: () => ({
    ensureWorkerSession: async ({ worker }: { worker: string }) => ({ id: `conv_${worker}`, flowKind: "agent" }),
    watchRoster: (onRoster: Watch["onRoster"], options?: { onError?: (error: unknown) => void }) => {
      const watch: Watch = { onRoster, onError: options?.onError, stopped: false };
      watches.push(watch);
      return () => void (watch.stopped = true);
    },
  }),
}));

import { createAppCalls } from "../src/app";

const calls = () => createAppCalls(createClient({ userId: "u", baseUrl: "", fetcher: (async () => new Response("{}")) as never }));

describe("the calls' roster watch", () => {
  it("is stopped by close(), once the first conversation started it", async () => {
    watches.length = 0;
    const lab = calls();
    const opened = lab.openConversation("eng");
    watches[0]!.onRoster([{ id: "eng", settings: {} }]);
    expect(await opened).toBe("conv_eng");
    expect(watches.map((w) => w.stopped)).toEqual([false]);
    lab.close();
    expect(watches.map((w) => w.stopped)).toEqual([true]);
  });

  it("fails the open when its first read fails, stops that watch, and the next open watches anew", async () => {
    watches.length = 0;
    const lab = calls();
    const opened = lab.openConversation("eng");
    watches[0]!.onError?.(new Error("401 Unauthorized"));
    await expect(opened).rejects.toThrow("401 Unauthorized");
    expect(watches[0]!.stopped).toBe(true);
    const again = lab.openConversation("eng");
    expect(watches).toHaveLength(2);
    watches[1]!.onRoster([{ id: "eng", settings: {} }]);
    expect(await again).toBe("conv_eng");
    // A failure after a read landed is the live read's to retry: the watch stays.
    watches[1]!.onError?.(new Error("blip"));
    expect(watches[1]!.stopped).toBe(false);
  });
});
