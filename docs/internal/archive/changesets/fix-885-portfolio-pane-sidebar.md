---
---

Trading Desk: the Portfolio pane is now perspective-switched (FIX-885). A
sidebar — a left rail on desktop, a segmented strip on phones — picks between
**Accounts** (the existing card grid + account drill-in, unchanged) and a new
**Gains & Taxes** perspective: current-year and lifetime realized totals, the
relocated tax-estimate card, and a household year-by-year realized view spanning
every account (the FIX-874 data, previously only visible per account). The
portfolio totals and price-provenance line stay pinned across perspectives, and
the section list is the extension point the FIX-762 household health view lands
on.

Follow-up refinements: account-management actions (add account, imports, add
transaction, backfill splits) moved off the always-visible toolbar into the
Accounts perspective, with the three import paths grouped under one **Import**
menu. The Gains & Taxes realized view became **year cards you drill into**, with
a toggle between **Capital gains** and **Total realized income** (capital gains
+ dividends + interest) by year — the income-by-year figures the tax route
already computed are now surfaced. Internal lab / private example — no public
API.
