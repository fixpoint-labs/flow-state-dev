# Goal: the desk refuses a non-equity symbol instead of hallucinating

**Contract.** The analyst bench researches equities. A non-equity symbol (a bond
CUSIP, an OCC option, a `BTC-USD` crypto pair, a cash line) sent to `analyze`
must stop cleanly — with an accurate "this is a bond, the bench is equity-only"
message — rather than being run through the equity pipeline and producing a
confident, fabricated stock report. This is the FIX-605 no-hallucination lesson,
extended to asset type by FIX-773.

**Real path.** The check shells `fsdev run analysis analyze --capture --quiet`
on a Treasury CUSIP then `fsdev run analysis runSummary --capture --quiet` from
`labs/trading-desk` (the `verify-trading-desk` two-step). The `checkAssetTypeSupported`
guard runs BEFORE ticker resolution and before any generator, classifying the
symbol by shape (`classify-instrument.ts`, no provider call) — so this drives the
real pipeline entry while spending zero model tokens.

**Pass criterion.** The `runSummary` capture parses with `status === "stopped"`
and `stopReason === "unsupported-asset-type"`. The accurate `stopMessage` naming
the detected asset type is printed.

**Anti-game.** A bogus *equity-shaped* ticker must NOT trip this gate — it
classifies as `equity` and is caught one step later by the resolution guard
instead. The asset-type stop fires only for a symbol whose shape is non-equity.

**Run.** Out of CI, by hand (no model cost — it stops at the gate):

```
pnpm tsx goals/trading-desk-portfolio/gate-non-equity/run.mts
```

## Verdict log

- 2026-06-29 — **PASS**. `912828YK0` (a US Treasury CUSIP) in fixture/fast mode:
  `status: stopped`, `stopReason: unsupported-asset-type`, message "912828YK0
  classifies as a bond — the analyst bench researches equities only."
