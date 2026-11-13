---
title: A page that renders its figure from an expression
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Breaks figure rule 16 (an imported figure named inside a larger expression); scripts/lint-brand.mjs fails unless it fires here.

<div>{true && Board}</div>
