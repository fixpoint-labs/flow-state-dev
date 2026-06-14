---
---

Trading Desk: a variable risk-appetite mandate at the decision tier of the
private `@flow-state-dev/trading-desk` example.

The Portfolio Manager now decides "is this risk worth it" against an explicit,
user-selectable standard rather than a fixed house posture. The desk derives a
reward-to-risk figure from the scenario distribution it already produces —
probability-weighted upside over downside, with the downside weighted by the
mandate's loss-aversion — and judges it against the mandate's bar: a minimum
reward-to-risk, a return hurdle, a confidence floor, and a worst-case loss the
book can absorb.

The mandate moves the position **size** and an explicit worth-it **verdict**, not
the rating. The rating stays anchored to the valuation read, so it means the same
thing across books and stays comparable; the appetite axis sits beside the
philosophy (lens) and mechanics (portfolio-fit) axes rather than collapsing into
the rating. A name can be a Buy on its merits and still fail a conservative
mandate, in which case the desk sizes it to a token position and says so. Size is
clamped deterministically — a hard capacity veto for a worst case beyond the
book's tolerance, a softer cap (overridable with a stated reason) when the
worth-it bar is missed — and the mandate only ever reduces size.

Three presets ship (conservative-income, balanced, aggressive-growth). The mandate
is a per-run choice, or a default stored on the account, with the
most-conservative selected-account default binding when no per-run choice is made.

Documented methodology, not financial advice.
