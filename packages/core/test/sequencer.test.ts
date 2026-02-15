import { describe, expect, it } from "vitest";
import { handler, sequencer } from "../src";
import { createMockContext } from "./helpers";

function addHandler(name: string, delta = 1) {
  return handler<number, number>({
    name,
    execute: (value) => value + delta
  });
}

describe("sequencer builder", () => {
  it("supports then and connector overload", async () => {
    const one = addHandler("one", 1);
    const two = addHandler("two", 2);
    const chain = sequencer<number>({ name: "then-chain" })
      .then(one)
      .then((value) => value * 2, two);

    const ctx = createMockContext();
    await expect(chain.config.execute?.(1, ctx)).resolves.toBe(6);
  });

  it("supports thenIf", async () => {
    const plusTen = addHandler("plus-ten", 10);
    const seq = sequencer<number>({ name: "then-if" })
      .thenIf((value) => value > 0, plusTen)
      .thenIf((value) => value > 100, (value) => value, plusTen);

    const ctx = createMockContext();
    await expect(seq.config.execute?.(1, ctx)).resolves.toBe(11);
  });

  it("supports map", async () => {
    const seq = sequencer<number>({ name: "map-step" }).map((value) => `v:${value}`);
    const ctx = createMockContext();
    await expect(seq.config.execute?.(3, ctx)).resolves.toBe("v:3");
  });

  it("supports parallel", async () => {
    const seq = sequencer<number>({ name: "parallel-step" }).parallel({
      left: addHandler("left", 1),
      right: {
        connector: (value) => value * 2,
        block: addHandler("right", 3)
      }
    });

    const ctx = createMockContext();
    await expect(seq.config.execute?.(2, ctx)).resolves.toEqual({
      left: 3,
      right: 7
    });
  });

  it("supports forEach and connector overload", async () => {
    const plusTwo = addHandler("plus-two", 2);

    const direct = sequencer<number[]>({ name: "for-each-direct" }).forEach(plusTwo);
    const viaConnector = sequencer<number>({ name: "for-each-connector" }).forEach(
      (value) => [value, value + 1],
      plusTwo
    );

    const ctx = createMockContext();
    await expect(direct.config.execute?.([1, 2], ctx)).resolves.toEqual([3, 4]);
    await expect(viaConnector.config.execute?.(2, ctx)).resolves.toEqual([4, 5]);
  });

  it("supports doUntil and doWhile", async () => {
    const inc = addHandler("inc", 1);
    const untilSeq = sequencer<number>({ name: "until" }).doUntil((value) => value >= 3, inc);
    const whileSeq = sequencer<number>({ name: "while" }).doWhile((value) => value < 3, inc);

    const ctx = createMockContext();
    await expect(untilSeq.config.execute?.(0, ctx)).resolves.toBe(3);
    await expect(whileSeq.config.execute?.(0, ctx)).resolves.toBe(3);
  });

  it("supports loopBack", async () => {
    const inc = addHandler("inc", 1);
    const seq = sequencer<number>({ name: "loop-back" })
      .then(inc)
      .loopBack("inc", {
        when: (value) => (value as number) < 3,
        maxIterations: 5
      });

    const ctx = createMockContext();
    await expect(seq.config.execute?.(0, ctx)).resolves.toBe(3);
  });

  it("supports work and waitForWork", async () => {
    const workBlock = handler<number, number>({
      name: "bg-work",
      execute: async (value) => value + 10
    });

    const seq = sequencer<number>({ name: "work-flow" })
      .work(workBlock)
      .waitForWork({ failOnError: true });

    const ctx = createMockContext();
    await expect(seq.config.execute?.(1, ctx)).resolves.toBe(1);
  });

  it("waitForWork can fail on background errors", async () => {
    const failingWork = handler<number, number>({
      name: "failing-work",
      execute: () => {
        throw new Error("background failure");
      }
    });

    const seq = sequencer<number>({ name: "work-fail" })
      .work(failingWork)
      .waitForWork({ failOnError: true });

    const ctx = createMockContext();
    await expect(seq.config.execute?.(1, ctx)).rejects.toThrow("background failure");
  });

  it("supports tap and tapIf", async () => {
    const tapped: number[] = [];
    const tapBlock = handler<number, number>({
      name: "tap-block",
      execute: (value) => {
        tapped.push(value);
        return value;
      }
    });

    const seq = sequencer<number>({ name: "tap-seq" })
      .tap((value) => {
        tapped.push(value + 1);
      })
      .tap((value) => value * 2, tapBlock)
      .tapIf((value) => value > 0, (value) => {
        tapped.push(value + 2);
      })
      .tapIf((value) => value > 0, (value) => value * 3, tapBlock);

    const ctx = createMockContext();
    await expect(seq.config.execute?.(2, ctx)).resolves.toBe(2);
    expect(tapped).toEqual([3, 4, 4, 6]);
  });

  it("supports rescue", async () => {
    const failing = handler<number, number>({
      name: "failing",
      execute: () => {
        throw new Error("broken");
      }
    });

    const rescueBlock = handler<Error, string>({
      name: "rescue-handler",
      execute: (error) => `recovered:${error.message}`
    });

    const seq = sequencer<number>({ name: "rescue-seq" })
      .then(failing)
      .rescue([{ block: rescueBlock }]);

    const ctx = createMockContext();
    await expect(seq.config.execute?.(1, ctx)).resolves.toBe("recovered:broken");
  });

  it("supports branch and throws when no branch matches", async () => {
    const small = handler<number, string>({
      name: "small",
      execute: () => "small"
    });
    const large = handler<number, string>({
      name: "large",
      execute: () => "large"
    });

    const branching = sequencer<number>({ name: "branching" }).branch({
      small: [(value) => value, (value) => value < 10, small],
      large: [(value) => value, (value) => value >= 10, large]
    });

    const none = sequencer<number>({ name: "branch-none" }).branch({
      never: [(value) => value, () => false, small]
    });

    const ctx = createMockContext();
    await expect(branching.config.execute?.(12, ctx)).resolves.toBe("large");
    await expect(none.config.execute?.(1, ctx)).rejects.toThrow("no matching route");
  });
});
