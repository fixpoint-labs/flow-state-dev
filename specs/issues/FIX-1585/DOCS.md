# FIX-1585 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three destinations. The framework change (D1) is one reader-facing fact, so it gets one short
section in the channels page and one paragraph in the package README. The rest is the
reference app's own README. No new page, no sidebar change, no blog.

Voice rules most at risk here: no em-dash chains, no sentence opening with "This", and say
plainly that the page posts as one shared user.

## UPDATE · `apps/docs/docs/workforce/channels.md` · new `### Showing a channel on screen`, at the end of "Posting and reading" (before "What the transcript proves")

### Showing a channel on screen

A browser never receives an action's return value, so `read` is no help to a page. A page reads
the transcript as client data instead. The built-in kind puts it there, and nothing else of the
channel's state: its members and charter stay on the server.

```tsx
const channel = useSession("engineering.standup", { flowKind: "channel", items: true });
const data = useClientData(channel, { session: ["transcript"] });
const lines = (data.session?.transcript ?? []) as ChannelTranscriptLine[];
```

Read the transcript rather than `channel.items`. A post adds a line to the transcript and
nothing a page would render to the item stream.

To post from the page, call the channel's own action on the same session:

```tsx
await channel.sendAction("post", { body });
```

Leave `author` out when a person is posting. `author` has to be one of the channel's members,
and a person using your app usually isn't one, so naming them is refused. The line still says
who posted: `principal` is the identity your server resolved for the request. A post with no
`author` notifies every member, which is right here, because the person who wrote it is not
among them.

The transcript is re-read when the page's own post finishes. A line another member posts in
the meantime appears on that read, or when the page opens the channel again.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Registering a kind of your own", after the paragraph ending "its own state, its own post, its own read."

A kind of your own is private to the server until it says otherwise. To show its transcript on
a page, declare it on the session: `session: { stateSchema, client: { expose: ["transcript"] } }`.

## UPDATE · `packages/workforce/README.md` · "Channels → Posting and reading", after the `channel-not-bound` paragraph

The built-in kind exposes `transcript` as session client data, and only that, so a page can
render the channel with `useClientData(session, { session: ["transcript"] })`. `read` is for
models and other flows: its return value never reaches a browser. A person posting from a page
sends no `author`, since they are not a member. The line's `principal` names them.

## UPDATE · `apps/kitchen-sink/README.md` · "Web Application (`app/`)"

Replace the **Session management** bullet with:

- **Session management**: Create and switch between the assistant's sessions from its row in
  the rail. A seat's row has **New conversation** too
- **Channels**: Open one in the rail to read its transcript and post to it. Your post calls the
  channel's own `post` action, the same one `fsdev run` calls, and it appears as `devuser`,
  the one user this app runs as. Every member is notified. Lines a seat posts show up the next
  time the channel is read
- **Seats**: Open a seat's conversation to talk to it. The composer calls the action the seat's
  kind answers with: `answer` for `desk-clerk` seats, `run` for `agent` seats. `support.wren`
  runs board rows and has nothing to answer with, so its conversation stays read-only and says
  so. An `agent` seat keeps its replies but not your questions

And under "The support team", after the `curl` block:

Or open the seat in the app's rail and type the note there. The page calls the same action.

## Publication ownership

FIX-1585 publishes all four after V6 and V7 pass. The workforce README edit sits in the
Channels sections only; FIX-1459 is editing other sections of the same file.
