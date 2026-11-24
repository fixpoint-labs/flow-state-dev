---
title: Where a support desk keeps what it knows
type: concept
---

import Figure from "@site/src/components/Figure";
import Board from "./figures/goal-clean.svg";

# Where a support desk keeps what it knows

A request reads the session record before the first block runs. Each user keeps one record per organization, and the session names it. The org record holds what every user in the organization shares. A block that writes session state writes it for the whole conversation.

Request state starts empty and goes when the call ends. Two users at the same org read the same org record and different user records. A field the flow does not expose never reaches the browser. The schema on the flow gives each field its type and its default.

A request reads the session record before the first block runs. Each user keeps one record per organization, and the session names it. The org record holds what every user in the organization shares. A block that writes session state writes it for the whole conversation.

Request state starts empty and goes when the call ends. Two users at the same org read the same org record and different user records. A field the flow does not expose never reaches the browser. The schema on the flow gives each field its type and its default.

A request reads the session record before the first block runs. Each user keeps one record per organization, and the session names it. The org record holds what every user in the organization shares. A block that writes session state writes it for the whole conversation.

Request state starts empty and goes when the call ends. Two users at the same org read the same org record and different user records. A field the flow does not expose never reaches the browser. The schema on the flow gives each field its type and its default.

<Figure svg={Board} caption="A board is a list and a loop" description={"Board, on the left, is the list of tasks, hatched because it outlives the request, with compare highlighted as the task that cannot start yet. On the right, the drain, dashed because it lasts one action run, and an arrow where it claims a ready task."} />

```ts title="src/flows/support/flow.ts"
export const plan = z.string().default("free");
```

1. Read the field in a handler.

   ```ts title="src/flows/support/blocks/read-plan.ts"
   const current = ctx.user.state.plan;
   ```
