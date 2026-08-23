---
---

Trading Desk (FIX-1113): a company's figures now all describe the same financial
year, and the desk says which year that is.

When the desk reported a company's revenue, cash, debt and equity as one set of
figures, it had not checked that they described the same year. Each figure was
looked up on its own and took whatever that particular line item had most
recently reported. Put four such figures in a ratio and the answer could be one
year's profit over another year's assets, printed under a single date.

The cause was the index the desk used to keep figures together. It used the
regulator's fiscal-year field, which records the year of the *filing*, not the
year the number describes — so last year's comparative figures, republished
inside this year's annual report, carried this year's label. In the repository's
own Apple filing that collides one period into another across fifteen of sixteen
line items, and collapses three separate years of revenue into a single label,
silently discarding two of them.

The desk now picks one financial year first — the most recent year any core
figure reports — and reads every figure at that exact year-end. A figure the
company did not report for that year comes back as absent, the way an unreported
figure already did; it is never quietly filled in from a neighbouring year. Each
statement states the one date its figures were read at. The fiscal-year index is
gone rather than repaired: the correct index, keyed on the exact period-end date,
was already in the codebase and is now the only one.

Two related fixes come with it. The balance sheet is read at the same year-end as
the profit figures, so a full year of earnings is no longer paired with whatever
quarter was filed most recently — that makes cash, debt and equity up to nine
months older than a company's latest quarterly report, which is the deliberate
price of every ratio built on them describing one year. And anything comparing
two periods — year-over-year growth, the change-based quality scores — now
requires two genuinely consecutive periods, so a company with a gap in its filing
history shows no growth figure rather than a two-year change labelled as one
year's.

Above that, the desk now detects when its three statements cannot be placed at
one period at all. Each statement is fetched through its own chain of sources, so
one can come from the regulator's filings while another falls back to market
data. When they disagree, every figure built across two statements is withheld
rather than computed across years, and the report says so. Two limits are worth
knowing. The desk detects an incoherent set and withholds; it does not rebuild a
coherent one, so a messy filer loses its cross-statement figures rather than
having them recomputed. And the check covers the sources actually consulted — a
source that answers completely means a fresher year at a later source is never
looked for.

The published rating is deliberately **not** withheld. It comes from the model
and is normally bounded by a deterministic calculation; withholding that
calculation removes the bound, not the rating. So the rating still publishes, and
is marked on the report as carrying no deterministic bound, with the disagreeing
dates named. Reports run before this change are left as they were and are not
recomputed, so two reports on the same company can differ by when they were run.

The effect is concentrated on companies whose filings are irregular — a company
that reports every line item every year sees no change at all. The honest summary
is that the figures shown are true, and on some companies fewer of them are
shown.
