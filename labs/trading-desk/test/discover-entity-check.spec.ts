/**
 * Regression tests for the discovery entity-identity guard (FIX-779).
 *
 * The bug: a RESOLVABLE ticker whose web-search results belong to someone else.
 * In the filed run, a `discover_*_context` payload carried "Black Hills"
 * earnings-call transcripts into another ticker's fundamentals analyst as
 * context. Nothing structural stopped it — the analyst happened to notice.
 *
 * Intent encoded here:
 *   1. A result naming a different company is REMOVED from `items` before the
 *      payload reaches a prompt, and its title + snippet are not carried into
 *      `excluded` — a tag on contaminated prose is still contaminated prose in
 *      the prompt.
 *   2. The guard runs on fixture replay too, not just live search, so a
 *      regression run exercises it.
 *   3. When the subject's identity is unknown the payload degrades to
 *      `"unchecked"` and keeps everything — losing all context because we could
 *      not identify the company is a worse failure than the one being guarded.
 *   4. Macro / market discovery asks about the ENVIRONMENT around a name, so it
 *      is tagged `"not-applicable"` and never filtered — otherwise the guard
 *      would delete exactly the sector and peer context those tools fetch.
 *   5. The `resolveSubjectEntity` tap is what makes (1) possible before the
 *      Phase 1 fan-out: it warms the profile spine the discovery tools read.
 *
 * Driven through `testFlow` (not `testBlock`) because the subject identity
 * lives in seeded session-resource STATE, which only the flow harness seeds.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { _resetCache } from "../lib/cache";
import { discover_fundamentals_context } from "../flows/analysis/tools/data/discover_fundamentals_context";
import { discover_macro_context } from "../flows/analysis/tools/data/discover_macro_context";
import { resolveSubjectEntity } from "../flows/analysis/resolve-subject-entity";
import { profileDataResource } from "../flows/analysis/profile-data-resource";
import type { DiscoveryPayload } from "../flows/analysis/tools/schemas";
import { sessionStateSchema } from "../flows/analysis/state";

vi.mock("@flow-state-dev/tools/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/tools/search")>();
  return { ...actual, resolveProvider: vi.fn() };
});
import { resolveProvider } from "@flow-state-dev/tools/search";
const mockResolveProvider = vi.mocked(resolveProvider);

// Both profile providers, so a live-mode warm-up can be failed deterministically.
// `loadCompanyProfile` RESOLVES with the `unavailable` sentinel when both miss —
// it does not throw — which is the path the tap has to refuse to persist.
vi.mock("@/lib/providers/finnhub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/providers/finnhub")>();
  return { ...actual, hasFinnhubKey: vi.fn(() => false) };
});
vi.mock("@/lib/providers/yahoo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/providers/yahoo")>();
  return {
    ...actual,
    fetchYahooCompanyProfile: vi.fn(async () => {
      throw new Error("yahoo unreachable");
    }),
  };
});

const flow = defineFlow({
  kind: "trading-desk-entity-check-test",
  actions: {
    resolveEntity: { block: resolveSubjectEntity },
    discoverFundamentals: { block: discover_fundamentals_context },
    discoverMacro: { block: discover_macro_context },
  },
  session: { stateSchema: sessionStateSchema },
  resources: { profileData: profileDataResource },
})({ id: "test" });

/**
 * A schema-complete `get_company_profile` payload. The session spine validates
 * its state against the tool's output schema, so a partial object is dropped
 * on load — seeding must produce the shape the profile tool really writes.
 */
function profileOf(fields: {
  ticker: string;
  name: string;
  website: string | null;
}): Record<string, unknown> {
  return {
    source: "finnhub",
    asOf: "2026-05-06",
    sector: null,
    industry: null,
    country: null,
    exchange: null,
    currency: null,
    businessDescription: null,
    marketCapUsd: null,
    employees: null,
    ipoDate: null,
    websiteMetaDescription: null,
    searchSnippets: null,
    ...fields,
  };
}

/** The subject: a thinly covered ticker whose search results drift. */
const SUBJECT_TICKER = "BHYP";
const SUBJECT_PROFILE = profileOf({
  ticker: SUBJECT_TICKER,
  name: "Bhyper Technologies Inc",
  website: "https://bhyper.example",
});

const NVIDIA_PROFILE = profileOf({
  ticker: "NVDA",
  name: "NVIDIA Corporation",
  website: "https://www.nvidia.com",
});

/** A wrong-company result — the shape that reached the analyst in the filed run. */
const WRONG_COMPANY = {
  title: "Black Hills Corp Q1 2026 earnings call transcript",
  url: "https://example.com/black-hills-corp-q1-2026-transcript",
  snippet:
    "Management reiterated full-year guidance and detailed the regulated utility rate case.",
  source: "tavily" as const,
};

/** A result that really is about the subject. */
const RIGHT_COMPANY = {
  title: "Bhyper Technologies raises Q2 outlook",
  url: "https://example.com/bhyper-q2-outlook",
  snippet: "The company guided above consensus on new platform bookings.",
  source: "tavily" as const,
};

function stateFor(
  dataSource: "fixture" | "live",
  ticker = SUBJECT_TICKER,
  costPreset: "fast" | "full" = "full",
) {
  return {
    ticker,
    date: "2026-05-06",
    costPreset,
    dataSource,
    activePhase: "idle" as const,
    maxDebateRounds: 1,
    runComplete: false,
  };
}

function mockSearchResults(results: Array<typeof WRONG_COMPANY>): void {
  mockResolveProvider.mockReturnValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: {
      name: "tavily",
      search: async (q: string) => ({ query: q, results }),
    } as any,
    apiKey: "test-key",
  });
}

/** Run one discovery action with an optionally-seeded subject profile. */
async function runDiscovery(opts: {
  action: "discoverFundamentals" | "discoverMacro";
  state: ReturnType<typeof stateFor>;
  profile?: Record<string, unknown>;
  sessionId: string;
}): Promise<{ payload: DiscoveryPayload; error?: Error }> {
  const result = await testFlow({
    flow,
    action: opts.action,
    userId: "test-user",
    sessionId: opts.sessionId,
    stores: createInMemoryStores(),
    input: { ticker: opts.state.ticker, date: opts.state.date },
    seed: {
      session: {
        state: opts.state,
        resources:
          opts.profile === undefined
            ? undefined
            : { profileData: { companyProfile: opts.profile } },
      },
    },
  });
  return { payload: result.output as DiscoveryPayload, error: result.error };
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
  mockResolveProvider.mockReset();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
});

describe("entity-scoped discovery drops wrong-company results", () => {
  it("removes the wrong-company item and keeps the subject's, without carrying its prose", async () => {
    mockSearchResults([WRONG_COMPANY, RIGHT_COMPANY]);
    const { payload, error } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live"),
      profile: SUBJECT_PROFILE,
      sessionId: "entity-drop",
    });

    expect(error).toBeUndefined();
    expect(payload.entityCheck).toBe("verified");
    expect(payload.items.map((i) => i.url)).toEqual([RIGHT_COMPANY.url]);
    // Renumbered, so the analyst's "read item 1" contract still holds.
    expect(payload.items[0].id).toBe("1");

    expect(payload.excluded).toHaveLength(1);
    expect(payload.excluded[0].url).toBe(WRONG_COMPANY.url);
    expect(payload.excluded[0].reason).toContain("entity-mismatch");
    // The audit record is URL + reason ONLY. The wrong company's title and
    // snippet must not survive into the payload — a tagged snippet is still a
    // snippet in the prompt, which is the whole failure being closed.
    expect(Object.keys(payload.excluded[0]).sort()).toEqual(["reason", "url"]);
    expect(JSON.stringify(payload)).not.toContain(WRONG_COMPANY.snippet);
  });

  it("empties `items` when every result is about someone else, rather than passing them through", async () => {
    mockSearchResults([WRONG_COMPANY]);
    const { payload } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live"),
      profile: SUBJECT_PROFILE,
      sessionId: "entity-drop-all",
    });
    expect(payload.entityCheck).toBe("verified");
    // An empty `items` list is the prompt's existing "skip investigation"
    // signal — a fully contaminated discovery degrades to no investigation.
    expect(payload.items).toEqual([]);
    expect(payload.excluded).toHaveLength(1);
  });

  it("validates a replayed fixture the same way it validates a live search", async () => {
    const { payload, error } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("fixture", "NVDA"),
      profile: NVIDIA_PROFILE,
      sessionId: "entity-fixture",
    });
    expect(error).toBeUndefined();
    expect(payload.entityCheck).toBe("verified");
    // The curated NVDA corpus is genuinely about NVIDIA — nothing is dropped.
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.excluded).toEqual([]);
  });
});

describe("field boundaries cannot manufacture a match", () => {
  it("drops a macro result whose title/snippet join into the issuer's name", () => {
    // The concatenation defect, end to end on the real tool path. Title ends
    // "American"; snippet opens "Financial pressure…". Neither field names the
    // issuer, but `title + " " + snippet + " " + url` contains the adjacent pair
    // `american financial`, so the result was marked `verified` — the ordinary-
    // token adjacency rule defeated by its own input preparation.
    mockSearchResults([
      {
        title: "Why the consumer is still American",
        url: "https://example.com/macro-consumer-outlook",
        snippet: "Financial pressure builds as rates rise across the economy.",
        source: "tavily" as const,
      },
    ]);
    return runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live", "AFG"),
      profile: profileOf({
        ticker: "AFG",
        name: "American Financial Group Inc",
        website: null,
      }),
      sessionId: "entity-cross-field",
    }).then(({ payload }) => {
      expect(payload.entityCheck).toBe("verified");
      expect(payload.items).toEqual([]);
      expect(payload.excluded).toHaveLength(1);
    });
  });

  it("still keeps a result that names the issuer within a single field", () => {
    // The no-regression half: per-field matching must not cost a real mention.
    mockSearchResults([
      {
        title: "American Financial Group beats on premium growth",
        url: "https://example.com/afg-q3",
        snippet: "The insurer raised its full-year outlook.",
        source: "tavily" as const,
      },
    ]);
    return runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live", "AFG"),
      profile: profileOf({
        ticker: "AFG",
        name: "American Financial Group Inc",
        website: null,
      }),
      sessionId: "entity-cross-field-ok",
    }).then(({ payload }) => {
      expect(payload.entityCheck).toBe("verified");
      expect(payload.items).toHaveLength(1);
      expect(payload.excluded).toEqual([]);
    });
  });
});

describe("the guard degrades honestly instead of failing closed", () => {
  it("tags `unchecked` and keeps every item when the subject's identity is unresolved", async () => {
    mockSearchResults([WRONG_COMPANY, RIGHT_COMPANY]);
    const { payload } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live"),
      // No seeded profile — the warm-up failed or the provider had nothing.
      sessionId: "entity-unknown",
    });
    expect(payload.entityCheck).toBe("unchecked");
    expect(payload.items).toHaveLength(2);
    expect(payload.excluded).toEqual([]);
  });

  it("tags `unchecked` on the skipped (cheap-preset) payload — no check ran", async () => {
    const { payload } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live", SUBJECT_TICKER, "fast"),
      profile: SUBJECT_PROFILE,
      sessionId: "entity-fast",
    });
    expect(payload.source).toBe("skipped");
    expect(payload.entityCheck).toBe("unchecked");
    expect(mockResolveProvider).not.toHaveBeenCalled();
  });

  it("does NOT report a provider outage as a completed check that found nothing", async () => {
    // The subject resolves fine; the SEARCH is what fails (no provider wired,
    // or every provider errored). The payload comes back `unavailable` with no
    // items — and stamping `verified` on it tells the analyst, in the prompt's
    // own words, that "the filter ran and nothing passed". That is a provider
    // outage reported as a clean search: absent data presented as measured data,
    // which is the failure this whole surface exists to prevent.
    mockResolveProvider.mockImplementation(() => {
      throw new Error("no search provider configured");
    });
    const { payload } = await runDiscovery({
      action: "discoverFundamentals",
      state: stateFor("live"),
      profile: SUBJECT_PROFILE,
      sessionId: "entity-provider-outage",
    });
    expect(payload.source).toBe("unavailable");
    expect(payload.items).toEqual([]);
    // `unchecked` — we could not look, as distinct from looked-and-found-nothing.
    expect(payload.entityCheck).toBe("unchecked");
    expect(payload.excluded).toEqual([]);
  });
});

describe("environment-scoped discovery is not filtered", () => {
  it("tags macro discovery `not-applicable` and keeps results that never name the company", async () => {
    // A rates/tariff piece is relevant to the name without naming it. Filtering
    // it out would delete the macro analyst's entire discovery payload.
    mockSearchResults([
      {
        title: "Fed holds rates, signals one cut in 2026",
        url: "https://example.com/fed-holds-rates",
        snippet:
          "The committee left the target range unchanged and flagged tariff pass-through.",
        source: "tavily" as const,
      },
    ]);
    const { payload } = await runDiscovery({
      action: "discoverMacro",
      state: stateFor("live"),
      profile: SUBJECT_PROFILE,
      sessionId: "entity-macro",
    });
    expect(payload.entityCheck).toBe("not-applicable");
    expect(payload.items).toHaveLength(1);
    expect(payload.excluded).toEqual([]);
  });
});

describe("resolveSubjectEntity tap", () => {
  it("warms the profile spine before Phase 1, so discovery has a name to check against", async () => {
    const stores = createInMemoryStores();
    const sessionId = "entity-warm";

    const run = await testFlow({
      flow,
      action: "resolveEntity",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
      seed: { session: { state: stateFor("fixture", "NVDA") } },
    });
    expect(run.error).toBeUndefined();

    const resources = toBareStates(await stores.resourceState.getAll("session", sessionId));
    const spine = resources["profileData"] as { companyProfile?: { name?: string } };
    expect(spine.companyProfile?.name).toBe("NVIDIA Corporation");
  });

  it("fails soft on an unresolvable subject — the run continues, discovery stays unchecked", async () => {
    const stores = createInMemoryStores();
    const sessionId = "entity-warm-miss";
    const run = await testFlow({
      flow,
      action: "resolveEntity",
      userId: "test-user",
      sessionId,
      stores,
      // No fixture snapshot for this ticker — the profile load throws.
      input: {},
      seed: { session: { state: stateFor("fixture", "ZZZZ") } },
    });
    expect(run.error).toBeUndefined();
    const resources = toBareStates(await stores.resourceState.getAll("session", sessionId));
    const spine = resources["profileData"] as { companyProfile?: unknown } | undefined;
    expect(spine?.companyProfile).toBeUndefined();
  });

  it("does not cache a failed warm-up as a resolved profile", async () => {
    // Both providers down. `loadCompanyProfile` RESOLVES with the `unavailable`
    // sentinel rather than throwing, so the tap's try/catch never sees it.
    // Persisting it would be a cached absence: `getOrPatchState` counts any
    // stored value as a hit, so the profile analyst's own call inside the
    // fan-out would skip its fetch and inherit a transient blip — leaving the
    // entity check `unchecked` for every result in the run.
    const stores = createInMemoryStores();
    const sessionId = "entity-warm-provider-outage";
    const run = await testFlow({
      flow,
      action: "resolveEntity",
      userId: "test-user",
      sessionId,
      stores,
      input: {},
      seed: { session: { state: stateFor("live", "NVDA") } },
    });
    expect(run.error).toBeUndefined();
    const resources = toBareStates(await stores.resourceState.getAll("session", sessionId));
    const spine = resources["profileData"] as { companyProfile?: unknown } | undefined;
    // Absent, not an `unavailable` sentinel — so the later call still retries.
    expect(spine?.companyProfile).toBeUndefined();
  });
});
