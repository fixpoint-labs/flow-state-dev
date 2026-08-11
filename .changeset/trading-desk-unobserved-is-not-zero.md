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

Four kinds of producer did this, and all four are fixed: the builders that fire
when a provider is completely unreachable; the technical math, which returned
zero for an indicator a stock was too young to support and then labelled the
result a "flat" trend nobody measured; the macroeconomic read, which answered
for some series and published zeros for the rest while still reporting a live
source; and the two fundamentals adapters, which filled in zeros for anything a
provider left out of an otherwise-successful answer. That last one is the most
common and the most dangerous — nothing marked the value as missing, because the
fetch worked.

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
new runs carry a stamp recording that they were produced under the honest rule,
and a report without that stamp now says on its face that it predates the fix.

Internal-only — no publishable package surface changes.
