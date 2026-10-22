/**
 * A block's logical id (FIX-2082): its instance id without the attempt, so a
 * retry of the block and the replay after a resume key what the block keeps
 * with its request the same way. One rule for every caller, including an id
 * that doesn't parse: no logical id.
 */
import { describe, expect, it } from "vitest";
import { logicalBlockIdOf } from "../src/block-instance-id";

const at = (blockInstanceId: string) => ({ _blockIdentity: { blockInstanceId } });

describe("logicalBlockIdOf", () => {
  it("drops the attempt, so every attempt of the block has one id", () => {
    expect(logicalBlockIdOf(at("req_1:root/step[0]:0"))).toBe("req_1:root/step[0]");
    expect(logicalBlockIdOf(at("req_1:root/step[0]:3"))).toBe("req_1:root/step[0]");
  });

  it("keeps loop passes apart", () => {
    expect(logicalBlockIdOf(at("req_1:root/loop[0]/iter[1]/step[0]:0"))).not.toBe(
      logicalBlockIdOf(at("req_1:root/loop[0]/iter[2]/step[0]:0"))
    );
  });

  it("takes the runtime's idempotency key when the context carries one", () => {
    expect(logicalBlockIdOf({ idempotencyKey: "req_1:root/x", ...at("req_1:root/y:0") })).toBe("req_1:root/x");
  });

  it("is undefined with no identity, or an id that doesn't parse", () => {
    expect(logicalBlockIdOf({})).toBeUndefined();
    expect(logicalBlockIdOf(at("opaque-legacy-id"))).toBeUndefined();
    expect(logicalBlockIdOf(at("req_1:root:not-an-attempt"))).toBeUndefined();
  });
});
