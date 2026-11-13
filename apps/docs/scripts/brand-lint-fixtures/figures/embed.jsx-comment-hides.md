---
title: A page whose JSX comment hides a bare figure
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Breaks figure rule 16 (a bare figure after a comment with an apostrophe); scripts/lint-brand.mjs fails unless it fires here.

{/* don't */}

{Board}

It's set on the page with no caption or description.
