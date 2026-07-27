# ETF look-through — UX redesign

> **Intended location:** `labs/trading-desk/docs/specs/etf-look-through-ux-design.md`
> All relative links below resolve from that path.

**Type:** design proposal (no implementation).
**Surface:** the Portfolio pane's Health perspective —
[`components/portfolio/health-section.tsx`](../../components/portfolio/health-section.tsx),
plus a small set of additive fields on
[`domain/portfolio/math/etf-look-through.ts`](../../domain/portfolio/math/etf-look-through.ts).
**Related:** [`../etf-look-through.md`](../etf-look-through.md) — the methodology
reference this design must not violate ·
[`bond-etf-asset-class-design.md`](./bond-etf-asset-class-design.md) — the
curated bond-ETF list, which is why part of the book can never decompose.
**Revises:** the look-through feature's Decision 2 — see §0.5.

---

## Summary — what this proposes, in plain language

The Health view shipped **look-through**: seeing inside an ETF, so that Apple
held directly and Apple held through SPY and VTI add up into one number instead
of sitting in three unrelated places. The arithmetic is correct. The screen it
produced is not usable.

Run against a real 44-ETF book, the view shows **two sector panels that appear to
disagree**, a table of top holdings that **silently hides most of its own rows**,
a stat called *"Effective positions"* reading `1.5–338.1`, and roughly forty
funds mashed into one run-on sentence explaining why they couldn't be read. The
user's goal is one sentence: *"Sector exposure is supposed to ultimately allow me
to see exposure of the entire portfolio"* — and, put more sharply later: *"I want
to know how much I own and where."*

This document proposes:

1. **One sector panel instead of two**, on the look-through basis, with the
   unattributed remainder drawn as an explicit bar on the same axis so the chart
   closes to 100% of invested NAV. Nothing is renormalized. Today's second panel
   is deleted, not toggled.
2. **The effective-names table becomes the canonical answer** to "how much of
   each stock do I own, across every wrapper and every account" — truncation made
   honest, account-level provenance added.
3. **Coverage expressed in money, not fund counts.** How much of the book we can
   see inside, how much never decomposes by design, how much is still pending.
4. **Three reasons a fund stays opaque, told apart**: permanent policy exclusion,
   not fetched yet, data-quality problem. Today they look identical.

The load-bearing discovery is §0.1: the two panels people read as contradictory
are already on the **same denominator**. They are the same scale at two
resolutions, and unifying them is arithmetic rather than reconciliation.

Phasing is in §7. Phase 1 is a half-day of presentation fixes with no leaf change
and is safe to ship immediately; Phases 2–3 should be a follow-up issue rather
than further rounds on the already-46-round look-through PR. Settled decisions
are recorded in §8.

---

## 0. Findings from the code

Four things commonly assumed about this feature are wrong, and two of them change
the design materially. Everything here is verified against the source.

### 0.1 The two sector panels share one denominator

The panels are widely described as having *"two different denominators."* They do
not. Both are `% of invested NAV`:

- wrapper basis —
  [`domain/portfolio/math/portfolio-health.ts`](../../domain/portfolio/math/portfolio-health.ts)
  line 383, `pct: pctOf(marketValue, investedNav)`
- look-through —
  [`domain/portfolio/math/etf-look-through.ts`](../../domain/portfolio/math/etf-look-through.ts)
  line 965, `pct: pctOf(marketValue, investedNav)`

What differs is **completeness, not scale**. The wrapper bars sum to ~100%. The
look-through bars sum to `sectorCoveragePct`; the rest sits in
`sectorResidual.sharePct` — a field the leaf **already computes and the UI never
renders** (type at `etf-look-through.ts:252`, computed at ~`:974`).

This is the most important fact in this document, and it is good news. The two
panels are not contradictory answers on incomparable scales. They are **the same
scale at two resolutions**: the wrapper basis carries full mass at coarse
resolution ("Funds" is one opaque block); look-through carries fine resolution at
partial mass. Unification is therefore *arithmetic*, not reconciliation — put the
attributed bars and the residual on one axis and it closes to 100% by
construction, with no renormalization anywhere.

What the user actually experienced is worse than two denominators: two panels on
the *same* scale, one of which silently doesn't add up. That reads as broken math.
It isn't. It's a missing bar.

**Where the "57.6% vs 22.7%" confusion really comes from.** Those figures are on
different *axes*, not different denominators: `Funds (no look-through)` is a
wrapper-basis **sector** bucket; `22.7%` is the look-through **name**-axis
coverage stat (`coveragePct`). They are labelled and typeset alike, sit two blocks
apart, and are not comparable quantities.

### 0.2 Sector → constituent symbols is not derivable for fund-held mass

For **directly-held** positions the symbol is available today. The leaf's sector
accumulation (`etf-look-through.ts:642`, `:931`) has `pos.ticker` and the bucket
in scope; it simply doesn't retain the pairing.

For **fund-attributed** mass the symbols do not exist and cannot be derived under
the current methodology. Decision 7 (`etf-look-through.ts:35-37`) is explicit: the
sector axis comes from *the fund's own reported sector allocation*, never
per-constituent classification. `fp.sectors` (rows of `{sector, weight}`) and
`fp.constituents` (rows of `{ticker, weight}`) are two independent, unlinked
fields of the stored profile. Nothing joins "SPY contributed 9.2% to Technology"
to any particular ticker.

Deriving it would mean classifying every constituent of every fund and rebuilding
sectors bottom-up. That (a) reverses Decision 7, (b) needs sector classifications
for hundreds of tickers `app.instrument_classifications` has never seen — each a
lazy external fetch, and (c) produces a sector total that *disagrees with the
fund's own reported allocation*, i.e. two sector numbers for the same fund. That
is the disease this redesign exists to cure, not a cure for it.

**So the honest drill-down is sector → contributors, not sector → symbols.**
Direct holdings itemize by symbol; fund contributions itemize by fund
(`via SPY 9.2%`). That is a strict superset of "which symbols," not a consolation
prize — but the UI must *say* which is which in one line of copy, or the fund rows
read as a missing feature.

### 0.3 The "Effective positions" defect is a label collision

The interval is documented — [`../etf-look-through.md`](../etf-look-through.md)
explains why it is a range rather than a point estimate. Two real problems, both
UI:

1. **No label, units, or explanation at the point of use.** `1.5–338.1` renders
   as a bare string under a bare label.
2. **Label collision, verified.** `health-section.tsx:260` renders
   `label="Effective positions"` for the wrapper-basis point estimate (`1/HHI`,
   `portfolio-health.ts:475`); `health-section.tsx:430` renders
   `label="Effective positions"` for the look-through interval. Same label,
   twice, in one scroll, measuring different things on different bases with wildly
   different values and nothing to distinguish them.

The user read the label literally and objected: *"I do want to know how much of
each stock I own, regardless if it's in an ETF or directly owned across multiple
accounts."* That is a completely reasonable thing to want from something called
"effective positions" — and it is **not what inverse-HHI measures**. Their stated
need is served by the effective-names table (§4.2), which is why §4.1 cuts the
metric rather than explaining it.

### 0.4 The look-through name table has no account provenance

Verified, and now a first-class requirement rather than a nicety.

- `LookThroughPositionInput` (`etf-look-through.ts:182-188`) carries `ticker`,
  `assetType`, `assetClass`, `marketValue`, `sectorBucket` — **no accounts**.
- `portfolio-health.ts:397-403` builds it from `[...merged.values()]`, which is
  already ticker-merged across accounts. So the **"how much" is correct across
  accounts today** — `EffectiveNamePosition.marketValue` is the household total.
- But `m.accounts` — in scope on the very same line — is dropped at the leaf
  boundary. `EffectiveNamePosition.sources` carries `{from, marketValue}` only.

Net: the look-through table answers *how much* ✓ and *through which wrapper* ✓,
and cannot answer *in which account* ✗. The wrapper-basis `TopPositions` table
does have per-account expand (`HealthPosition.accounts`), so the capability exists
on the other basis and is simply absent here. §4.2 and §7 specify the fix.

### 0.5 Reading order, and a named spec revision

The look-through section currently renders **above** the wrapper-basis sector
panel (`health-section.tsx`: block 2b at `:303`, block 3 at `:309`). The page
already interleaves the two bases, which is part of why they read as competing.

**Decision 2** of the look-through spec kept the wrapper basis permanently
untouched with look-through strictly additive. This design **revises it for the
sector axis**: there will be one sector panel, on the look-through basis.

Justification. Decision 2 protected the honesty invariants — no renormalization,
explicit residual, lower-bound framing — by *physical separation*. Separation was
a proxy for the requirement, not the requirement. The unified design enforces the
same invariants **structurally**: the residual is a bar on the axis, so the axis
cannot be read without reading the residual. That is strictly stronger than a
separate panel a reader can scroll past. Decision 2 also cost the thing the
feature was built for — a single answer to "what is my exposure across the entire
portfolio."

Decision 2 stays in force everywhere else: `PortfolioHealth`'s wrapper-basis
fields keep their exact meaning, the analysis pipeline's deterministic sizing
gates stay wrapper-basis, and `lookThrough` stays a two-state read.

---

## 1. Design principles for this view

Six rules. Every element below traces to one.

**P1 — One question, one axis, one denominator.**
The view answers *"how much do I own, and where?"* There is one sector axis, in
`% of invested NAV`, and it sums to 100%. If a number on screen doesn't
participate in that sum, it is not on that axis.

**P2 — The unknown is a first-class bar, never a gap.**
Uncovered mass renders at true size on the same scale as everything else. Never
renormalized, never distributed pro-rata across sectors, never left as the silent
difference between a total and its parts. The user should be able to point at the
unknown.

**P3 — Every sector bar reads "at least."**
This is a lower bound. A sector at 8% might be 8%, or might be 30% once the
residual resolves. The residual bar beside it *is* the disclaimer; copy only names
what the geometry already shows.

**P4 — Distinguish "can't" from "haven't yet."**
Three reasons mass is unattributed — permanent policy exclusion (bond ETFs,
mutual funds, leveraged funds, fund-of-funds), a fetch that hasn't happened yet,
and a data-quality problem. They demand three different reactions: accept it, come
back later, possibly report it. Today they are visually identical.

**P5 — Progress is visible, not alarming.**
Coverage climbs across visits (`ETF_PROFILE_MISS_CAP = 5`, in
[`app/api/portfolio/etf-profiles/route.ts`](../../app/api/portfolio/etf-profiles/route.ts)).
Low coverage must read as *in progress, with a known ceiling* — never as *broken*,
never as *your portfolio is dangerous*. And it must stop implying progress once
only permanently-excluded funds remain.

**P6 — Diagnostic, never a gate.**
Look-through is a read, not an input to sizing. The view must never adopt the
visual language of a policy violation.

### What the view must never imply

| Must never imply | Mechanism that prevents it |
|---|---|
| Attributed sectors are the whole picture | residual bar on the same axis (P2) |
| A sector bar is an upper bound | "at least" framing + residual adjacency (P3) |
| Low coverage means something is wrong | neutral residual color, no warning ramp (P5) |
| Coverage will eventually reach 100% | residual splits out the permanent segment (P4) |
| A non-firing flag is a clean bill of health | lower-bound line moved above the numbers (P3) |
| This changes how positions get sized | scope footnote retained (P6) |

---

## 2. The unified sector-exposure panel

### 2.1 Options considered

**Option A — one stacked bar per sector: attributed vs still-opaque.**
**Rejected on arithmetic grounds.** The residual is *not decomposable by sector*.
That is the whole point — if we knew which sectors the unattributed fund mass sat
in, it wouldn't be residual. Drawing an opaque segment on each sector's bar
requires allocating the unknown across sectors, almost certainly pro-rata. That is
renormalization wearing a different hat, and it is precisely the 7%→27% inflation
the methodology doc cites. This isn't a tradeoff; it's unimplementable without
lying.

**Option B — a segmented control toggling between bases.**
**Rejected.** See §2.5 for the honest accounting of what dropping the wrapper
panel costs and how that value is preserved without a mode switch.

**Option C — a nested / expandable hierarchy.**
**Accepted as the drill-down layer, not the top-level structure.** A hierarchy
answers "what's inside this bar" and does not answer "does this add up." Used for
§3.

**Option D — a two-layer bar with a hatched / de-emphasized residual segment.**
**Right instinct, wrong altitude.** De-emphasizing the residual is correct;
applying it per-sector is Option A's arithmetic problem. Applied to the *axis* —
one residual bar, de-emphasized, terminal — it is the recommendation.

### 2.2 Recommendation — "one axis, explicit residual"

A single sector panel in three parts:

1. **A coverage meter** across the top — attributed vs not, one ratio against
   100%, stated in both percent and dollars.
2. **The attributed sector bars**, sorted by weight, all in the accent hue, each
   expandable to its contributors.
3. **A terminal residual bar**, always last regardless of size, split into *won't
   decompose* and *not yet attributed*, expandable to the funds grouped by reason.

The axis sums to exactly 100% of invested NAV. The residual bar is the successor
to the wrapper basis's `Funds (no look-through)` bucket: at 0% coverage the
residual bar *is* that bucket; as coverage climbs it shrinks toward the
policy-excluded floor. **The residual bar visibly shrinking across visits is the
convergence indicator** — no separate progress UI is needed.

Why this wins:

- **P1 by construction.** One denominator, one axis, closes to 100%.
- **P2 structurally, not by convention.** The sectors cannot be read without
  seeing the unknown; they are the same object.
- **P4 in the geometry.** The permanent segment is a visible floor — the user can
  *see* that coverage will never reach 100%, and where it stops.
- **Degrades cleanly.** A book with no funds produces zero residual and a panel
  identical to today's wrapper view. A book at 0% coverage produces one full-width
  residual bar — today's "Funds" bucket, correctly labelled for the first time.

### 2.3 Wireframe — the unified panel

```
┌──────────────────────────────────────────────────────────────────────────┐
│ SECTOR EXPOSURE — % OF INVESTED NAV                                       │
│ A lower bound. Uncovered fund weight is shown below as a residual,        │
│ never redistributed across sectors.                                       │
│                                                                           │
│  Seen inside  ██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   22.7%   │
│  $341k of $1.50M invested · $271k never decomposes · $669k pending        │
│                                                                           │
│  Technology     ████████████████████████████████████        14.2%   ▸    │
│  Financials     ████████████████████                         8.9%   ▸    │
│  Health care    ██████████████                               6.1%   ▸    │
│  Industrials    █████████                                    4.0%   ▸    │
│  Energy         ████                                         1.8%   ▸    │
│  Consumer disc. ███                                          1.4%   ▸    │
│  Unclassified   ██                                           0.9%   ▸    │
│  ──────────────────────────────────────────────────────────────────────  │
│  Not attributed ▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   62.7%   ▾   │
│                 └─ won't ──┘└──── not yet attributed ─────┘              │
│                    18.1%              44.6%                              │
│                    $271k              $669k                              │
│                                                                           │
│  This read does not change position sizing in analysis runs.              │
└──────────────────────────────────────────────────────────────────────────┘
```

Reading order is deliberate and top-down: **how complete → what we know → what we
don't → what it isn't for.** The lower-bound sentence sits *above every number it
qualifies*. The scope note stays at the bottom — it is a scope statement, not a
reading instruction, and splitting today's single trailing paragraph by function
is the whole fix.

Dollar figures accompany every percent, per settled decision 5 (§8). "How much I
own" is a dollar question first.

### 2.4 The residual bar, expanded

```
│  Not attributed ▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   62.7%   ▾   │
│    ┌───────────────────────────────────────────────────────────────────┐ │
│    │ ◇ Won't decompose — by design                    18.1%    $271k   │ │
│    │   Bond funds       BNDX GBIL LQD SCHP SHY SHYG TLT VCSH VWOB      │ │
│    │   Mutual funds     VTSAX VFIAX                                    │ │
│    │   Leveraged        TQQQ                                           │ │
│    │   These never decompose. Coverage will not exceed 81.9%.          │ │
│    │                                                                   │ │
│    │ ○ Not fetched yet                                12.4%    $186k   │ │
│    │   IEFA IEMG ACWX                                                  │ │
│    │   5 fund profiles fetch per visit — reload to see more.           │ │
│    │                                                                   │ │
│    │ ⚠ Data incomplete                                10.2%    $153k   │ │
│    │   VXUS  holdings 26.0% covered, floor 85%                         │ │
│    │   SCHF  sector data malformed (declared 92% ≠ 71% summed)         │ │
│    │                                                                   │ │
│    │ · Unreported by funds we did read                22.0%    $330k   │ │
│    │   Foreign lines, futures and cash inside funds we could read.     │ │
│    └───────────────────────────────────────────────────────────────────┘ │
```

Four groups, each with an icon + label so identity never rests on color alone,
each with its own mass in both units, and — critically — **each with its own line
about what the user should do**: nothing, come back later, maybe report it,
nothing. That replaces the run-on sentence with structure rather than wrapping it
in a nicer box.

The fourth group is not bookkeeping filler. `sectorResidual` includes the
within-fund unreported remainder of funds we *did* attribute
(`(1 - actualSectorSum) * mv`, `etf-look-through.ts:942`), which is not any fund's
opacity. It is derived as
`sectorResidual − Σ(policy) − Σ(pending) − Σ(data-quality)` and closes the group
arithmetic exactly. Omitting it would leave the groups not summing to their own
bar — reintroducing the original sin one level down.

### 2.5 No basis toggle — and what that costs

**Settled: no toggle, no segmented control, one view.** The wrapper-basis
`SectorExposure` component is deleted alongside `LookThroughSectors`.

But dropping it costs two real things, and both need answers rather than silence:

**Loss 1 — the consolidated fund list.** Expanding the wrapper basis's
`Funds (no look-through)` bucket is currently the only place that lists *every*
fund the household holds with its size.

**Loss 2 — the statement-basis reconciliation read.** The wrapper basis is what
the brokerage reports: observed, not derived. Some questions ("does this match my
statement?") can only be answered there.

**How both are preserved without a mode switch:**

Every fund still appears somewhere in the unified panel with its mass —
attributed funds under the sectors they contribute to (§3's contributor
drill-down), unattributed funds under the residual (§2.4). Nothing vanishes; it is
reorganized by what it tells you.

For the consolidated list and the statement read, the right home is the
wrapper-basis **`TopPositions`** table, which this redesign does not otherwise
touch: it already shows positions by exposure weight *including funds*, with
per-account expand, on the observed basis. It has one defect —
`health-section.tsx:596`, `.slice(0, 10)`, the **same silent truncation** as the
look-through table. Fixing that (residual + total footer, plus a "show all"
expansion) restores both losses for a 44-fund book, in the component where fund
sizes and account provenance already live, at a fraction of a mode switch's cost.

That is the minimum honest preservation: no parallel view, no mode, one existing
table made complete.

---

## 3. Drill-down: sector → contributors

The user's ask, answered as honestly as the data allows (see §0.2).

```
│  Technology     ████████████████████████████████████        14.2%   ▾    │
│    ┌───────────────────────────────────────────────────────────────────┐ │
│    │ Held directly                                                     │ │
│    │   NVDA                                        3.1%      $46,200   │ │
│    │   MSFT                                        1.9%      $28,400   │ │
│    │   AAPL                                        1.2%      $17,900   │ │
│    │                                                                   │ │
│    │ Via funds                                                         │ │
│    │   VTI                                         4.8%      $71,600   │ │
│    │   SPY                                         2.4%      $35,800   │ │
│    │   QQQ                                         0.8%      $11,900   │ │
│    │   Funds report a sector total, not which holdings are in it.      │ │
│    └───────────────────────────────────────────────────────────────────┘ │
```

Two groups, because there are genuinely two kinds of contributor carrying
different confidence. Direct rows are *observed*: this symbol, this sector, this
value. Fund rows are *the fund's own stated allocation* — we know VTI put 4.8% of
NAV into Technology; we do not know which of its holdings did it. The one-line
note is what keeps "via VTI 4.8%" from reading as a missing symbol list.

The residual bar's expansion (§2.4) uses the same disclosure idiom at the same
indentation, so the axis has exactly one interaction model.

**Data required — one additive leaf field:**

```ts
export type LookThroughSectorBucket = {
  bucket: string;
  marketValue: number;
  pct: number | null;
  /** Who put mass in this bucket. `from` is "direct" for a directly-held
   *  position (and `ticker` names it), or a fund ticker for a slice
   *  attributed through that fund's own reported sector allocation (and
   *  `ticker` is null — the fund reports a sector total, not which of its
   *  constituents produced it; Decision 7). Mirrors
   *  `EffectiveNamePosition.sources` field-for-field. */
  contributors: Array<{ from: string; ticker: string | null; marketValue: number }>;
};
```

Both accumulation sites already have everything in scope —
`etf-look-through.ts:642` (`add(sectorMass, bucket, mv)`, direct, with
`pos.ticker` in hand) and `:931` (`add(sectorMass, s.sector, slice)`, fund, where
`pos.ticker` is the wrapper). It is the `sources` pattern already proven on the
name axis, so it reads as a familiar addition rather than a new concept.

---

## 4. Element-by-element treatment

### 4.1 The stat row

Current: `Name coverage` · `Sector coverage` · `Effective largest name` ·
`Effective positions` — four tiles of equal weight, two of which are coverage
percentages that look comparable but gate different axes, and one of which
collides by label with a different statistic elsewhere on the page (§0.3).

| Element | Verdict | Treatment |
|---|---|---|
| Name coverage | **Promote and move** | Becomes the meter above the effective-names table (§4.2). It governs that block; it does not belong in a generic tile row. |
| Sector coverage | **Promote and move** | Becomes the meter at the top of the unified sector panel (§2.3). Same reasoning. |
| Effective largest name | **Keep** | Relabel `Largest effective name`, value prefixed `at least`: `NVDA · at least 7.4%`. It is directly comparable to the wrapper row's `Largest name`, and that comparison is the feature's headline. |
| Effective positions (interval) | **Cut — settled** | See below. |

**Cutting "Effective positions" — settled decision.** This reverses the review
round that surfaced it, so the argument stands on its own:

1. **It collides.** Verified: `health-section.tsx:260` and `:430` both render
   `label="Effective positions"`, as a point estimate and an interval, on
   different bases, in one scroll.
2. **The user read the label literally and wanted something else.** *"I do want to
   know how much of each stock I own, regardless if it's in an ETF or directly
   owned across multiple accounts."* Inverse-HHI does not measure that. A label
   that reliably makes people expect a different quantity is a defective label,
   and the quantity they expect already has a home (§4.2).
3. **At low coverage the interval has no reading.** `1.5–338.1` spans two orders
   of magnitude. Its content is "coverage is too low to say anything about
   diversification" — which the coverage meter says directly, in the user's own
   units, without requiring knowledge of what inverse-HHI is.
4. **A stat tile is for a value you act on.** An interval whose *width* is the
   message is not that form; rendered as bare text it reads as a bug, which is
   exactly what happened.

It stays in the leaf and in the analysis prompt block
([`flows/analysis/lib/format.ts`](../../flows/analysis/lib/format.ts)), where a
model can reason with the width. It does not appear on screen.

Resulting row after the moves — three tiles, three distinct questions, no
collisions:

```
│ EFFECTIVE EXPOSURE — SEEING INSIDE FUNDS                                  │
│                                                                           │
│  NVDA · at least 7.4%        22.7%                 $341k                  │
│  Largest effective name      Name coverage         Seen inside            │
```

### 4.2 The effective-names table — the canonical "how much do I own, and where"

**This table is the answer to the user's actual question.** Not the sector panel,
and definitely not a diversification statistic. It must say, for any symbol: *how
much of it do I own in total, through which wrappers, and in which accounts.*
Everything below follows from treating that as the requirement.

The "how much" half is already correct and worth stating plainly: the leaf
receives ticker-merged positions (`portfolio-health.ts:397`), so
`EffectiveNamePosition.marketValue` **already aggregates across every account and
every wrapper**. The number is right today. What's missing is that the user can't
see the truncation, can't see which accounts, and can't see the direct-vs-fund
split at a glance.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Ticker            Effective weight     Value      Composition   Where     │
├───────────────────────────────────────────────────────────────────────────┤
│ ▾ NVDA                     7.4%      $111,000     ███████▏▏▏    3 sources │
│     Direct · Taxable       3.1%       $46,200                             │
│     via VTI · Taxable      2.9%       $43,500                             │
│     via QQQ · Roth IRA     1.4%       $21,300                             │
│ ▸ AAPL                     4.1%       $61,500     ██▏▏▏▏▏▏      5 sources │
│ ▸ MSFT                     3.9%       $58,500     ▏▏▏▏▏▏▏▏      3 sources │
│ ▸ AMZN                     2.2%       $33,000     ▏▏▏▏▏▏        2 sources │
│   …                                                                        │
│ ▸ META                     0.6%        $9,000     ▏▏▏▏          1 source  │
├───────────────────────────────────────────────────────────────────────────┤
│   + 214 smaller names      6.1%       $91,500                             │
│   Not attributed to a name 77.3%    $1,159,500    ▸ why                    │
│   Total                  100.0%     $1,500,000                            │
└───────────────────────────────────────────────────────────────────────────┘
       █ held directly   ▏ via funds
```

Changes, in priority order:

- **Residual + total footer.** Three rows: the tail (`Σ` of ranks 11..end), the
  unattributed remainder (`residual.sharePct`), and a total reading exactly
  `100.0%`. The "broken math" perception dies here — the table closes. The `▸ why`
  links to the same grouped disclosure as §2.4. *This is the highest
  value-per-line change in this document.*
- **Account provenance in the expansion — now a first-class requirement.** Each
  expanded row is one line per `(wrapper × account)` pair: `Direct · Taxable`,
  `via VTI · Taxable`, `via QQQ · Roth IRA`. Flat, one level of expand, matching
  the disclosure idiom used in three other places in this pane. The pair is what
  answers "and where" completely — which wrapper *and* which account, in one row.
- **Value column in dollars.** "How much do I own" is a dollar question first, a
  percent question second.
- **Every row expands.** Today `multi` gates both the chevron and the click
  handler (`health-section.tsx:508-513`), so single-source rows are inert to a
  click that looks available on the row above. One row's expansion is a fine
  expansion, and it now carries account detail that single-source rows also have.
- **Composition mini-bar.** Two segments — held directly vs via funds — derived
  from `sources` with no leaf change. This is the feature's thesis made visible:
  the same name owned both ways. Thin, a 2px surface gap between segments, no
  border, one legend beneath the table.

Keep 10 visible rows. The residual row is what makes truncation honest; showing
more rows is not.

**Data required for account provenance.** Two additive leaf changes:

```ts
// input — the caller already has this in scope at portfolio-health.ts:397 (`m.accounts`)
export type LookThroughPositionInput = {
  // …existing fields…
  accounts: ReadonlyArray<{ accountId: string; label: string; marketValue: number | null }>;
};

// output
export type EffectiveNamePosition = {
  // …existing fields…
  sources: Array<{
    from: string;             // "direct" | fund ticker
    accountId: string;
    accountLabel: string;
    marketValue: number;
  }>;
};
```

For a **direct** holding the split is the position's own per-account values. For a
**fund** slice the split is pro-rata across the accounts holding *that fund*, by
that fund's per-account market value — **exact, not an estimate**: if SPY is 60/40
across two accounts, SPY's Apple slice is 60/40 across the same two.

**Why the leaf and not the component.** The join is technically possible
component-side (`health.positions` carries `.accounts` for both the name and the
fund). But it is pro-rata money math over two joined datasets, and this codebase's
discipline puts money math in the pure, unit-testable leaf rather than in a view
that renders it. Doing it component-side would also duplicate the leaf's own
fund/not-fund judgment. It belongs in Phase 2.

### 4.3 Opaque-fund reporting

Replaced entirely by the residual bar's grouped disclosure (§2.4). The
free-standing `OpaqueFunds` paragraph is deleted, not restyled.

Grouping is by **reason class**, not by axis. Axis (`names` / `sectors` / `both`)
is a methodology detail; the user's question is "can this improve?" Axis survives
as a per-row suffix inside the data-quality group, where it is genuinely
diagnostic.

### 4.4 Flags

Keep the current chip treatment — restrained and correct for P6. Two changes:

- The `(look-through)` suffix stays and is load-bearing: it is the only thing
  distinguishing these chips from the wrapper-basis chips a block above. Consider
  a leading glyph so identity doesn't depend on reading to the end of the chip.
- Alert vs warn is currently carried by color plus literal `(alert)` / `(warn)`
  text, which already satisfies "never color alone." Adding the `⚠` icon on alert
  completes the status-token contract.

### 4.5 Lower-bound framing

Split today's single trailing paragraph by function:

- **Reading instruction → panel subtitle**, above every number it qualifies: *"A
  lower bound. Uncovered fund weight is shown below as a residual, never
  redistributed across sectors."*
- **The non-obvious corollary → the residual bar's caption/tooltip**: *"A flag
  firing above is trustworthy. A flag not firing is not a clean bill of health —
  the unattributed remainder could hide more."*
- **Scope note → stays as the footnote**: *"This read does not change position
  sizing in analysis runs."*

---

## 5. Empty, partial and converging states

Under unification the sector panel **always renders**. Today it is gated on
`lookThrough === "partial"` (`health-section.tsx:303`), so at 0% coverage the user
sees the old Funds bucket with no explanation at all — the worst state getting the
least information.

Coverage is stated in money throughout, per settled decision 5 (§8).

| State | Meter | Residual bar | Caption | Tone |
|---|---|---|---|---|
| No funds held | 100% | absent | *(none)* | silent — nothing to explain |
| Funds held, 0% attributed | 0% | full width | `$0 of $1.50M seen inside · 5 profiles fetch per visit — reload to improve` | informational |
| 22% — the real book | 22.7% | dominant | `$341k seen inside · $271k never decomposes · $669k pending` | informational |
| 80% | 80% | small | `$1.20M seen inside · $271k never decomposes` | informational |
| Ceiling reached | e.g. 81.9% | policy segment only | `Fully attributed except $271k in funds that never decompose by design` | **complete, not pending** |
| Quota exhausted | as-is | as-is | `Daily data budget used — more funds resolve tomorrow` | informational |

Two things this encodes that the current UI gets wrong:

- **The ceiling state must change register.** Once only policy-excluded funds
  remain, every "reload to improve" affordance disappears and the language turns
  terminal. Continuing to imply progress after progress has stopped is precisely
  how an honest partial-coverage UI becomes a dishonest one.
- **No state uses warning color.** Low coverage is not a fault condition (P5). The
  only warning-toned elements in this design are the data-quality group inside the
  residual disclosure and the concentration alert chips.

---

## 6. Visual encoding

The surface is a terminal-ish dark UI on OKLCH tokens
([`app/globals.css`](../../app/globals.css)): 10–11.5px type, mono for figures,
`tracking-wider` uppercase section titles in `--c-fg-faint`, 12px (`h-3`) bars
with `rounded-sm` on `--c-surface-2` tracks. Conformance beats taste — the design
keeps all of it.

### 6.1 Color roles

Sector buckets are **nominal categorical**: swapping their order changes nothing.
Nominal bars take the *same* single hue — one series, no legend box, the title
names it. The current code already does this (`--c-accent` on every bar) and it
stays. Explicitly do **not** give each sector its own hue: there are more than
eight GICS sectors, and coloring bars by value would double-encode what bar length
already shows.

| Role | Token | Rationale |
|---|---|---|
| Attributed sector bar | `--c-accent` | one series, one hue, every bar |
| Coverage meter fill | `--c-accent` | same hue — the meter *is* the axis total |
| Coverage meter track | `--c-surface-2` | existing bar-track convention |
| Residual — won't decompose | `--c-fg-faint` | de-emphasis; a known, accepted absence |
| Residual — not yet attributed | `--c-fg-faint` at ~55% opacity | one step lighter, same family; the difference is ordinal (permanent → pending), so a lightness step, not a second hue |
| Data-quality group marker | `--c-warn` + `⚠` | status token; icon + label mandatory |
| Concentration alert chip | `--c-warn` (existing) | unchanged |
| All labels, values, legends | `--c-fg` / `--c-fg-muted` / `--c-fg-faint` | text never wears the data color |

**Two deliberate departures, argued rather than drifted into:**

1. **The coverage meter does not ramp to warning at low fill.** The usual meter
   convention has fill carry severity (accent → warning → danger). Here low
   coverage is not severity, it is incompleteness, and a warning ramp would assert
   that 22% coverage is dangerous. P5 forbids exactly that. Fill stays
   `--c-accent` at every level.
2. **No texture on the residual.** Hatching would read naturally as "unknown
   region," but texture is reserved for accessibility, print and `forced-colors`,
   never a default channel. The label does the work instead; 45° hatch remains the
   `forced-colors` / print fallback, which is its sanctioned use.

**Validation.** This palette is two hues wide (one accent, one gray) plus reserved
status tokens, so multi-series categorical checks do not bind — there is no
series-identity encoding anywhere in the design. What does need checking before
ship: `--c-warn` and `--c-fg-faint` at 55% opacity against `--c-surface`, in both
themes, at 3:1 for marks. Check the resolved OKLCH values with a contrast
validator rather than by eye, in both light and dark.

### 6.2 Marks

- **Bars** keep `h-3` / `rounded-sm` to match the existing `Bar` and
  `SectorExposure` components. Consistency with the surrounding pane wins over
  importing a radius the rest of the app doesn't use.
- **The residual bar's two segments carry a 2px gap in the surface color**, not a
  border. This is the one mark rule worth importing: the segments read as distinct
  without adding ink, at zero cost.
- **The residual bar is separated from the sector bars by a hairline rule and
  ~6px of space.** Same axis, but not a sector — the rule says so without
  introducing a second scale.
- **The residual bar is pinned last**, always, regardless of magnitude. At 62.7%
  it would otherwise sort to the top and dominate the panel, overstating a
  boundary-of-knowledge as if it were the leading exposure.
- **Values right-aligned `tabular-nums`** in the existing `w-14` column; meter and
  stat-tile values use proportional figures.
- **No gridlines.** Every bar is directly labelled; a grid would add ink without
  adding a reading.

### 6.3 Interaction

- Hover on any bar shows exact value, contributor count, and for the residual the
  group breakdown. Tooltips enhance and never gate — every value is also directly
  labelled or present in a disclosure.
- Disclosure rows are buttons with a ≥24px hit area, keyboard-focusable, using the
  `▸`/`▾` affordance the pane already uses in three places.
- Single-open disclosure per axis (the existing `expanded: string | null` idiom),
  so panel height stays predictable.

---

## 7. Phased implementation plan

### Phase 1 — presentation fixes, no leaf change

**Files:**
[`components/portfolio/health-section.tsx`](../../components/portfolio/health-section.tsx)
only.
**New data from the leaf:** none.
**Effort:** ~half a day.

1. Effective-names table: residual + tail + total footer rows, value column in
   dollars.
2. Sources column shows identity, not a count; expand available on every row.
3. `TopPositions` gets the same residual + total footer and a "show all"
   expansion — this is what preserves the consolidated fund list and the
   statement-basis read once the wrapper sector panel goes away (§2.5).
4. `OpaqueFunds` regrouped into the three reason classes, collapsible.
5. Lower-bound sentence moved above the numbers; scope note stays below.
6. `Effective positions` removed from the stat row (§4.1).

On (4): reasons can be classified **without** string-fuzzing in most cases,
because the policy reasons are exported constants comparable by identity —
`MUTUAL_FUND_ATTRIBUTION_SUPPRESSED_REASON`,
`FIXED_INCOME_ATTRIBUTION_SUPPRESSED_REASON`,
`CONSTITUENT_EVIDENCE_UNAVAILABLE_REASON` — plus exact matches on
`"no stored profile"`, `"quota"`, `"transient"`, `"leveraged/inverse fund"`,
`"ineligible"`, `"malformed"`, `"not_an_etf"`. Only the two parameterized reasons
(`"holdings data incomplete (…)"`, `"sector data malformed (…)"`) need a prefix
match. **This is interim and must be marked as such in the code** — Phase 2
replaces it with a real discriminator. A permanent string-match classifier over
another module's message copy would be its own defect.

Phase 1 delivers most of the perceived-correctness win on its own and is safe to
ship independently.

### Phase 2 — additive leaf fields + prompt block

**Files:**
[`domain/portfolio/math/etf-look-through.ts`](../../domain/portfolio/math/etf-look-through.ts),
[`domain/portfolio/math/portfolio-health.ts`](../../domain/portfolio/math/portfolio-health.ts)
(passes `m.accounts` through),
[`flows/analysis/lib/format.ts`](../../flows/analysis/lib/format.ts), + tests.
**Reopens the already-merged look-through leaf contract — flagged.**
**Effort:** ~1–1.5 days including tests.

| Field | Purpose |
|---|---|
| `OpaqueFund.reasonClass: "policy" \| "pending" \| "data-quality"` | replaces Phase 1's string matching; set at each site where the reason is set |
| `OpaqueFund.marketValue` · `sharePct` | lets the residual bar split by class and state each group in dollars; `mv` is already in scope at every site |
| `LookThroughSectorBucket.contributors[]` | §3's sector drill-down |
| `LookThroughPositionInput.accounts[]` → `EffectiveNamePosition.sources[].accountId/accountLabel` | §4.2's account provenance — the "and where" half of the user's question |

Note there is deliberately **no fund-count field**. Convergence is expressed in
NAV terms throughout (settled decision 5), and the per-fund `marketValue` above is
what makes that possible.

**`format.ts` changes in step** (settled decision 4): `appendLookThroughLines`
describes this axis to the trader and PM. If the UI adopts contributor-level
sector detail, reason-classed residual groups and mass-weighted coverage while the
prompt block doesn't, the two surfaces describe one methodology two ways — the
exact failure this redesign exists to end. Bring it along in the same change set.

All leaf changes are **additive**. Existing consumers —
[`flows/analysis/build-portfolio-context.ts`](../../flows/analysis/build-portfolio-context.ts),
`format.ts`, `portfolio-health.ts` — read named fields only, and none breaks. The
leaf's output is computed per render and never persisted, so no stored-shape
compatibility is engaged.

**Flagged:** this reopens the leaf that merged after 46 review rounds.
**Recommendation: do not add these rounds to that PR.** File a follow-up issue and
land the leaf change on its own branch with its own tests. Phase 1 can ship on the
current PR; Phases 2–3 should not.

### Phase 3 — the unification

**Files:** `health-section.tsx` (a new `SectorPanel` replacing `SectorExposure`
and `LookThroughSectors`), likely split into its own module given the file's size.
**Depends on:** Phase 2's `contributors`, `reasonClass`, `marketValue`.
**Effort:** ~2 days.

1. One `SectorPanel`: meter → attributed bars → residual bar → footnote.
2. Sector → contributor disclosure (§3).
3. Residual → grouped-by-reason disclosure (absorbs Phase 1's `OpaqueFunds`).
4. Panel renders unconditionally, including at `lookThrough: "none"` (§5).
5. Delete `SectorExposure` and `LookThroughSectors`. `FUNDS_BUCKET` remains a
   computed leaf field — still used by the analysis seed — simply no longer
   rendered in the pane.
6. Account-provenance rows in the effective-names expansion (§4.2).
7. Composition mini-bar in the names table.

The look-through *concentration* block (stat row, flags, effective-names table)
stays a distinct block above the sector panel. It is the name axis, and §0.1's
whole point is that name and sector are different axes that must stop being
typeset as though comparable.

### Not in scope

- Renormalizing anything, on any axis, under any circumstance.
- Making look-through move the deterministic sizing gates (a real-money change
  with its own sign-off).
- Per-constituent sector derivation (reverses Decision 7 — §0.2).
- Changing `lookThrough`'s two-state contract.

---

## 8. Settled decisions

Recorded so they are not re-litigated during implementation.

| # | Decision | Rationale |
|---|---|---|
| 1 | **`Effective positions` is cut from the UI.** | Verified label collision (`health-section.tsx:260` / `:430`); the user read the label literally and wanted per-symbol ownership, which inverse-HHI does not measure. Retained in the leaf and the analysis prompt. |
| 2 | **The effective-names table is the canonical "how much do I own, and where."** | It is the only surface that aggregates one symbol across every wrapper and every account. Truncation made honest, account provenance added, dollars shown. |
| 3 | **No basis toggle. One unified sector panel.** | Cleanest solution. The two real losses — the consolidated fund list and the statement-basis read — are preserved by completing the existing `TopPositions` table instead of adding a mode (§2.5). |
| 4 | **`format.ts`'s prompt block changes in step with the UI.** | One methodology, described one way, on both surfaces. |
| 5 | **Coverage and convergence are expressed in NAV terms, not fund counts.** | *"I don't care how many funds it is in, I want to know how much I own and where."* Every coverage figure carries a dollar amount; no `N of M funds` stat. |
| 6 | **Decision 2 is revised for the sector axis only.** | The unified panel enforces the honesty invariants structurally rather than by physical separation, which is strictly stronger (§0.5). Wrapper-basis fields, sizing gates and the two-state `lookThrough` contract are unchanged. |
| 7 | **Phases 2–3 are a follow-up issue, not more rounds on the current PR.** | The leaf merged after 46 review rounds; additive contract changes deserve their own branch, tests and review. |

## 9. To verify before Phase 3

Per §0.1, the code puts both sector panels on one denominator, and
`sectorResidual` already exists and simply isn't rendered. Once the residual is
drawn, **any axis that does not close to 100% is a real defect** — in the leaf or
in the profile map — not a presentation problem. Confirm the unified panel closes
against the live 44-ETF book before building the drill-downs on top of it.
