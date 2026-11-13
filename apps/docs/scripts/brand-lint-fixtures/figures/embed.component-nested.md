---
title: A page that renders its figure from a nested expression
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Breaks figure rule 16 (an imported figure named in an expression that also holds braces); scripts/lint-brand.mjs fails unless it fires here.

<div>{true ? Board : {a: 1}}</div>
