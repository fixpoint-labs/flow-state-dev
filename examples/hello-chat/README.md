# Example: Hello Chat

The minimal chat app: one flow, one action, and a Next.js page that talks to it.

- `defineFlow` with a session `stateSchema` and `client.expose`
  (`src/flows/hello-chat/flow.ts`)
- one action (`chat`): a `sequencer` that runs a text `generator`, which streams the
  assistant's reply as message items with no emit call, then `.tap()`s a `handler`
  that counts messages through `ctx.session.patchState`
- `userMessage` on the action, so the user's text shows in the conversation too
- the page (`app/page.tsx`): `FlowProvider`, `useFlow`, `useSession` and
  `ItemsRenderer`, with its own renderers for message and reasoning items
- the route handler (`app/api/flows/[[...path]]/route.ts`) serving the flow from
  `fsdev.config.ts`, the same config the `fsdev` CLI loads
- deterministic flow tests with `testFlow`, `testBlock` and `mockGenerator`

## Run it

Inside this repository, run `pnpm install` at the root first. To run it outside the
repository, copy it out with
[the recipe](https://github.com/fixpoint-labs/flow-state-dev/blob/main/examples/README.md#copy-an-example-out)
first. The chat calls `openai/gpt-6-luna`, so set `OPENAI_API_KEY`:

```bash
export OPENAI_API_KEY=sk-...
npm run dev                                   # the chat page at http://localhost:3000
npx fsdev run hello-chat chat -i '{"message":"hi"}'   # the same flow, no browser
```

## Test it

```bash
npm run typecheck
npm test
npm run build
```

The tests mock generator responses and fail fast on any network access, so they
need no `OPENAI_API_KEY`.
