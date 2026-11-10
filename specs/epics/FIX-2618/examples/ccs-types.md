# claude-code-style: types come from the views

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

The rule: if the server computes it, the view's output schema owns its type, and the client infers it with `ViewOutput<typeof view>`. If only the screen computes it, the app owns it. By that rule two of the lab's fifteen types stay: `ThreadEntry` (how this app draws a thread) and a shrunken `ThreadView`. The rule is [ER-6](../DECISIONS.md#who-owns-what); the fifteen and their fates are in [ccs-lab](ccs-lab.md#the-fifteen-types).

```ts
import type { ViewOutput } from "@flow-state-dev/client";

export type LabTask    = ViewOutput<typeof harnesses.views.codingBoard>[number];
export type LabSession = ViewOutput<typeof workforce.views.workerSessions>[number];
// …or just use those names directly, and drop the aliases once components move.

// The one type the app still owns:
export type ThreadEntry =
  | { kind: "user"; id: string; text: string; queued?: boolean; sentToThread?: boolean }
  | { kind: "assistant"; id: string; text: string; incomplete?: boolean }
  | { kind: "tool"; id: string } & ToolRun
  | { kind: "result"; id: string; taskId: string; title: string; status: TaskStatus; summary: string; duringTurn: boolean }
  | { kind: "brief" | "stopped"; id: string; text?: string };
```
