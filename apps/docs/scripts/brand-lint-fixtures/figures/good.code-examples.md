---
title: A clean page that shows figure markup as code
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./good.svg";

Keeps figure rule 16 while showing figure markup in code, which the lint must not read as the page's own; scripts/lint-brand.mjs fails if it fires here.

<Figure svg={Board} caption="A board is a list and a loop" description={"On the left, the list of tasks, hatched because it outlives the request, with compare highlighted as the task that cannot start yet. On the right, the drain, dashed because it lasts one action run, and an arrow where it claims a ready task."} />

```mdx
<Figure svg={Board} caption="Example" />
```

~~~mdx
<Board />
![A board](./good.svg)
~~~

- In a list:

    ````mdx
    <div>{true && Board}</div>
    ````

Inline, `<Figure svg={Board} caption="Example." />` and `` <Board /> `` are examples too.
