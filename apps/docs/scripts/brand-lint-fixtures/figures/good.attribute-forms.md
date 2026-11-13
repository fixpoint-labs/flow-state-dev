---
title: A clean page in the other attribute forms
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Keeps figure rule 16 with JSX's other attribute forms (single quotes, spaces around the =); scripts/lint-brand.mjs fails if it fires here.

<Figure svg = {Board} caption='A board is a list and a loop' description = {'On the left, the list of tasks, hatched because it outlives the request, with compare highlighted as the task that cannot start yet. On the right, the drain, dashed because it lasts one action run, and an arrow where it claims a ready task.'} />
