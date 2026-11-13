---
title: A clean page with JSX comments and apostrophes
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Keeps figure rule 16 with apostrophes inside JSX expressions; scripts/lint-brand.mjs fails if it fires here.

{/* don't */}

{ok && <p>it's</p>}

{/* the key's last */}

<Figure svg={Board} caption="A board is a list and a loop" description={"Board, on the left, is the list of tasks, hatched because it outlives the request, with compare highlighted as the task that cannot start yet. On the right, the drain, dashed because it lasts one action run, and an arrow where it claims a ready task."} />
