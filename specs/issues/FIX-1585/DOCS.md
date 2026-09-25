# FIX-1585 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three destinations. The framework change (D1) is one reader-facing fact, so it gets one short
section in the channels page, two sentences where the page explains the transcript, and one
paragraph in the package README. The rest is the reference app's own README. No new page, no
sidebar change, no blog.

Voice rules most at risk here: no em-dash chains, no sentence opening with "This", and say
plainly that the page posts as one shared user.

## UPDATE · `apps/docs/docs/workforce/channels.md` · new `### Showing a channel on screen`, at the end of "Posting and reading" (before "What the transcript proves")

### Showing a channel on screen

A browser never receives an action's return value, so `read` is no help to a page. Each post
leaves one `channel-post` item on the channel's session, carrying the line, and a page reads
those the way it reads any conversation:

```tsx
const channel = useSession("engineering.standup", { flowKind: "channel", items: { itemTypes: ["component"] } });
const lines = channel.items
  .filter((item) => item.type === "component" && item.component === "channel-post")
  .map((item) => item.data as ChannelTranscriptLine);
```

The channel's members and charter never reach the page.

To post from the page, call the channel's own action on the same session:

```tsx
await channel.sendAction("post", { body });
```

Leave `author` out when a person is posting. `author` has to be one of the channel's members,
and a person using your app usually isn't one, so naming them is refused. The line still says
who posted: `principal` is the identity your server resolved for the request. A post with no
`author` notifies every member, which is right here, because the person who wrote it is not
among them.

A line another member posts appears when the page reads the channel again: after its own post,
or when it opens the channel.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Posting and reading", the paragraph starting "The transcript is not the session's item history"

Replace it with:

The transcript is the channel's `channel-post` items and nothing else from its history, which
also carries fan-out requests, dispatch handles and refusals. `read` returns the recent lines:
the ones inside the session's history window, which is 50 requests by default. On a channel
with a notify block, each post uses two of them.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Registering a kind of your own", after the paragraph ending "its own state, its own post, its own read."

A kind of your own shows on a page the same way when its `post` emits the line as a
`channel-post` component item: `ctx.emit.component("channel-post", line)`.

## UPDATE · `packages/workforce/README.md` · "Channels → Posting and reading", after the `channel-not-bound` paragraph

Each post leaves one `channel-post` item on the channel's session, and that item is the line.
A page renders the channel from those items; `read` is for models and other flows, returns the
lines inside the session's history window, and never reaches a browser. A person posting from
a page sends no `author`, since they are not a member. The line's `principal` names them.

## UPDATE · `apps/kitchen-sink/README.md` · "Web Application (`app/`)"

Replace the **Session management** bullet with:

- **Session management**: Create and switch between the assistant's sessions from its row in
  the rail. A seat's row has **New conversation** too
- **Channels**: Open one in the rail to read its transcript and post to it. Your post calls the
  channel's own `post` action, the same one `fsdev run` calls, and it appears as `devuser`,
  the one user this app runs as. Every member is notified. `support.noticeboard` is the
  exception: its `digest` kind keeps no poster and notifies no one. Lines a seat posts show up the next
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
