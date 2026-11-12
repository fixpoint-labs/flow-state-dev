// @vitest-environment happy-dom
/**
 * Usage by worker keeps its rows tied to the period they were read for: a
 * read for a new period that fails never leaves the last period's totals
 * standing under the new tab.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { useWorkerUsage } from "../src/lib/usage";

/** What each period's read answers: a worker whose input tokens are the period's days, or a failure. */
let answer: (days: number) => Promise<unknown>;

/** A connection whose worker usage view answers `answer` for the period asked. */
const client = {
  userId: "alice",
  view: async (_ref: unknown, input: { days: number }) => ({ value: await answer(input.days), topics: [] }),
} as unknown as Client;

vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

const totals = (days: number) => ({
  workers: [{ worker: "researcher", gone: false, tokens: { input: days, output: 0 }, costUsd: null, bySource: [] }],
});

describe("Usage by worker across a period change", () => {
  it("shows no rows under a period whose read failed, never the last period's", async () => {
    answer = async (days) => totals(days);
    const { result, rerender } = renderHook(({ days }) => useWorkerUsage(0, days), { initialProps: { days: 30 } });
    await waitFor(() => expect(result.current.rows?.[0]?.tokens.input).toBe(30));

    answer = async () => {
      throw new Error("usage read failed");
    };
    rerender({ days: 1 });
    // The 30-day totals are gone the moment Today is picked, before its read settles.
    expect(result.current.rows).toBeUndefined();
    await waitFor(() => expect(result.current.failure).toBeDefined());
    expect(result.current.rows).toBeUndefined();
  });

  it("keeps the last rows beside a failure when the same period is read again", async () => {
    answer = async (days) => totals(days);
    const { result, rerender } = renderHook(({ readAt }) => useWorkerUsage(readAt, 7), { initialProps: { readAt: 0 } });
    await waitFor(() => expect(result.current.rows?.[0]?.tokens.input).toBe(7));

    answer = async () => {
      throw new Error("usage read failed");
    };
    rerender({ readAt: 1 });
    await waitFor(() => expect(result.current.failure).toBeDefined());
    expect(result.current.rows?.[0]?.tokens.input).toBe(7);
  });
});
