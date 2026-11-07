---
"@flow-state-dev/client": patch
"@flow-state-dev/react": minor
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

An action's answer is read with one call, by the request's id, however long its session is (FIX-2455).

- **client:** `request.result({ pollMs?, timeoutMs?, signal? })` on every request handle waits for the request to settle, then reads it once by id with its stored result. It resolves `{ status, output?, outputNotRecorded?, error? }` for every way a request settles: branch on `status`. A failure resolves `failed` with its `error`, and a stop for a person resolves `suspended`. It rejects only past `timeoutMs`, on a transport error, or when `signal` aborts. New types: `RequestResult` and `WaitOptions`. `wait()` takes `signal` too. Stopping either wait never stops the run. `steerRunningTurn` reads the steer's answer by id, so a steer behind 20 newer requests no longer reads as not taken.
- **react:** `useAction({ action, result: true })`: `execute` resolves to `request.result()`'s shape, `loading` holds until the request settles, and an unmount stops the wait without stopping the run. Without the option, `execute` resolves on acceptance, as before.
- **react (breaking):** `useReadFence` and `ReadFence` are no longer exported from `@flow-state-dev/react`. They moved to `@flow-state-dev/react/internal`, a subpath for the framework's own packages, with no alias. Apps should not import it.
- **orchestration:** the Inbox client's board actions and row answers read the board's answer by request id. A session holding more than 2,000 requests no longer rejects an answer the board gave.
- **workforce:** the Workforce client's roster and project actions (`hire`, `fork`, `edit`, `fire`, the standing rules and the work project) read their answer by request id, so a roster session longer than 100 requests no longer reads a finished action as unread.
- **shift-manager:** actions, sent lines, interrupts and answered asks wait through the client's one wait and read their answer by request id.

Docs: packages/client/README.md (a `result()` row in the request handle table, with its resolved shape and the rule that it resolves for every ending; `wait`'s `signal`; the *Sending an action* example reads `const { status, output, error } = await sent.result()` instead of listing the session's requests), packages/react/README.md (`useAction`'s `result: true` option: what `execute` resolves to and how long `loading` holds; drop `useReadFence`), packages/engine/README.md (the status endpoint's `include_result_output` is what `result()` reads), apps/docs/docs/client/overview.md (*Sending an action* and the *Requests* table: `result()`), apps/docs/docs/fundamentals/actions.md (*From the client SDK*: read the answer with `sent.result()`), apps/docs/docs/api/client.md (`result` and `wait`'s `signal`), apps/docs/docs/client/react.md and apps/docs/docs/api/react.md (`useAction`'s `result` option), apps/docs/docs/fundamentals/flows.md (*Reads*: one line pointing at the `useSubscription` recipe in `client/react.md`), the package-roots page FIX-2448 adds, apps/docs/docs/api/package-roots.md (react's row gains `react/internal`: our packages' entry, not for apps)
