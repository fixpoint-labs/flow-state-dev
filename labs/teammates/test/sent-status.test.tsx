// @vitest-environment happy-dom
/**
 * A sent line's status ("working", "replied", "no answer") is read from the
 * worker messages view, which answers for at most the 50 newest lines on
 * screen. A line older than those has no answer read for it, so it shows no
 * status rather than a wrong "working" for a message that was answered long ago.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import type { WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import { linesOf, sent } from "./lines";
import { Conversation } from "../src/components/Conversation";
import { lookOf } from "../src/lib/looks";
import { rosterEntry } from "./scripted-server";
import { standInFollower, TestProvider } from "./stub-server";

afterEach(cleanup);

const LEAD = "lead";
const message = (id: string, fields: Partial<WorkerMessageResourceState> = {}): WorkerMessageResourceState => ({
  id, from: LEAD, to: "researcher", text: id, exchange: id, fromSession: "s1", fromFlow: "agent", toSession: "s2", toFlow: "agent", hop: 1, status: "delivered", at: 1, ...fields,
});

describe("a sent line's status", () => {
  it("shows today's status for the 50 newest lines, and none for an older one, even one that was answered", async () => {
    // 51 lines Lead sent; every one asked for and got a reply.
    const ids = Array.from({ length: 51 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const log = ids.flatMap((id) => [message(id, { replyRequested: true, answeredBy: `r_${id}` }), message(`r_${id}`, { from: "researcher", to: LEAD, inReplyTo: id })]);
    const lines = linesOf(ids.map((id) => sent(`e_${id}`, "q1", { messageId: id, to: "researcher", text: id })));
    const asked: string[][] = [];
    // The worker messages view as the server answers it: each asked id's row and its answer, nothing else (none are open).
    const client = {
      view: async (_ref: unknown, input: { ids?: string[] }) => {
        asked.push(input.ids ?? []);
        const wanted = new Set(input.ids ?? []);
        return { value: log.filter((m) => wanted.has(m.id) || (m.inReplyTo !== undefined && wanted.has(m.inReplyTo))), topics: [] };
      },
      subscribe: () => ({ close: () => {} }),
    } as unknown as Client;
    const { Follower } = standInFollower("s1", { lines, running: false, stopping: false, backgroundRunning: 0 });
    const view = render(
      <TestProvider client={client}>
        <Follower />
        <Conversation worker={rosterEntry({ id: LEAD, name: "Lead" })} sessionId="s1" nameOf={(id) => id} lookOf={(id) => lookOf({ id, name: id })} isCoding={() => false} harnessOf={() => undefined} onFire={async () => {}} onOpen={() => {}} />
      </TestProvider>,
    );
    const statusOf = (id: string) => [...view.container.querySelectorAll("[data-sent-status]")].find((s) => s.closest("button")?.getAttribute("aria-label")?.endsWith(`: ${id}`))?.textContent;
    await waitFor(() => expect(statusOf("m50")).toBe("replied"));
    expect(asked.at(-1)).toHaveLength(50);
    expect(statusOf("m01")).toBe("replied");
    // The oldest line is outside the 50 asked for: no status, never "working".
    expect(statusOf("m00")).toBe("");
  });
});
