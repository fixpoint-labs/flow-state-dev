---
title: A page that draws its figure inline
type: concept
---

Breaks figure rule 16 twice (an inline svg in Markdown, and one inside an expression); scripts/lint-brand.mjs fails unless it fires here.

<svg viewBox="0 0 920 200"><text x="28" y="56">A BOARD</text></svg>

{true && <svg viewBox="0 0 920 200" />}
