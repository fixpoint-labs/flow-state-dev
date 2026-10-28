---
"@flow-state-dev/react": minor
---

`useSession` has `followRequest(requestId)`: follow a request of the session that was sent without the hook, streaming its items into `items` and making it the request `abortRequest` stops (FIX-2265). Send a request beside the one the page follows through the client, and follow it once that one ends, so the page stays on the running request meanwhile.

`abortRequest` now closes only the request it stopped. If the session moves to another request while the stop's answer is still out, that request keeps its stream and becomes the one the next stop reaches.

`useHarnessLines(session)` sends a harness session's lines while its turns run: into the running turn when the run takes them, else as the next turn, in the order typed, with the session view kept on the running turn until it ends. It follows each waiting turn once the turn before it has ended, and follows the oldest running turn first when the view opens while turns wait.
