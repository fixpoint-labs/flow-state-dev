// @vitest-environment happy-dom
/**
 * An approval card draws each extra yes a stop offers (`data.approveOptions`,
 * FIX-2389) as its own button, which sends that option's data with the
 * approve; the plain Approve still sends none. A stop that offers none draws
 * Approve and Reject only.
 *
 * Renders registry source the way `status-tokens.test.tsx` does.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { FlowProvider, SuspensionResolverProvider, type SuspensionResolver } from "@flow-state-dev/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Approval } from "../../registry/components/approval";
import { SessionItemsProvider } from "../../registry/components/session-items-context";

afterEach(cleanup);

const stop = (data?: Record<string, unknown>): SuspensionItem =>
  ({
    id: "item_sus",
    type: "suspension",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    provenance: { blockName: "b", blockInstanceId: "b1", phase: "main" },
    ts: 0,
    suspensionId: "sus_1",
    reason: "user_approval",
    kind: "approval",
    message: "Allow Bash?",
    ...(data === undefined ? {} : { data }),
  }) as SuspensionItem;

function draw(item: SuspensionItem, resolve: SuspensionResolver) {
  return render(
    <FlowProvider flowKind="demo">
      <SuspensionResolverProvider resolve={resolve}>
        <SessionItemsProvider value={[item]}>
          <Approval item={item} />
        </SessionItemsProvider>
      </SuspensionResolverProvider>
    </FlowProvider>,
  );
}

describe("an approval card's extra yeses", () => {
  const offered = stop({ tool: "Bash", approveOptions: [{ label: "Allow for this run", data: { scope: "run" } }] });

  it("sends the option's data with the approve", async () => {
    const resolve = vi.fn(async (_args: unknown) => {});
    draw(offered, resolve);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Allow for this run" }));
    });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", data: { scope: "run" } }));
  });

  it("sends no data with the plain Approve", async () => {
    const resolve = vi.fn(async (_args: unknown) => {});
    draw(offered, resolve);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(resolve.mock.calls[0]![0]).not.toHaveProperty("data");
  });

  it("draws Approve and Reject only for a stop that offers none, and keeps the options out of its details", () => {
    draw(stop({ tool: "Bash" }), vi.fn());
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Approve", "Reject"]);
    cleanup();
    draw(offered, vi.fn());
    expect(screen.queryByText(/approveOptions/)).toBeNull();
  });
});
