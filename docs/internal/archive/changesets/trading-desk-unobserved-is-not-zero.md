---
---

Trading Desk (FIX-1063): a figure the desk could not obtain is now recorded as
unavailable rather than as zero.

When a data provider didn't return a number, the desk wrote down zero and kept
going — and nothing in a finished report could tell that zero from a real
measurement. This was not a display glitch. A missing market cap entered the
valuation arithmetic as a genuine zero, so enterprise value came out equal to
the company's net debt with the entire equity value silently dropped, and every
enterprise-value multiple then read as radically cheap on a name nobody had data
for.

Several kinds of producer did this, and this release fixes them: the builders
that fire when a provider is completely unreachable; the technical math, which
returned zero for an indicator a stock was too young to support and then
labelled the result a "flat" trend nobody measured; the macroeconomic read,
which answered for some series and published zeros for the rest while still
reporting a live source; the two fundamentals adapters, which filled in zeros
for anything a provider left out of an otherwise-successful answer; and the
insider-transaction feeds, where a filing that carried no price was recorded as
a transaction at $0 — indistinguishable from a genuine grant or gift, where no
cash really does change hands. The fundamentals case is the most common and the
most dangerous — nothing marked the value as missing, because the fetch worked.

This is a pass over the producers behind the report's headline numbers, not a
proof that every figure the desk fetches is now measured. The remaining
adapters are being swept separately.

Daily price bars are part of that last group. A price provider can answer with a
day that has an opening and closing price but no high, low, or volume, and the
desk used to fill those in as zero — a day the stock supposedly traded down to
nothing, on no volume, feeding the price history and every technical indicator
built on it. A day the desk cannot read completely is now left out of the series
rather than invented, and a genuine zero-volume session (a halt, or a name
nobody traded) is kept, because that one is a real reading. A day whose date
itself is missing is left out too — it used to be filed under 1 January 1970 and
kept. And when a provider's answer leaves no readable day at all, the desk now
treats that as the provider having no data and asks the next one, instead of
publishing an empty chart labelled with that provider's name.

Insider filings get the same treatment on direction, not just on price. These
filings say whether an insider acquired or disposed of shares, and a filing that
didn't say was recorded as a disposal — a sale nobody reported. Where the
direction can't be read, the filing is now left out rather than counted against
the name.

A figure the desk genuinely measured at zero is untouched. A company with a real
0% operating margin, a genuine zero return on equity, or no debt keeps its zero;
the rule is "not observed", not "falsy".

Two consequences a reader will notice. Some reports get visibly less confident:
a recently-listed company's report now says the trend could not be read instead
of showing a definite-looking answer. And the desk refuses to add to a position
when it has no market capitalization for the name — more runs land on "don't
add", which is the correct direction to be wrong in for real money.

Reports generated before this change cannot be repaired, because nothing stored
in them separates a missing zero from a measured one. They are marked instead:
new runs record which round of corrections they were produced under, and a
report without that marker now says on its face that it predates the fix. That
warning sits above the report's tabs, so it is visible whether the reader is
looking at the summary or at an individual analyst's memo, and it appears only
once there is a stored report to say it about — a first-time user with no
reports yet is not warned about one. The marker is a version stamp for spotting
old reports — it is not a claim that every number in a current report was
measured.

Internal-only — no publishable package surface changes.
