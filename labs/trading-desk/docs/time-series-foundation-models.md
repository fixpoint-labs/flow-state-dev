# Time-series foundation models: why the desk doesn't use one

Someone will suggest bolting a pretrained time-series forecaster onto the desk to
predict where a stock is going. TimesFM, Chronos, Moirai, TimeGPT — the family
keeps growing and the pitch is always the same: a foundation model that forecasts
any series zero-shot, and we already have OHLCV bars in `lib/providers`, so the
plumbing is nearly free.

We looked at it and said no. This is the record of why, so the question doesn't
get re-litigated from scratch every six months.

## The two reasons, in order of importance

**We can't measure whether it would help.** This is the one that actually decides
it. The desk commits a decision snapshot per run — `finalRating`, `direction`,
`entryPrice`, `stopPrice`, `targetPrice` — and scores itself on two axes:
internal coherence (`eval/invariants.ts`) and reasoning quality, via a blinded
LLM judge (`eval/judge.ts`). Neither one asks whether the call was *right*.
`docs/run-quality-eval.md` is explicit that the suite is "a report card over a
stored run, not a backtest."

The outcome seam exists and is deliberately empty. `decision-snapshot-resource.ts`
declares `outcomeRealizedPrice`, `outcomeAsOf` and `outcomeVerdict`; the only
writer hardcodes all three to `null`. Until something fills them, any forecasting
change ships on vibes. We would have no way to tell an improvement from a
regression, which means we'd have no way to tell a working integration from a
broken one.

**The published evidence is against it anyway.** Out of the box, TimesFM is worse
than guessing on price series. The most serious financial adaptation to date
([arXiv 2412.09880](https://arxiv.org/abs/2412.09880)) reports that baseline
TimesFM "underperforms random chance on 4 out of 7 of the prediction horizons."

That paper then does the expensive part — continual pretraining on ~100K series
and 90M points of Yahoo Finance and Binance data, with a log transform to fix the
scale bias that otherwise blows up the loss. The result on S&P 500, at a 128-day
horizon: Sharpe 1.68, against **1.58 for AR(1)**. It lost to AR(1) on forex and
crypto. The authors' own summary is that they "are unable to ascertain
consistently better performance over just a simple AR1 model."

So the favorable published result, produced by people who paid for the fine-tune,
is a fraction of a Sharpe point over a model you can write in one line. That is
not a foundation for a product claim.

## Why this isn't surprising

Returns are close to unpredictable, and that isn't a modeling failure — it's what
an efficient-ish market means. A bigger model doesn't get you a signal that isn't
in the data. Foundation models earn their keep on series with structure to learn:
seasonality, trend, regime persistence, cross-series regularity. Daily equity
returns have very little of that.

Volatility is a different story. Realized vol is strongly autocorrelated, and
range and volume have real seasonal structure. If a time-series model ever earns a
place in the desk, that is where to look.

## What we'd want instead, if the question comes back

Two conditions, in order. Neither is optional.

1. **Outcome tracking first.** Fill the three outcome fields against a fixed
   horizon and score every committed decision against a naive baseline —
   buy-and-hold over the same window, at minimum. A decision that made money is
   not a good decision if buy-and-hold made more. Without this there is no
   experiment to run, only an opinion to hold.

2. **Then target the distribution, not the direction.** The narrow, checkable
   version is a calibrated prior over *range*, not a call on where the price goes.
   Phase 5a (`forecastStage`) currently has an LLM assigning bull/base/bear
   probability buckets, and that distribution feeds `computeAndStoreRewardToRisk`,
   the stop, and the target. Language models are poorly calibrated at numeric
   distributions, and TimesFM 2.5 emits native quantile forecasts. That is a real
   seam.

   Judge it against GARCH, not against nothing. If it can't beat a volatility
   model from 1986, it isn't earning its dependency.

## What would change this

New evidence that a time-series model beats a naive baseline on *our* corpus,
measured by outcome tracking that exists. Not a benchmark paper, and not a
backtest someone ran on a different universe. Until the desk can score its own
calls, the answer to "should we add a forecaster" stays no, regardless of which
forecaster is being proposed.
