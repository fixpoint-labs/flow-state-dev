# @flow-state-dev/react

React hooks and renderers for Flow State flows, over `@flow-state-dev/client`.

```bash
pnpm add @flow-state-dev/react
```

```tsx
import { FlowProvider, ItemRenderer, useFlow, useSession } from "@flow-state-dev/react";

const App = () => (
  <FlowProvider flowKind="my-app" userId="user_1">
    <Chat />
  </FlowProvider>
);

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);
  return (
    <div>
      {session.items.map((item) => <ItemRenderer key={item.id} item={item} />)}
      <button onClick={() => session.sendAction("chat", { message: "Hello" })}>Send</button>
    </div>
  );
}
```

Reference: [the `react` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/react).
