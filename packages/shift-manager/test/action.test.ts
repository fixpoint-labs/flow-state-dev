/**
 * `runAction` reads the action's answer by its request id (FIX-2455): one
 * read of the request, never the session's listing, so a session longer than
 * a page can't push the answer out of reach. A refusal rejects with the
 * Lab's own words; an answer the record could not store is unread, never a
 * yes. Through the real client over a recording fetcher, so the assertion is
 * on what left Shift Manager.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { ActionAnswerUnread, ActionRefused, runAction } from "../src/lib/action";

/** A Lab whose `act` request ends with `ended` (a status plus its stored result). */
function lab(ended: { status: string; result?: Record<string, unknown> }) {
  const urls: string[] = [];
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    const url = String(input);
    urls.push(`${init?.method ?? "GET"} ${url}`);
    const body = url.includes("/actions/act")
      ? { status: "in_progress", request: { id: "req_act", flowKind: "desk", actionName: "act", status: "in_progress" } }
      : url.includes("/requests/req_act/status")
        ? {
            id: "req_act",
            status: ended.status,
            startedAtMs: 1,
            ageMs: 1,
            ...(url.includes("include_result_output=true") && ended.result !== undefined ? { result: ended.result } : {}),
          }
        : { requests: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { urls, client: createClient({ userId: "u1", baseUrl: "", fetcher }) };
}

const listsRequests = (url: string) => /\/sessions\/[^/?]+\/requests(\?|$)/.test(url);

describe("runAction", () => {
  it("returns what the action answered, read by request id", async () => {
    const { urls, client } = lab({ status: "completed", result: { output: { delegates: ["eng.coder"] }, hasOutput: true } });
    await expect(runAction(client, "desk", "s_desk", "act", {})).resolves.toEqual({ output: { delegates: ["eng.coder"] }, sessionId: "s_desk" });
    expect(urls.filter(listsRequests)).toEqual([]);
  });

  it("rejects a failed request as refused, in the Lab's own words", async () => {
    const { urls, client } = lab({ status: "failed", result: { error: { code: "refused", message: "That workstream is closed." }, hasOutput: false } });
    const error = await runAction(client, "desk", "s_desk", "act", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActionRefused);
    expect((error as Error).message).toBe("That workstream is closed.");
    expect(urls.filter(listsRequests)).toEqual([]);
  });

  it("calls an answer the record could not store unread, not an empty yes", async () => {
    const { client } = lab({ status: "completed", result: { outputNotRecorded: true, hasOutput: false } });
    await expect(runAction(client, "desk", "s_desk", "act", {})).rejects.toBeInstanceOf(ActionAnswerUnread);
  });
});
