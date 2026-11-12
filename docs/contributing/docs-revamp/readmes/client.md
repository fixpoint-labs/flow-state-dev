# @flow-state-dev/client

Call flows from Node, the browser or an edge runtime: actions, sessions and streams, with no React or DOM dependency.

```bash
pnpm add @flow-state-dev/client
```

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({ baseUrl: "http://localhost:3000", userId: "user_1" });

const support = fsd.flow("support");
const session = await support.createSession();
const sent = await support.send("reply", { text: "Hi" }, { sessionId: session.id });
const { status } = await sent.wait();
```

Reference: [the `client` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/client).
