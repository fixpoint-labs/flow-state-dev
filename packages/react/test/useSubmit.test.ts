// @vitest-environment happy-dom
/**
 * A call that changes something holds its controls while it runs and keeps its
 * refusal to show. Without the hold a double click sends twice; without the
 * kept refusal a failed call looks like it worked, which is why it never throws.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSubmit } from "../src";

afterEach(cleanup);

/** A call the test settles. */
function held() {
  let finish!: (failure?: unknown) => void;
  const args: unknown[][] = [];
  const run = (...given: unknown[]) => {
    args.push(given);
    return new Promise<void>((resolve, reject) => {
      finish = (failure) => (failure === undefined ? resolve() : reject(failure));
    });
  };
  return { run, args, settle: (failure?: unknown) => act(async () => finish(failure)) };
}

describe("useSubmit", () => {
  it("is busy while the action runs, and passes its arguments through", async () => {
    const call = held();
    const { result } = renderHook(() => useSubmit(call.run));
    expect(result.current.busy).toBe(false);
    let done!: Promise<void>;
    act(() => {
      done = result.current.submit(undefined, "task-1", true);
    });
    expect(result.current.busy).toBe(true);
    expect(call.args).toEqual([["task-1", true]]);
    await call.settle();
    await done;
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("runs the action once when called twice before it settles, even before a re-render", async () => {
    const call = held();
    const { result } = renderHook(() => useSubmit(call.run));
    act(() => {
      const { submit } = result.current;
      void submit(undefined, "first");
      void submit(undefined, "second");
    });
    expect(call.args).toEqual([["first"]]);
    await call.settle();
    act(() => {
      void result.current.submit(undefined, "after");
    });
    expect(call.args).toEqual([["first"], ["after"]]);
    await call.settle();
  });

  it("keeps a refusal's message instead of throwing, and clears it when run again", async () => {
    const call = held();
    const { result } = renderHook(() => useSubmit(call.run));
    let done!: Promise<void>;
    act(() => {
      done = result.current.submit(undefined);
    });
    await call.settle(new Error("network down"));
    await expect(done).resolves.toBeUndefined();
    expect(result.current.error).toBe("network down");
    expect(result.current.busy).toBe(false);

    act(() => {
      void result.current.submit(undefined);
    });
    expect(result.current.error).toBeUndefined();
    await call.settle("refused");
    expect(result.current.error).toBe("refused");
  });

  it("prevents a form's default submit", async () => {
    const { result } = renderHook(() => useSubmit(async () => {}));
    let prevented = false;
    const event = { preventDefault: () => (prevented = true) } as unknown as Parameters<typeof result.current.submit>[0];
    await act(() => result.current.submit(event));
    expect(prevented).toBe(true);
  });
});
