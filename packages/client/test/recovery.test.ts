import { describe, expect, it, vi } from "vitest";
import { createRecoveryClient, type ClientFetch } from "../src";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("createRecoveryClient", () => {
  describe("checkInterrupted", () => {
    it("posts to the user-scoped sweep endpoint and unwraps the payload", async () => {
      const fetcher = vi.fn<ClientFetch>(async () =>
        createJsonResponse({
          interrupted: [
            {
              requestId: "req_1",
              sessionId: "sess_1",
              flowKind: "chat",
              actionName: "run",
              interruptedAt: 100
            }
          ]
        })
      );

      const client = createRecoveryClient({ fetcher });
      const result = await client.checkInterrupted({ userId: "alice" });

      expect(result).toHaveLength(1);
      expect(result[0]?.requestId).toBe("req_1");
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        "/api/flows/users/alice/check-interrupted"
      );
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    });

    it("forwards staleThresholdMs as a query param", async () => {
      const fetcher = vi.fn<ClientFetch>(async () =>
        createJsonResponse({ interrupted: [] })
      );
      const client = createRecoveryClient({ fetcher });
      await client.checkInterrupted({ userId: "alice", staleThresholdMs: 5000 });
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        "/api/flows/users/alice/check-interrupted?staleThresholdMs=5000"
      );
    });

    it("rejects empty userId before hitting the network", async () => {
      const fetcher = vi.fn<ClientFetch>();
      const client = createRecoveryClient({ fetcher });
      await expect(
        client.checkInterrupted({ userId: "  " })
      ).rejects.toThrow(/non-empty userId/);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("retry", () => {
    it("posts to the canonical retry path and returns the new request id", async () => {
      const fetcher = vi.fn<ClientFetch>(async () =>
        createJsonResponse(
          {
            status: "in_progress",
            request: {
              id: "req_2",
              flowKind: "chat",
              actionName: "run",
              status: "in_progress",
              retryOf: "req_1"
            },
            session: { id: "sess_1" }
          },
          202
        )
      );

      const client = createRecoveryClient({ fetcher });
      const result = await client.retry({
        flowKind: "chat",
        sessionId: "sess_1",
        requestId: "req_1"
      });

      expect(result.newRequestId).toBe("req_2");
      expect(result.retryOf).toBe("req_1");
      expect(result.sessionId).toBe("sess_1");
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        "/api/flows/chat/sessions/sess_1/requests/req_1/retry"
      );
      expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
      // No body when no inputOverride is provided.
      expect(fetcher.mock.calls[0]?.[1]?.body).toBeUndefined();
    });

    it("serializes inputOverride into the request body", async () => {
      const fetcher = vi.fn<ClientFetch>(async () =>
        createJsonResponse(
          {
            status: "in_progress",
            request: {
              id: "req_2",
              flowKind: "chat",
              actionName: "run",
              status: "in_progress",
              retryOf: "req_1"
            }
          },
          202
        )
      );

      const client = createRecoveryClient({ fetcher });
      await client.retry({
        flowKind: "chat",
        sessionId: "sess_1",
        requestId: "req_1",
        inputOverride: { message: "try again" }
      });

      expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ inputOverride: { message: "try again" } })
      );
    });

    it("rejects empty path components before hitting the network", async () => {
      const fetcher = vi.fn<ClientFetch>();
      const client = createRecoveryClient({ fetcher });
      await expect(
        client.retry({ flowKind: "", sessionId: "sess_1", requestId: "req_1" })
      ).rejects.toThrow(/flowKind/);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
