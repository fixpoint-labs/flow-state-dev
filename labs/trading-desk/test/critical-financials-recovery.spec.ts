/**
 * Tests for the single-flight critical-financials recovery runtime (FIX-898).
 *
 * The network providers (CIK resolution, registration discovery, prospectus
 * fetch) and the bounded LLM extractor are mocked; the deterministic extractor
 * and the validator run for real. Intent encoded:
 *   1. A validated prospectus promotes into USD-billions statements tagged
 *      `edgar-prospectus`, and the audit records `promoted` with provenance.
 *   2. Parallel callers share ONE recovery attempt (single-flight).
 *   3. No candidates → honest `no-candidates`; a poisoned candidate → `rejected`
 *      with reasons; both keep statements null (no zero-fill).
 *   4. On a deterministic miss, the ONE bounded LLM extract can still promote.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spcxHtml = readFileSync(
  path.join(__dirname, "__fixtures__", "spcx-prospectus.html"),
  "utf8",
);

// Controllable provider + LLM stubs (hoisted so the vi.mock factories see them).
const stubs = vi.hoisted(() => ({
  resolveCik: vi.fn(async (_t: string) => "0001750000"),
  fetchCandidates: vi.fn(),
  fetchHtml: vi.fn(async (_url: string) => ""),
  llmExtract: vi.fn(),
}));

vi.mock("../lib/providers/edgar", () => ({ resolveCik: stubs.resolveCik }));
vi.mock("../lib/providers/edgar-registration", () => ({
  fetchRegistrationCandidates: stubs.fetchCandidates,
  fetchProspectusPrimaryHtml: stubs.fetchHtml,
}));
vi.mock("../flows/analysis/tools/runtime/recover-financials-extract", () => ({
  recoverFinancialsExtract: stubs.llmExtract,
}));

import {
  recoverCriticalFinancials,
  clearRecoveryForSession,
  _resetRecoveryInflight,
  _recoveryCacheSizes,
  _MAX_RECOVERY_CACHE_ENTRIES,
} from "../flows/analysis/tools/runtime/critical-financials-recovery";
import type { FinancialCandidate } from "../flows/analysis/lib/financial-candidate";

const candidate424 = {
  form: "424B4",
  filingDate: "2026-02-10",
  accessionNumber: "000000000026000004",
  primaryDocument: "424b4.htm",
  url: "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
  cik: 1750000,
  companyName: "SpaceCo Exploration Inc.",
};

function makeCtx() {
  const audits: Array<Record<string, unknown>> = [];
  const ctx = {
    session: { identity: { id: "sess-1" }, state: { costPreset: "fast" } },
    resolveModel: () => ({ generate: async () => ({ structuredOutput: null }) }),
    resources: {
      financialsData: {
        patchState: async (u: { recoveryAudit: Record<string, unknown> }) => {
          audits.push(u.recoveryAudit);
        },
      },
    },
  };
  return { ctx, audits };
}

beforeEach(() => {
  _resetRecoveryInflight();
  stubs.resolveCik.mockResolvedValue("0001750000");
  stubs.fetchCandidates.mockReset();
  stubs.fetchHtml.mockReset();
  stubs.llmExtract.mockReset();
  stubs.llmExtract.mockResolvedValue(null);
});

describe("recoverCriticalFinancials", () => {
  it("promotes a validated prospectus into USD-billions statements + a promoted audit", async () => {
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(spcxHtml);
    const { ctx, audits } = makeCtx();

    const result = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });

    expect(result.statements).not.toBeNull();
    expect(result.statements!.incomeStatement.source).toBe("edgar-prospectus");
    expect(result.statements!.incomeStatement.revenue).toBeCloseTo(8.5, 6);
    expect(result.statements!.cashflow.freeCashFlow).toBeCloseTo(-1.5, 6);
    expect(result.statements!.balanceSheet.cashAndEquivalents).toBeCloseTo(4.0, 6);
    expect(result.audit.outcome).toBe("promoted");
    expect(result.audit.recoveredSource).toBe("edgar-prospectus");
    expect(result.audit.formsTried).toContain("424B4");
    // The runtime is the sole audit writer — exactly one patch.
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("promoted");
    // The deterministic tier succeeded → the model was never consulted.
    expect(stubs.llmExtract).not.toHaveBeenCalled();
  });

  it("shares ONE attempt across parallel callers (single-flight)", async () => {
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(spcxHtml);
    const { ctx } = makeCtx();

    const [a, b, c] = await Promise.all([
      recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" }),
      recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" }),
      recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" }),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(stubs.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(stubs.fetchHtml).toHaveBeenCalledTimes(1);
  });

  it("reuses the settled result for a SEQUENTIAL later call in the same run (≤1 attempt)", async () => {
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(spcxHtml);
    const { ctx } = makeCtx();

    const first = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });
    // A later, non-concurrent call (e.g. get_cashflow after get_income_statement).
    const second = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });

    expect(second).toBe(first);
    expect(stubs.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(stubs.fetchHtml).toHaveBeenCalledTimes(1);
  });

  it("does not cache a result whose run was cleared mid-flight (concurrent re-run)", async () => {
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(spcxHtml);
    const { ctx } = makeCtx();

    const p1 = recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });
    // A concurrent re-run seeds and clears the session while p1 is still in flight.
    clearRecoveryForSession("sess-1");
    await p1.catch(() => {}); // the superseded run rejects

    // The cleared run must NOT have cached its result → a later call re-fetches.
    stubs.fetchCandidates.mockClear();
    await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });
    expect(stubs.fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it("rejects (writes nothing) when cleared while the fetch is in flight", async () => {
    // Hold the prior run inside the prospectus fetch, clear the session (a re-run's
    // seedSession), then let it finish: it must throw rather than write a stale
    // audit or a fallback payload into the reset spine.
    let releaseHtml!: (html: string) => void;
    const gate = new Promise<string>((resolve) => {
      releaseHtml = resolve;
    });
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockReturnValue(gate);
    const { ctx, audits } = makeCtx();

    const p1 = recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });
    clearRecoveryForSession("sess-1");
    releaseHtml(spcxHtml); // the superseded run now completes its extract

    await expect(p1).rejects.toThrow(/superseded/i);
    // A superseded run writes NO audit — it cannot repopulate the reset spine.
    expect(audits).toHaveLength(0);
  });

  it("supersedes an in-flight recovery for a DIFFERENT ticker on the same session", async () => {
    // A re-run for ticker B clears the whole session; ticker A's in-flight
    // recovery must be superseded too (session-level generation, not per-ticker).
    let releaseHtml!: (html: string) => void;
    const gate = new Promise<string>((resolve) => {
      releaseHtml = resolve;
    });
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockReturnValue(gate);
    const { ctx, audits } = makeCtx();

    const pA = recoverCriticalFinancials(ctx, { ticker: "AAA", date: "2026-05-06" });
    clearRecoveryForSession("sess-1"); // as a re-run for ticker "BBB" would do
    releaseHtml(spcxHtml);

    await expect(pA).rejects.toThrow(/superseded/i);
    expect(audits).toHaveLength(0);
  });

  it("bounds the module generation cache on a long-lived server (no unbounded leak)", () => {
    // Every analyze run seeds a generation entry for its session; a server that
    // runs many one-off sessions must not grow the map without bound.
    for (let i = 0; i < _MAX_RECOVERY_CACHE_ENTRIES + 200; i++) {
      clearRecoveryForSession(`sess-oneoff-${i}`);
    }
    expect(_recoveryCacheSizes().generation).toBeLessThanOrEqual(_MAX_RECOVERY_CACHE_ENTRIES);
  });

  it("records honest no-candidates (statements null) when discovery finds nothing", async () => {
    stubs.fetchCandidates.mockResolvedValue([]);
    const { ctx, audits } = makeCtx();

    const result = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });

    expect(result.statements).toBeNull();
    expect(result.audit.outcome).toBe("no-candidates");
    expect(audits[0].outcome).toBe("no-candidates");
  });

  it("records no-candidates when the ticker has no SEC CIK (non-US filer)", async () => {
    stubs.resolveCik.mockRejectedValue(new Error("No SEC CIK"));
    const { ctx } = makeCtx();

    const result = await recoverCriticalFinancials(ctx, { ticker: "ADYEN", date: "2026-05-06" });

    expect(result.statements).toBeNull();
    expect(result.audit.outcome).toBe("no-candidates");
    expect(result.audit.rejectionReasons).toContain("no-sec-cik");
    expect(stubs.fetchCandidates).not.toHaveBeenCalled();
  });

  it("rejects a stale prospectus (statements null) with reasons in the audit", async () => {
    // A prospectus whose latest period is a decade old → the stale gate rejects.
    const staleHtml = spcxHtml.replace(/December 31, 2025/g, "December 31, 2014")
      .replace(/December 31, 2024/g, "December 31, 2013");
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(staleHtml);
    const { ctx } = makeCtx();

    const result = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });

    expect(result.statements).toBeNull();
    expect(result.audit.outcome).toBe("rejected");
    expect(result.audit.rejectionReasons.join(" ")).toMatch(/stale/);
  });

  it("rethrows on abort during the model call instead of swallowing it into an audit", async () => {
    const noScaleHtml = "<html><body><p>no financial tables here</p></body></html>";
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(noScaleHtml);
    const { ctx, audits } = makeCtx();
    const controller = new AbortController();
    (ctx as { signal?: AbortSignal }).signal = controller.signal;
    // Abort at MODEL-call time (the deterministic tier already missed): the
    // catch must rethrow the original error, not turn it into an audit.
    const abortErr = new Error("The operation was aborted");
    stubs.llmExtract.mockImplementation(async () => {
      controller.abort();
      throw abortErr;
    });

    await expect(
      recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" }),
    ).rejects.toBe(abortErr);
    // A cancellation must not write a recovery audit.
    expect(audits).toHaveLength(0);
  });

  it("rethrows an abort during deterministic discovery/fetch without writing an audit", async () => {
    // A run cancelled while recovery is still discovering/fetching SEC docs must
    // not finish() an audit or promote — even before the model tier is reached.
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(spcxHtml);
    const { ctx, audits } = makeCtx();
    const controller = new AbortController();
    controller.abort();
    (ctx as { signal?: AbortSignal }).signal = controller.signal;

    await expect(
      recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" }),
    ).rejects.toThrow();
    expect(audits).toHaveLength(0);
    // The model tier is never reached on a cancelled run.
    expect(stubs.llmExtract).not.toHaveBeenCalled();
  });

  it("falls back to the ONE bounded LLM extract when the deterministic tier misses", async () => {
    // HTML with no scale note → deterministic extractor returns null.
    const noScaleHtml = "<html><body><p>no financial tables here</p></body></html>";
    stubs.fetchCandidates.mockResolvedValue([candidate424]);
    stubs.fetchHtml.mockResolvedValue(noScaleHtml);
    const llmCandidate: FinancialCandidate = {
      ticker: "SPCX",
      cik: 1750000,
      companyName: "SpaceCo Exploration Inc.",
      form: "424B4",
      filingDate: "2026-02-10",
      periodEnd: "2025-12-31",
      scale: 1_000,
      currency: "USD",
      sourceUrl: candidate424.url,
      income: { revenue: 8_500_000_000, operatingIncome: 1_200_000_000 },
      cashflow: { operating: 2_000_000_000, capitalExpenditure: -3_500_000_000, freeCashFlow: null },
      balance: { cashAndEquivalents: 4_000_000_000, totalDebt: 1_000_000_000 },
    };
    stubs.llmExtract.mockResolvedValue(llmCandidate);
    const { ctx } = makeCtx();

    const result = await recoverCriticalFinancials(ctx, { ticker: "SPCX", date: "2026-05-06" });

    expect(stubs.llmExtract).toHaveBeenCalledTimes(1);
    expect(result.audit.outcome).toBe("promoted");
    expect(result.statements!.incomeStatement.revenue).toBeCloseTo(8.5, 6);
  });
});
