// @vitest-environment happy-dom
/**
 * A failed turn reads as a failure, with its reason and a working Retry.
 *
 * Without it a crash looks the same as a short answer: the working indicator
 * goes away and nothing says why. Each case is built from an ErrorItem shaped
 * the way the engine writes one for a failed request, so the line shows what
 * the server actually said.
 *
 * Renders registry source, which imports shadcn primitives through `@/`; the
 * vitest config aliases those to Storybook's stubs, the way Storybook builds.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorItem } from "@flow-state-dev/core/items";
import { ErrorDisplay } from "../../registry/components/error";
import { INTERRUPTED_REASON, RequestRecovery } from "../../registry/components/request-recovery";

afterEach(cleanup);

/** What `runAction`'s failure path writes: a failed `error` item carrying the normalized message and code. */
const failed: ErrorItem = {
  id: "item_error_1",
  type: "error",
  status: "failed",
  requestId: "req_1",
  itemIndex: 3,
  ts: 1,
  message: "AI_GATEWAY_API_KEY is not set",
  code: "provider_auth",
} as ErrorItem;

/** A promise the test settles by hand, so the in-between state can be seen. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const retryButton = () => screen.getByRole("button", { name: /retry/i }) as HTMLButtonElement;

describe("a failed turn's line", () => {
  it("names who hit it and says why, in the server's words", () => {
    render(<RequestRecovery reason={failed.message} code={failed.code} who="researcher" />);
    const line = screen.getByRole("alert");
    expect(line.textContent).toContain("researcher");
    expect(line.textContent).toContain("AI_GATEWAY_API_KEY is not set");
    expect(line.textContent).toContain("provider_auth");
  });

  it("reads the same as the item stream's error, from one body", () => {
    const { container: recovery } = render(<RequestRecovery reason={failed.message} code={failed.code} />);
    const recoveryText = recovery.textContent;
    cleanup();
    const { container: display } = render(<ErrorDisplay item={failed} />);
    expect(recoveryText).toBe(display.textContent);
  });

  it.each([
    ["a string output", { output: "401 Unauthorized: missing key" }],
    ["structured details", { httpStatus: 401, errorType: "auth" }],
  ])("draws %s the same as the item stream's error", (_label, details) => {
    const item = { ...failed, details } as ErrorItem;
    const { container: recovery } = render(<RequestRecovery reason={item.message} code={item.code} details={item.details} />);
    const recoveryText = recovery.textContent;
    expect(recoveryText).toContain("Details");
    cleanup();
    const { container: display } = render(<ErrorDisplay item={item} />);
    expect(recoveryText).toBe(display.textContent);
  });

  it("offers no Retry for a request the server won't retry", () => {
    render(<RequestRecovery reason={failed.message} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("starts the request again once, busy until the retry lands", async () => {
    const retry = deferred();
    const onRetry = vi.fn(() => retry.promise);
    render(<RequestRecovery reason={failed.message} onRetry={onRetry} />);

    fireEvent.click(retryButton());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(retryButton().textContent).toContain("Retrying…");
    expect(retryButton().disabled).toBe(true);

    fireEvent.click(retryButton());
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => retry.resolve());
    expect(retryButton().disabled).toBe(false);
    expect(retryButton().textContent).toContain("Retry");
  });

  it("says when the retry itself is refused, and offers Retry again", async () => {
    const retry = deferred();
    render(<RequestRecovery reason={failed.message} onRetry={() => retry.promise} />);

    fireEvent.click(retryButton());
    await act(async () => retry.reject(new Error("409: request is still running")));

    expect(screen.getByRole("alert").textContent).toContain("Retry failed: 409: request is still running");
    expect(retryButton().disabled).toBe(false);
  });
});

/**
 * A turn a restart cut off: the request is `interrupted`, nothing failed, and
 * the work so far is in the durable log. Continue carries the same request on;
 * Discard ends it. Without this line the user's message sits with no reply and
 * no way to resume it.
 */
describe("a turn a restart cut off", () => {
  const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

  it("reads as cut off, not as a failure, with Continue and Discard and no Retry", () => {
    render(<RequestRecovery who="researcher" onContinue={async () => {}} onDiscard={async () => {}} onRetry={async () => {}} />);
    const line = screen.getByRole("alert");
    expect(line.dataset.state).toBe("interrupted");
    expect(line.textContent).toContain(INTERRUPTED_REASON);
    expect(line.textContent).toContain("researcher's turn was cut off");
    expect(line.textContent).not.toContain("couldn't finish");
    expect(line.className).toContain("bg-attention");
    expect(line.className).not.toContain("destructive");
    expect(button(/continue/i)).toBeTruthy();
    expect(button(/discard/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("draws only the buttons the app passes", () => {
    render(<RequestRecovery onDiscard={async () => {}} />);
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(button(/discard/i)).toBeTruthy();
  });

  it("continues once, and holds both buttons until it lands", async () => {
    const going = deferred();
    const onContinue = vi.fn(() => going.promise);
    const onDiscard = vi.fn(async () => {});
    render(<RequestRecovery onContinue={onContinue} onDiscard={onDiscard} />);

    fireEvent.click(button(/continue/i));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(button(/continuing/i).disabled).toBe(true);
    expect(button(/discard/i).disabled).toBe(true);
    fireEvent.click(button(/discard/i));
    expect(onDiscard).not.toHaveBeenCalled();

    await act(async () => going.resolve());
    expect(button(/continue/i).disabled).toBe(false);
  });

  it("discards once, busy until it lands", async () => {
    const ending = deferred();
    const onDiscard = vi.fn(() => ending.promise);
    render(<RequestRecovery onContinue={async () => {}} onDiscard={onDiscard} />);

    fireEvent.click(button(/discard/i));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(button(/discarding/i).disabled).toBe(true);
    await act(async () => ending.resolve());
    expect(button(/discard/i).disabled).toBe(false);
  });

  it("says when Continue is refused, and offers it again", async () => {
    const going = deferred();
    render(<RequestRecovery onContinue={() => going.promise} />);

    fireEvent.click(button(/continue/i));
    await act(async () => going.reject(new Error("409: only interrupted requests continue")));

    expect(screen.getByRole("alert").textContent).toContain("Continue failed: 409: only interrupted requests continue");
    expect(button(/continue/i).disabled).toBe(false);
  });
});

/** A failed line needs its reason; an interrupted one takes no error code. Checked by `tsc`, not run. */
function typeContract() {
  // @ts-expect-error a failed turn without its reason would draw an empty body
  void (<RequestRecovery code="E_MODEL" />);
  // @ts-expect-error an interrupted line takes no error code: it is not a failure
  void (<RequestRecovery code="E_MODEL" onDiscard={async () => {}} />);
}
void typeContract;
