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
import { RequestRecovery } from "../../registry/components/request-recovery";

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
