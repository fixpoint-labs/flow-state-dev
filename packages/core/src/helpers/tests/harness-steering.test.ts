import { describe, expect, it } from "vitest";
import type { HarnessCallbackContext, HarnessSteer } from "../../types/harness";
import { harnessSteering } from "../harness-steering";

/** The context a harness feed or the steer action sees: only the identities are read. */
function ctxOf(session: string, request: string, tenantId?: string): HarnessCallbackContext {
  return {
    session: { identity: { id: session, tenantId } },
    request: { identity: { id: request } },
  } as unknown as HarnessCallbackContext;
}

describe("harnessSteering", () => {
  it("hands a line to the turn running in the calling session, and names that turn", async () => {
    const steering = harnessSteering();
    const handed: string[] = [];
    steering.onSteerable(async (text) => (handed.push(text), "delivered"), ctxOf("s1", "turn-1"));

    const answer = await steering.steer(ctxOf("s1", "steer-1"), "Use v2.");

    expect(answer).toEqual({ live: true, taken: true, turnRequestId: "turn-1" });
    expect(handed).toEqual(["Use v2."]);
  });

  it("answers not taken when the turn refuses, so the sender sends it as the next turn", async () => {
    const steering = harnessSteering();
    steering.onSteerable(async () => "refused", ctxOf("s1", "turn-1"));
    expect(await steering.steer(ctxOf("s1", "steer-1"), "x")).toEqual({ live: true, taken: false, turnRequestId: "turn-1" });
  });

  it("finds no offer in another session, another tenant, or once the turn withdrew it", async () => {
    const steering = harnessSteering();
    const steer: HarnessSteer = async () => "delivered";
    steering.onSteerable(steer, ctxOf("s1", "turn-1", "acme"));

    expect((await steering.steer(ctxOf("s2", "r"), "x")).live).toBe(false);
    expect((await steering.steer(ctxOf("s1", "r", "globex"), "x")).live).toBe(false);
    steering.onSteerable(null, ctxOf("s1", "turn-1", "acme"));
    expect((await steering.steer(ctxOf("s1", "r", "acme"), "x")).live).toBe(false);
  });

  it("keeps tenants apart even when their ids contain the separator a joined key would use", async () => {
    const steering = harnessSteering();
    steering.onSteerable(async () => "delivered", ctxOf("s1", "turn-1", "acme/dev"));
    expect((await steering.steer(ctxOf("dev/s1", "r", "acme"), "x")).live).toBe(false);
    expect((await steering.steer(ctxOf("s1", "r", "acme/dev"), "x")).live).toBe(true);
  });

  it("keeps a later turn's offer when an earlier turn withdraws its own", async () => {
    const steering = harnessSteering();
    steering.onSteerable(async () => "delivered", ctxOf("s1", "turn-1"));
    steering.onSteerable(async () => "delivered", ctxOf("s1", "turn-2"));
    steering.onSteerable(null, ctxOf("s1", "turn-1"));
    expect(await steering.steer(ctxOf("s1", "r"), "x")).toMatchObject({ live: true, turnRequestId: "turn-2" });
  });

  it("declares its action beside a running turn and never as the session's auto-resume target", () => {
    expect(harnessSteering().action()).toMatchObject({ concurrency: "allow", autoResume: false });
  });
});
