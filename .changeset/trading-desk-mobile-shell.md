---
---

Trading Desk: the private `@flow-state-dev/trading-desk` lab is now usable on
phones. Below 1024px the desk swaps to a dedicated mobile shell — a bottom tab
bar (Report · Transcript · New · Portfolio · History), one full-width
vertically-scrolling surface at a time, the memo navigator as a slide-in
drawer, holdings as stacked cards instead of the 8-column table, and every
dialog presented as a bottom sheet. Desktop is unchanged; content components
and data hooks are shared across both shells. Real-money display gates
(missing prices render "—", the not-advice disclaimer stays visible) hold in
the mobile layout. Internal-only — no publishable package surface changes.
