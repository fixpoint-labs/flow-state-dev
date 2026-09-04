---
---

Trading Desk: surface the portfolio-fit verdict and the investor-lens
convergence signal in the report UI of the private
`@flow-state-dev/trading-desk` example.

The at-a-glance Summary now shows a portfolio-fit weight before/after block
(current → target weight, the action, the validated suggested account, and the
snapshot as-of) and a lens-convergence card, both read straight from the stored
Portfolio Manager memo and both omitted cleanly when a run had no portfolio or
skipped the lens pack on the `fast` preset.

Each investor lens also renders as its own card in the report — the documented
methodology it applies, its stance and conviction, its one-line verdict, and an
honest "missing data" line when it lacked a metric it would normally use. The
forensic-skeptic lens is marked as a structural skeptic so its by-design dissent
reads as expected, not as alarming divergence.

These are read-only views over data the analysis already produced — no new
numbers are computed in the browser, convergence stays deterministic, and the
framing remains documented methodology, not financial advice.
