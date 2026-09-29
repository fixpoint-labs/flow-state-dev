/**
 * A cross-flow dispatch admits its target exactly as ingress would,
 * organization included.
 *
 * One flow can start work on another: a `dispatcher()` block in the sender
 * names the recipient flow and entry, and the recipient's entry runs in a
 * child session of its own. That hand-off happens inside the server, so it
 * never passes the HTTP door the recipient's own callers pass. What the
 * recipient's entry sees must still be what the door would have let in: a
 * verified user and a verified organization.
 *
 * So the case asks from outside, twice. An app whose resolver verifies the
 * user but names no organization is refused at the sender's door, and the
 * recipient never runs. An app whose resolver names one gets the recipient
 * run under that organization, the sender's own.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { ORG_ID, startTwoUserServer, waitFor, type TwoUserServer } from "./harness";

const orderInput = z.object({ orderId: z.string() });

/** What the recipient's entry saw each time it ran. */
type Arrival = { orderId: string; userId: string | undefined; orgId: string | undefined };

/** A sender whose public action hands the order to billing's internal entry. */
function shippingFlow() {
  return defineFlow({
    kind: "shipping",
    actions: {
      notify: {
        block: dispatcher({
          name: "notify-billing",
          type: "internal",
          flowKind: "billing",
          action: "charge",
          inputSchema: orderInput,
          session: { key: (input) => input.orderId }
        })
      }
    }
  })();
}

/** The recipient: an internal entry no HTTP caller can reach directly. */
function billingFlow(arrivals: Arrival[]) {
  return defineFlow({
    kind: "billing",
    actions: {},
    internal: {
      actions: {
        charge: {
          block: handler({
            name: "charge-order",
            inputSchema: orderInput,
            outputSchema: orderInput,
            execute: async (input, ctx) => {
              arrivals.push({
                orderId: input.orderId,
                userId: ctx.session.identity.userId,
                orgId: ctx.session.identity.orgId
              });
              return input;
            }
          })
        }
      }
    }
  })();
}

/** POST shipping's `notify` as `userId`; returns the response status. */
async function notify(server: TwoUserServer, userId: string, orderId: string): Promise<number> {
  const response = await server.as(userId)(`/shipping/s_${orderId}/actions/notify`, {
    method: "POST",
    body: JSON.stringify({ input: { orderId } })
  });
  return response.status;
}

describe("a cross-flow dispatch", () => {
  let server: TwoUserServer;
  let arrivals: Arrival[];

  afterEach(async () => {
    await server.close();
  });

  describe("from an app whose resolver names no organization", () => {
    beforeEach(async () => {
      arrivals = [];
      server = await startTwoUserServer([shippingFlow(), billingFlow(arrivals)], { orgId: null });
    });

    it("never runs the recipient: the door refuses the caller first", async () => {
      // The resolver verified alice and named no organization.
      expect(await notify(server, "alice", "o_orgless")).toBe(401);

      // The door answers 401 while resolving the caller, before anything is
      // dispatched, so once the refusal is back nothing can have started.
      expect(arrivals).toEqual([]);
    });
  });

  describe("from an app whose resolver names one", () => {
    beforeEach(async () => {
      arrivals = [];
      server = await startTwoUserServer([shippingFlow(), billingFlow(arrivals)]);
    });

    it("runs the recipient under the sender's verified organization", async () => {
      expect(await notify(server, "alice", "o_1")).toBe(202);

      const arrival = await waitFor(
        async () => arrivals.find((a) => a.orderId === "o_1"),
        "billing's charge entry to run"
      );
      expect(arrival).toEqual({ orderId: "o_1", userId: "alice", orgId: ORG_ID });
    });
  });
});
