# FIX-824 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic already settled the big calls: bytes go through a blob store with a local-disk default
([epic D2](../../epics/FIX-2516/DECISIONS.md#d2)), the reference rides in `FileContent.data` as
`fsd-blob:<id>` ([epic D4](../../epics/FIX-2516/DECISIONS.md#d4)), and reads always pass the
session check (ER-3). These two are the store's own.

## The tree

```mermaid
flowchart TD
  I["FIX-824"] --> D1["D1 · bytes live wherever the sessions live"]
  D1 -.->|"rejected · bytes nothing points at after a restart"| X1["always on local disk"]
  I --> D2["D2 · the type is what the bytes are"]
  D2 -.->|"rejected · HTML named shot.png served from our origin"| X2["trust the declared type"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Attachment bytes live wherever the sessions live: on disk when they persist, in memory when they don't

| | |
|---|---|
| **Instead of** | Always on local disk, whatever the primary store is |
| **Because** | A file belongs to a session and is deleted with it. On an in-memory profile a restart drops every session, so bytes kept on disk would be owned by nothing |
| **Locks in** | A profile with a durable primary writes attachments to disk by default: under a filesystem primary's `rootDir`, else `.fsdev/blobs` in the server's working directory. An operator who backs up the database alone misses them, and the docs say so. `localBlobStores({ rootDir })` is the public name for choosing another folder |

![D1: wherever the sessions live, chosen, beside always on local disk. Decides it: an in-memory app's restart leaves no bytes that nothing points at. Price: an in-memory app's attachments go at restart, as its sessions do](figures/d1-blobs-follow-sessions.svg)

It comes down to a restart of an in-memory app: always-on-disk leaves files no session can show.

<a name="d2"></a>
## D2 · An upload's type is what its bytes are, not what the caller says

| | |
|---|---|
| **Instead of** | Storing and serving the declared media type |
| **Because** | The read route serves from our own origin. A page of HTML uploaded as `shot.png` and served under a wrong header runs there. Reading the first bytes against the limits set's list closes that at upload, once |
| **Locks in** | The limits set lists each allowed type with its signature; text-like types are checked as UTF-8 with no NUL bytes. A file whose bytes disagree with its name is refused with the reason, so a HEIC photo renamed `.jpg` is refused. Adding a type means adding its signature |

![D2: what the bytes are, chosen, beside what the caller declares. Decides it: a page of HTML named shot.png is refused at upload instead of served from our origin. Price: a renamed real file is refused with the reason](figures/d2-type-from-bytes.svg)

It comes down to our origin: a trusted declared type is one wrong header from running a page.

**What would change my mind:** reads served from a separate origin or always as a download.
Then the declared type is safe enough, and a renamed file could pass.

## Decided, not asked

- **The convergence point for bytes is the resolver.** Every model-message build and every
  harness hand-off turns a reference into bytes through it, and nothing else decodes `data` or
  string-matches `fsd-blob:` (ER-1). A test greps for both outside the helper and the resolver.
- **Claiming is part of the send.** An upload is held for its uploader; the action that names it
  claims it into the turn's session, after the session check. A reference held by another user,
  or already claimed by another owner, is refused by name. A later copy of a session re-claims
  its files (the epic's seam *A reference's owner*).
- **An owner is a session or a board's scope.** FIX-2522 claims a task's files into its board's
  scope; a read of such a file passes that scope's read check. The store knows owners, not tasks
  (ER-7: no task noun in the store).
- **The store sweeps itself.** Unclaimed uploads go after 24 hours, checked when the store opens
  and on each upload; a session's files go when the session is deleted. No scheduler.
- **One id per upload, no content addressing.** Dedupe would share bytes across owners, which the
  one-owner rule forbids.
- **The read route** sends `X-Content-Type-Options: nosniff`, serves images inline and every
  other type as a download. Its paths sit beside the flow's session routes.
- **The limits set** (`@flow-state-dev/contracts/attachments`): 10 images and 5 documents a
  message; 20 MB a file; PDFs to 100 pages; text-like files to 200 KB of text (FIX-2520 D2);
  PNG, JPEG, WebP, GIF; HEIC refused. FIX-2520 widens the type list in this one file.
- **A host whose disk doesn't last** says so in its runtime config (`@flow-state-dev/vercel`'s
  host adapter), not in its store adapter, so the kill line's "no change to the existing store
  adapters" holds. The engine then refuses an upload with a named error; it names no host.
- **The kill line's server is Kitchen Sink's local profile** on SQLite, restarted for real.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Blobs inside `ContentStore` as base64 strings | One read of a session's resources would carry every byte; and a 20 MB file is 27 MB of JSON |
| Blob rows in SQLite or Postgres | Changes the existing adapters, which the kill line forbids, and grows the database by the bytes |
| A signed read URL | A link that outlives the session check (ER-3). Not in v1 |
| Upload addressed to a session up front | A first message in a new chat has no session yet; holding for the uploader covers it |

<a name="analysis"></a>
## Analysis

2026-11-08 · watermark 2026-11-05 (epic merged, #4787) · **Right approach.** Run over the whole
set by `epic-agent`; this issue's lines:

1. **Reuse** — extends the `blobs` slot and the session check; `ContentStore` considered and
   left. See [Builds on / Adds](SPEC.md#whats-already-here-and-the-debt).
2. **Prior art** — OpenAI's and Anthropic's file APIs both take the bytes once and hand back an
   id that later messages carry. Confirms the shape.
3. **Other shapes** — inline bytes under a cap, the epic's rejected Q1.
4. **New factors** — none since the epic merged.
5. **Necessity** — every other child goes through it.
6. **Ergonomics** — an app writes nothing; a profile line only to move the folder.
7. **Concerns** — a backup that misses the bytes. Recorded in the docs line.

## How it got here

- **Drafted (Nov 8)** in the epic's spec set, after the epic's amendment (#4787) put storage
  here and made its goal check the kill line.
- **Set review (Nov 8).** D1 amended the epic's "used whenever a profile names none" to follow
  the sessions; the Vercel mark moved to the host's runtime config; FIX-2522 needed a board's
  scope as an owner, so a claim takes one; FIX-2520 added the 200 KB text cap to the limits set.

**Open: none.**
