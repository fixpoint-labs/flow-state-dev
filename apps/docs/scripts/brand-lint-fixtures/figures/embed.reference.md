---
title: A page that sets its figure as a reference-style image
type: concept
---

Breaks figure rule 16 three ways (a full, a collapsed and a shortcut reference image); scripts/lint-brand.mjs fails unless it fires here.

![A board][board]

![Board][]

![board]

[Board]: <./good.svg> "A board"
