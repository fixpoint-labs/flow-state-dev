/**
 * `request.result()`: what an action answered, by the request's id (FIX-2455).
 *
 * It is `wait()` plus one read of the status route with
 * `include_result_output=true`, so it never lists the session's requests and a
 * long session changes nothing. It resolves for every way a request settles
 * and says which (D2): a failure or a stop for a person is a status, not a
 * rejection. `wait` and `result` take an `AbortSignal`; stopping the wait
 * never stops the run.
 */
import { describe, expect, it, vi } from "vitest";
import { createClient, type ClientFetch } from "../src";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A status route that answers each read from `reads` in turn, then repeats the last. */
function statusRoute(reads: Array<Record<string, unknown>>) {
  const urls: string[] = [];
  const fetcher = vi.fn<ClientFetch>(async (input, init) => {
    const url = String(input);
    urls.push(`${init?.method ?? "GET"} ${url}`);
    if (!url.includes("/status")) throw new Error(`unrouted ${url}`);
    const withResult = new URL(url, "http://x").searchParams.get("include_result_output") === "true";
    const read = reads.length > 1 ? reads.shift()! : reads[0]!;
    // The server sends `result` only when asked, as the status route does.
    const { result, ...snapshot } = read;
    return json(withResult && result !== undefined ? { ...snapshot, result } : snapshot);
  });
  return { fetcher, urls };
}

const handleFor = (fetcher: ClientFetch) => createClient({ userId: "u1", baseUrl: "", fetcher }).flow("demo").request("req_1");

describe("request.result()", () => {
  it("waits for the request to settle, then reads its output by id", async () => {
    const { fetcher, urls } = statusRoute([
      { id: "req_1", status: "in_progress", startedAtMs: 1, ageMs: 0, lastHeartbeatAt: 1 },
      { id: "req_1", status: "completed", startedAtMs: 1, ageMs: 2, result: { output: { squared: 49 }, hasOutput: true } }
    ]);

    const settled = await handleFor(fetcher).result({ pollMs: 1 });

    expect(settled).toEqual({ status: "completed", output: { squared: 49 } });
    // Each read asks for the result, so the read that settles it is the one returned; a running
    // request has none, so the poll before it is the plain snapshot.
    expect(urls).toEqual([
      "GET /api/flows/demo/requests/req_1/status?include_result_output=true",
      "GET /api/flows/demo/requests/req_1/status?include_result_output=true"
    ]);
    expect(urls.some((url) => /\/sessions\//.test(url))).toBe(false);
  });

  it("resolves a failure with its error, and a stop for a person as suspended, rather than rejecting", async () => {
    const failure = { code: "goal_refused", message: "refused on purpose" };
    const failed = statusRoute([
      { id: "req_1", status: "failed", startedAtMs: 1, ageMs: 1, result: { error: failure, hasOutput: false } }
    ]);
    await expect(handleFor(failed.fetcher).result()).resolves.toEqual({ status: "failed", error: failure });

    const suspended = statusRoute([{ id: "req_1", status: "suspended", startedAtMs: 1, ageMs: 1 }]);
    await expect(handleFor(suspended.fetcher).result()).resolves.toEqual({ status: "suspended" });
  });

  it("keeps an output it could not record distinct from an action that returned nothing", async () => {
    const lossy = statusRoute([
      { id: "req_1", status: "completed", startedAtMs: 1, ageMs: 1, result: { outputNotRecorded: true, hasOutput: false } }
    ]);
    await expect(handleFor(lossy.fetcher).result()).resolves.toEqual({ status: "completed", outputNotRecorded: true });

    const nothing = statusRoute([{ id: "req_1", status: "completed", startedAtMs: 1, ageMs: 1, result: { hasOutput: false } }]);
    await expect(handleFor(nothing.fetcher).result()).resolves.toEqual({ status: "completed" });
  });

  it("returns the settled snapshot it read, even when the request runs again right after", async () => {
    // Settled, then continued and live again, then settled once more. The read that
    // satisfied the settle rule must be the one returned: never a running request.
    const { fetcher } = statusRoute([
      { id: "req_1", status: "completed", startedAtMs: 1, ageMs: 1, result: { output: { round: 1 }, hasOutput: true } },
      { id: "req_1", status: "in_progress", startedAtMs: 1, ageMs: 2, lastHeartbeatAt: 2 },
      { id: "req_1", status: "completed", startedAtMs: 1, ageMs: 3, result: { output: { round: 2 }, hasOutput: true } }
    ]);

    await expect(handleFor(fetcher).result({ pollMs: 1 })).resolves.toEqual({ status: "completed", output: { round: 1 } });
  });

  it("rejects past its timeout, as wait does", async () => {
    const { fetcher } = statusRoute([{ id: "req_1", status: "in_progress", startedAtMs: 1, ageMs: 0 }]);
    await expect(handleFor(fetcher).result({ pollMs: 1, timeoutMs: 5 })).rejects.toMatchObject({ status: 0 });
  });
});

describe("wait and result take a signal", () => {
  it("stops waiting when the signal aborts, and never asks the server to stop the run", async () => {
    const { fetcher, urls } = statusRoute([{ id: "req_1", status: "in_progress", startedAtMs: 1, ageMs: 0 }]);
    const controller = new AbortController();
    const request = handleFor(fetcher);

    const waiting = request.wait({ pollMs: 1_000, signal: controller.signal });
    const resulting = request.result({ pollMs: 1_000, signal: controller.signal });
    await vi.waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(2));
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await expect(resulting).rejects.toMatchObject({ name: "AbortError" });
    expect(urls.some((url) => url.includes("/abort"))).toBe(false);
  });

  it("does not read at all under a signal that has already aborted", async () => {
    const { fetcher, urls } = statusRoute([{ id: "req_1", status: "completed", startedAtMs: 1, ageMs: 0 }]);
    const controller = new AbortController();
    controller.abort();

    await expect(handleFor(fetcher).wait({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(urls).toEqual([]);
  });
});
