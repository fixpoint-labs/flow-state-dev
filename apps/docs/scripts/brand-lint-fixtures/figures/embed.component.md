---
title: A page that renders its figure as a component
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from './good.svg';

Breaks figure rule 16 twice (the figure as its own component, and as an expression outside a Figure); scripts/lint-brand.mjs fails unless it fires here.

<Board />

<div>{Board}</div>
