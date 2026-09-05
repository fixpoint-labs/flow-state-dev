---
---

Internal only (no publishable package changed): trading-desk lab app gains a
bounded critical-financials recovery path (FIX-898). When SEC EDGAR companyfacts
and Yahoo both miss the valuation-critical statements for a newly listed issuer,
the desk now discovers S-1 / 424B* prospectus primaries, extracts and
hard-validates typed statements (identity / period / scale / reconciliation),
and promotes them onto the financials spine tagged `edgar-prospectus` in USD
billions — or keeps `unavailable` with an explicit `recoveryAudit` trail. All
changes are confined to `labs/trading-desk` and `goals/`.
