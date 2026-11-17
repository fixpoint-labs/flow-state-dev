/**
 * Stop reaches every turn still running in the session, however many newer
 * turns it has had since: a turn the session's recent history no longer
 * lists is still stopped.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeApps, openTestApp, readUntil, waitFor, type Script } from "./app-host";

/** A turn on "Keep working" runs until it is stopped; any other line is noted at once. */
const scripts: Record<string, Script> = {
  "agent-answer": async ({ said, signal }) => {
    if (said.slice(said.lastIndexOf('"role":"user"')).includes("Keep working")) {
      await waitFor(60_000, signal);
      if (signal?.aborted) throw new DOMException("The turn was stopped.", "AbortError");
    }
    return { text: "Noted." };
  },
};

afterEach(async () => {
  await closeApps();
});

describe("Stop", () => {
  it("stops a running turn that has more than 50 newer turns after it", async () => {
    const lab = await openTestApp({ scripts });
    const { id } = await lab.calls.openSession("session", lab.project!.id);
    // The first turn works on until it is stopped.
    void lab.calls.send(id, "Keep working on the outline.").catch(() => undefined);
    const [first] = await readUntil(
      () => lab.client.sessions.requests(id, { status: "in_progress", limit: 5 }),
      (running) => running.length === 1,
    );
    // 51 short turns land after it and end.
    for (let i = 0; i < 51; i++) await lab.calls.send(id, `Note ${i}.`);
    await readUntil(
      () => lab.client.sessions.requests(id, { limit: 100 }),
      (requests) => requests.filter((r) => r.status !== "in_progress").length >= 51,
      30_000,
    );
    await lab.calls.interrupt(id);
    const ended = await readUntil(
      async () => (await lab.client.sessions.requests(id, { limit: 100 })).find((r) => r.id === first!.id),
      (request) => request?.status !== "in_progress",
    );
    expect(ended?.status).not.toBe("in_progress");
  }, 90_000);
});
