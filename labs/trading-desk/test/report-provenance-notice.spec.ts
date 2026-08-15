/**
 * The provenance notice's shared copy asserts no cause (FIX-1063 / FIX-780).
 *
 * The rule, stated once so a third consumer does not have to re-learn it: THE
 * MOMENT A COMPONENT TAKES A LIST OF REASONS, ITS SHARED COPY CANNOT DESCRIBE
 * ANY ONE REASON'S CAUSE. Copy that names a cause can serve exactly one entry,
 * which makes the list decorative.
 *
 * It is not a style rule — it is the same honesty rule the rest of this issue
 * enforces, one layer up. The notice's first version read "figures below may
 * include values that were never measured", which is true of a report predating
 * the data-honesty contract and FALSE of one predating the flat-stance
 * labeling fix, whose two price levels WERE measured — only which of them was
 * the stop was lost. Filing that reason under that body would raise a false
 * alarm about good numbers, which is the mirror image of presenting absent data
 * as measured.
 *
 * These assertions fail exactly when someone moves a cause back into the shared
 * copy, or writes a reason that leans on the body to finish its sentence.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
} from "@flow-state-dev/engine";
import analysisFlow from "../flows/analysis/flow";
import { DATA_HONESTY_CONTRACT_VERSION } from "../flows/analysis/data-honesty-contract";
import {
  PROVENANCE_NOTICE_BODY,
  PROVENANCE_NOTICE_HEADING,
  PRE_DATA_HONESTY_FIX_REASON,
  reasonsForProvenance,
} from "../components/summary/report-provenance-notice";

/**
 * Words that can only appear in copy describing a SPECIFIC correction. Each
 * belongs to one of the two known reasons — none can be true of both, which is
 * exactly why none may appear in copy shown for either.
 */
const CAUSE_SPECIFIC_TERMS = [
  // data-honesty (FIX-1063)
  "zero",
  "measured",
  "unavailable",
  "figure",
  "honesty",
  // trade-levels labeling (FIX-780)
  "price",
  "level",
  "stop",
  "target",
  "flat",
  "stance",
];

describe("the notice's shared copy names no cause", () => {
  const shared = `${PROVENANCE_NOTICE_HEADING} ${PROVENANCE_NOTICE_BODY}`.toLowerCase();

  for (const term of CAUSE_SPECIFIC_TERMS) {
    it(`does not mention "${term}"`, () => {
      expect(shared).not.toContain(term);
    });
  }

  it("still tells the reader what the notice is and what to do", () => {
    // Neutral is not empty. The shared copy must carry the two things true of
    // EVERY reason: that the report predates a correction, and that re-running
    // produces a current one.
    expect(shared).toContain("predates");
    expect(shared).toContain("re-run");
  });
});

describe("each reason is self-contained", () => {
  // Add a new reason constant here when a third consumer lands. A reason that
  // cannot stand alone is one the shared body would have to finish — which is
  // the failure this file exists to prevent.
  const REASONS = { PRE_DATA_HONESTY_FIX_REASON };

  for (const [name, reason] of Object.entries(REASONS)) {
    it(`${name} names its own correction and what it means for the numbers`, () => {
      const text = reason.toLowerCase();
      // It says what the desk did wrong…
      expect(text).toContain("zero");
      expect(text).toContain("unavailable");
      // …and what a reader should therefore distrust. Without this half the
      // reader gets a mechanism with no consequence, and the old body is what
      // supplied the consequence.
      expect(text).toContain("never have been measured");
      // A reason is a sentence, not a label.
      expect(reason.length).toBeGreaterThan(40);
    });
  }
});

/**
 * WHERE the notice mounts — a structural guard, not a render test.
 *
 * The defect this pins is a RENDER GATE: the notice was mounted inside
 * `ReportSummary`, so it painted only on the Summary tab. The Theses/Summary
 * choice is sticky once a memo is picked and is not reset when another stored
 * report is opened, so a reader could open a pre-fix report, read memos derived
 * from fabricated zeros, and never meet the sole disclosure. The component was
 * correct and the data reached it; the condition that hid it belonged to a
 * different participant. That is the FIX-1060 lesson, and this is its second
 * occurrence here — which is what earns a guard.
 *
 * It is structural (which module mounts the banner) rather than a render
 * assertion because this package has no React render harness, and adding one
 * would be a larger change than the fix. It is deliberately coarse: it asserts
 * only WHICH module owns the mount, so it survives formatting and refactors and
 * fails on the one move that matters — putting the disclosure back behind a tab.
 *
 * A SOURCE-GREP PIN, NOT A BEHAVIOURAL TEST. It matches on source text, so a
 * rename or a re-import can fail it without anything regressing. If it breaks,
 * first ask whether the mount actually moved behind a gate; if it did not,
 * re-point the pin. The durable fix is a pure `reasonsForProvenance` helper
 * these could assert against directly — a refactor, tracked with the rest of the
 * data-honesty follow-ups, not a reason to trust a red run here blindly.
 */
describe("the provenance notice is not gated behind a tab", () => {
  const read = (p: string) =>
    readFileSync(path.resolve(__dirname, "..", p), "utf8");

  it("mounts in the pane, above the Theses/Summary switch", () => {
    const pane = read("components/theses/theses-pane.tsx");
    expect(pane).toContain("<ReportProvenanceBanner");
    // The mount must precede the tab conditional, or it is inside a branch.
    expect(pane.indexOf("<ReportProvenanceBanner")).toBeLessThan(
      pane.indexOf('tab === "summary"'),
    );
  });

  it("is NOT mounted inside the Summary branch", () => {
    // `ReportSummary` renders only when the Summary tab is active, so a mount
    // here is by construction invisible to a reader sitting on Theses.
    const summary = read("components/summary/report-summary.tsx");
    expect(summary).not.toContain("<ReportProvenanceNotice");
    expect(summary).not.toContain("<ReportProvenanceBanner");
  });
});

/**
 * THE STATE TABLE. Every state a bound session can be in, and what the banner
 * owes a reader in each.
 *
 * This gate has been wrong three times, and each fix was derived from the one
 * state its author happened to name — so each was correct there and wrong two
 * rows away. The table is the fix for that: a change to the gate has to make
 * every row pass, not the row that prompted it. Add a row before you touch
 * `reasonsForProvenance`; if a new signal makes two rows collapse into one,
 * that is a finding worth stating, not a row to quietly drop.
 *
 * The two columns are everything the predicate sees. `memoCount` is the
 * snapshot's `memos` count; `contractVersion` is the stored stamp, which is
 * `undefined` on a record written before the field existed and `null` on a
 * session that has one but never ran. The empirical basis for both is the
 * describe block below — it is what makes this table a description of the
 * system rather than a description of our beliefs about it.
 */
describe("the state table", () => {
  const CURRENT = DATA_HONESTY_CONTRACT_VERSION;
  const SILENT: readonly string[] = [];
  const BANNER: readonly string[] = [PRE_DATA_HONESTY_FIX_REASON];

  const ROWS: ReadonlyArray<{
    state: string;
    memoCount: number | undefined;
    contractVersion: unknown;
    expect: readonly string[];
    why: string;
  }> = [
    {
      state: "no session bound (fresh install)",
      memoCount: undefined,
      contractVersion: undefined,
      expect: SILENT,
      why: "nothing on screen to disclose anything about",
    },
    {
      state: "session created but never seeded (the orphaned session)",
      memoCount: 0,
      contractVersion: null,
      expect: SILENT,
      why:
        "`createSession` succeeded and the dispatch never happened, so the " +
        "session carries schema defaults and no report. The pane under this " +
        "banner shows EmptySelection; a warning above it describes nothing.",
    },
    {
      state: "seed in flight (before the stamp is patched)",
      memoCount: 0,
      contractVersion: null,
      expect: SILENT,
      why:
        "the seed clears memos and patches the stamp ~30 awaits later, so this " +
        "window is long and every fresh run passes through it. Same shape as " +
        "the orphan row above — deliberately, since both mean 'no report yet'.",
    },
    {
      state: "run in flight, past the seed",
      memoCount: 4,
      contractVersion: CURRENT,
      expect: SILENT,
      why: "produced by current producers; the stamp settles it",
    },
    {
      state: "run complete, current",
      memoCount: 20,
      contractVersion: CURRENT,
      expect: SILENT,
      why: "nothing to disclose — and no 'verified' chip either",
    },
    {
      state: "run errored mid-way leaving partial memos, current",
      memoCount: 7,
      contractVersion: CURRENT,
      expect: SILENT,
      why:
        "the stamp is written at seed, so a run that dies later still carries " +
        "it. Partial output from current producers is not pre-fix output.",
    },
    {
      state: "legacy stored report, complete",
      memoCount: 20,
      contractVersion: undefined,
      expect: BANNER,
      why: "the case the notice exists for",
    },
    {
      state: "legacy stored report, errored mid-way leaving partial memos",
      memoCount: 7,
      contractVersion: undefined,
      expect: BANNER,
      why:
        "the row that kills `runComplete === true` as a gate. Partial memos " +
        "built on fabricated zeros are still on screen and still unvouchable.",
    },
    {
      state: "current stored report, re-opened",
      memoCount: 20,
      contractVersion: CURRENT,
      expect: SILENT,
      why: "re-opening runs zero models and changes nothing about provenance",
    },
    {
      state: "legacy run stopped at a guard before any memo was created",
      memoCount: 0,
      contractVersion: undefined,
      expect: SILENT,
      why:
        "an under-claim we accept: the stop banner is the whole surface and " +
        "there are no figures to mislabel. A gate on `stoppedReason` would " +
        "paint 'this report predates a correction' over a report that does " +
        "not exist — defect 2 again, one axis over.",
    },
    {
      state: "stamp from a LATER contract version than this build knows",
      memoCount: 20,
      contractVersion: CURRENT + 1,
      expect: BANNER,
      why:
        "owned by `isPreDataHonestyFix`, not by this gate: anything that is " +
        "not exactly the current version reads pre-fix, which under-claims " +
        "rather than vouching for a report this build cannot assess.",
    },
  ];

  for (const row of ROWS) {
    const verdict = row.expect.length > 0 ? "shows the banner" : "stays silent";
    it(`${row.state} → ${verdict} (${row.why})`, () => {
      expect(
        reasonsForProvenance({
          memoCount: row.memoCount,
          contractVersion: row.contractVersion,
        }),
      ).toEqual(row.expect);
    });
  }

  it("covers both verdicts, so a gate stuck one way cannot pass the table", () => {
    expect(ROWS.some((r) => r.expect.length > 0)).toBe(true);
    expect(ROWS.some((r) => r.expect.length === 0)).toBe(true);
  });
});

/**
 * WHAT A NEVER-RUN SESSION ACTUALLY PROJECTS — the measurement the table rests
 * on, taken rather than reasoned out.
 *
 * The question that decides this gate: does a session that exists but was never
 * patched surface schema DEFAULTS to the client, or `undefined`? It is not
 * answerable by reading `state.ts` — `createSession` is what decides whether the
 * schema's `.default()`s are ever applied, and `computeClientData` is what
 * decides what reaches the browser. So this drives the real routes.
 *
 * The answer is DEFAULTS, and it is why the obvious gates are wrong: `ticker` on
 * a session that never ran is the string `"NVDA"`, not `undefined`, so
 * `ticker != null` reads "a report exists" on the orphaned session. It also
 * pins the null-vs-undefined split the table's two "no stamp" spellings rely on.
 */
describe("what the client actually reads off a session that never ran", () => {
  async function router() {
    const registry = createFlowRegistry();
    registry.register(analysisFlow);
    const stores = createInMemoryStores();
    return { router: createFlowApiRouter({ registry, stores }), stores };
  }

  async function readState(r: Awaited<ReturnType<typeof router>>, id: string) {
    const res = await r.router.GET(
      new Request(`http://localhost/api/flows/sessions/${id}/state`),
      { params: { path: ["sessions", id, "state"] } },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      clientData: { session: Record<string, unknown> };
      resources?: { session?: { memos?: { count?: number } } };
    };
  }

  it("projects schema DEFAULTS, not undefined — so `ticker != null` is not a report", async () => {
    const r = await router();
    const created = await r.router.POST(
      new Request("http://localhost/api/flows/analysis/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1", sessionId: "never_ran" }),
      }),
      { params: { path: ["analysis", "sessions"] } },
    );
    expect(created.status).toBe(201);

    const body = await readState(r, "never_ran");
    const state = body.clientData.session;

    // The trap, stated as an assertion: every one of these is a plausible-
    // looking value on a session where nothing ever ran.
    expect(state.ticker).toBe("NVDA");
    expect(state.runComplete).toBe(false);
    expect(state.activePhase).toBe("idle");
    expect(state.stoppedReason).toBeNull();

    // A session that HAS the stamp field but never ran carries the `.default(null)`
    // — which reads pre-fix, exactly as a legacy report does. That collision is
    // the whole defect, and no session field resolves it.
    expect(state.dataHonestyContractVersion).toBeNull();

    // What does resolve it.
    expect(body.resources?.session?.memos?.count).toBe(0);
  });

  it("a legacy record has NO stamp key at all, and a non-zero memo count", async () => {
    const r = await router();
    const now = Date.now();
    // Written straight to the store: a record from a build that predates the
    // field. Going through `createSession` would backfill the schema default
    // and destroy the very shape under test.
    await r.stores.session.set(
      "legacy",
      {
        id: "legacy",
        flowKind: "analysis",
        userId: "u1",
        state: {
          ticker: "AMD",
          date: "2026-05-06",
          costPreset: "fast",
          dataSource: "fixture",
          activePhase: "phase-5",
          maxDebateRounds: 1,
          runComplete: true,
        },
        lineageId: "lin_legacy",
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: [],
      } as never,
      "any",
    );
    await r.stores.resourceState.set(
      "session",
      "legacy",
      "memos/p1/fundamentals",
      { status: "published" } as never,
      "any",
    );

    const body = await readState(r, "legacy");
    const state = body.clientData.session;

    // Absent, not null — the key never reaches the wire.
    expect(
      Object.prototype.hasOwnProperty.call(state, "dataHonestyContractVersion"),
    ).toBe(false);
    expect(state.dataHonestyContractVersion).toBeUndefined();
    expect(body.resources?.session?.memos?.count).toBe(1);

    // End to end: this is the row the notice exists for.
    expect(
      reasonsForProvenance({
        memoCount: body.resources?.session?.memos?.count,
        contractVersion: state.dataHonestyContractVersion,
      }),
    ).toEqual([PRE_DATA_HONESTY_FIX_REASON]);
  });
});

/**
 * The gate reaches the render, and the stamp is never defaulted to present.
 *
 * Two shapes a green table could still hide. The first is the FIX-1060 drop
 * point — a predicate computed and then not read. The second is the tempting
 * anti-shape: `?? DATA_HONESTY_CONTRACT_VERSION` would make a legacy report read
 * as current, which is the unfixable direction, since nothing distinguishes
 * those runs afterwards.
 *
 * A SOURCE-GREP PIN. It matches source text, so a rename can fail it with
 * nothing regressed — read a failure as "check the gate", not as proof it moved.
 */
describe("the gate is wired to the render", () => {
  const source = readFileSync(
    path.resolve(__dirname, "..", "components/summary/report-provenance-notice.tsx"),
    "utf8",
  );

  it("the banner renders the pure predicate's result, not its own re-derivation", () => {
    expect(source).toMatch(/reasons\s*=\s*useMemo\(\s*\(\)\s*=>\s*reasonsForProvenance\(/);
    expect(source).toContain("<ReportProvenanceNotice reasons={reasons} />");
  });

  it("does NOT default the absent stamp to present", () => {
    expect(source).not.toMatch(/dataHonestyContractVersion\s*\?\?/);
    expect(source).not.toMatch(
      /isPreDataHonestyFix\([^)]*\?\?\s*DATA_HONESTY_CONTRACT_VERSION/,
    );
  });
});
