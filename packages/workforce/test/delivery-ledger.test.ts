/**
 * The delivery ledger, on its own: one record per (post, round, delegate
 * record), dispatched again only while pending, and each answer claimed once.
 *
 * Checks (`specs/issues/FIX-1791/BUSINESS-RULES.md`): BR-21 (a replayed opening
 * reuses the record and its token; a second answer claims nothing), BR-22 (an
 * unknown token is refused), BR-5 (a worker with two targets is two records),
 * BR-24b (a delivery with no answer is marked missed once, and its late answer
 * still lands once), and the bound on how many posts it keeps.
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERY_LEDGER_POSTS,
  claimAnswer,
  deliveryEnded,
  markMissed,
  openDelivery,
  settleDelivery,
  type DeliveryLedger
} from "../src/delivery-ledger";

const opening = { postId: "p1", round: 0, delegate: { worker: "eng.em" } };

describe("the delivery ledger", () => {
  it("reuses a replayed opening's record and token, dispatching again only while it is pending (BR-21)", () => {
    const first = openDelivery([], opening, "t1");
    expect(first.deliver).toBe(true);
    const replayed = openDelivery(first.ledger, opening, "t2");
    expect(replayed).toMatchObject({ deliver: true, delivery: { token: "t1" } });
    expect(replayed.ledger).toHaveLength(1);

    const delivered = settleDelivery(first.ledger, "t1", { delivered: "s1" });
    expect(openDelivery(delivered, opening, "t3")).toMatchObject({ deliver: false, delivery: { status: "delivered" } });
    const failed = settleDelivery(first.ledger, "t1", { failed: "refused" });
    expect(openDelivery(failed, opening, "t3").deliver).toBe(false);
  });

  it("keeps a delivery per round and per delegate record (BR-5)", () => {
    let ledger: DeliveryLedger = [];
    for (const delegate of [{ worker: "lead", target: "a" }, { worker: "lead", target: "b" }, { worker: "lead" }]) {
      ledger = openDelivery(ledger, { postId: "p1", round: 0, delegate }, `t-${delegate.target ?? "none"}`).ledger;
    }
    ledger = openDelivery(ledger, { postId: "p1", round: 1, delegate: { worker: "lead" } }, "t-r1").ledger;
    expect(ledger.map((record) => record.token)).toEqual(["t-a", "t-b", "t-none", "t-r1"]);
  });

  it("claims an answer once, and refuses a token it never minted (BR-21, BR-22)", () => {
    const { ledger } = openDelivery([], opening, "t1");
    const claimed = claimAnswer(ledger, "t1");
    expect(claimed).toMatchObject({ claimed: true, delivery: { answered: true, postId: "p1", round: 0 } });
    const again = claimAnswer((claimed as { ledger: DeliveryLedger }).ledger, "t1");
    expect(again).toMatchObject({ claimed: false, reason: "answered" });
    expect(claimAnswer(ledger, "forged")).toEqual({ claimed: false, reason: "unknown-token" });
  });

  it("marks a delivery missed once, still takes its late answer once, and ends a delivery three ways (BR-24b)", () => {
    const { ledger } = openDelivery([], opening, "t1");
    const delivered = settleDelivery(ledger, "t1", { delivered: "s1" });
    expect(deliveryEnded(delivered[0]!)).toBe(false);

    const missed = markMissed(delivered, "t1", "its turn failed");
    expect(missed).toMatchObject({ marked: true, delivery: { missed: "its turn failed", answered: false } });
    const missedLedger = (missed as { ledger: DeliveryLedger }).ledger;
    expect(deliveryEnded(missedLedger[0]!)).toBe(true);
    expect(markMissed(missedLedger, "t1", "again")).toMatchObject({ marked: false, reason: "missed" });
    // A late answer still lands, once.
    expect(claimAnswer(missedLedger, "t1")).toMatchObject({ claimed: true, delivery: { answered: true } });

    const answered = (claimAnswer(delivered, "t1") as { ledger: DeliveryLedger }).ledger;
    expect(deliveryEnded(answered[0]!)).toBe(true);
    expect(markMissed(answered, "t1", "late")).toMatchObject({ marked: false, reason: "answered" });
    expect(deliveryEnded(settleDelivery(ledger, "t1", { failed: "refused" })[0]!)).toBe(true);
    expect(markMissed(ledger, "forged", "x")).toEqual({ marked: false, reason: "unknown-token" });
  });

  it(`keeps the last ${DELIVERY_LEDGER_POSTS} posts' deliveries`, () => {
    let ledger: DeliveryLedger = [];
    for (let n = 0; n <= DELIVERY_LEDGER_POSTS; n += 1) {
      ledger = openDelivery(ledger, { ...opening, postId: `p${n}` }, `t${n}`).ledger;
    }
    expect(ledger).toHaveLength(DELIVERY_LEDGER_POSTS);
    expect(ledger[0]!.postId).toBe("p1");
    expect(claimAnswer(ledger, "t0")).toEqual({ claimed: false, reason: "unknown-token" });
  });
});
