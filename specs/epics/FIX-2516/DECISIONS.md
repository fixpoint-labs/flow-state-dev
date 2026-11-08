# FIX-2516 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls above any single child: what was chosen, what lost, and what each locks in for the
nine children and the closure. D2, D3 and D4 are the owner's, settled on 2026-11-05; D2 and D3
replace #4766's open Q1 and Q2. Mechanics inside the blob store are FIX-824's spec.

## The tree

```mermaid
flowchart TD
  E["FIX-2516"] --> D2["D2 · bytes through a blob storage adapter, local disk by default"]
  D2 -.->|"superseded"| X1["inline bytes in the message, #4766 Q1"]
  E --> D3["D3 · attachments beside the input, as references"]
  D3 -.->|"rejected"| X2["inside each flow's input schema"]
  E --> D4["D4 · the reference rides in FileContent.data"]
  D4 -.->|"rejected"| X3["a new ref field"]
  E --> D1["D1 · nine children and a closure"]
  D1 -.->|"rejected"| X4["documents folded into the framework and harness issues"]
```

<a name="d1"></a>
## D1 · Nine children and a closure: storage first, then the framework and the composer, then the harnesses and the apps; documents after images

| | |
|---|---|
| **Instead of** | Documents folded into FIX-2517 and FIX-2519 · one issue for both labs |
| **Because** | Codex and Cursor take no documents, so documents need a per-target answer that should not hold images back. Each app has its own composer and send path, so an app issue is what a reviewer checks in a browser. FIX-824 comes first because every child that touches bytes goes through it |
| **Locks in** | Ten rows. A collapse trigger on the labs: if both lab specs have no decision of their own, the spec set merges them |

**What would change my mind:** the two lab specs being identical. Then they are one issue.

![D1: nine children and a closure, chosen, beside folding documents into the framework and harness issues. Decides it: Codex and Cursor take no documents. Price: one more issue and an extra hop for documents. Flips if every target took documents natively](figures/d1-division.svg)

It comes down to Codex and Cursor: with no document input, documents need their own answer.

<a name="d2"></a>
## D2 · Bytes go through a blob storage adapter, local disk by default; messages carry references

| | |
|---|---|
| **Instead of** | Inline bytes in the stored message, under a 3 MB cap (#4766 Q1) |
| **Because** | Inline breaks the reload on a hosted server: two near-cap turns make a 100-item session read about 8 MB, over Vercel's 4.5 MB response limit (Codex, #4766). A reference makes that read a few hundred bytes a file, whatever the host. The default writes to local disk, so a single-server install needs no new dependency |
| **Locks in** | The `blobs` slot is real, in the same shape as the store adapters. A host whose disk doesn't persist marks the slot unavailable in its own adapter (`@flow-state-dev/vercel`), and the engine then refuses attachments by name; the engine names no host. A serverless deploy must configure a hosted adapter; none is built here, and the closure runs on a local server |

**Settled by the owner, 2026-11-05.** It changes the merged direction, so it needs approval on
this amendment.

![D2: a blob storage adapter, chosen, beside inline bytes in the message. Decides it: a session read on a hosted server stays small. Price: a store interface, two routes, and a serverless deploy that must configure an adapter. Flips if no host capped request or response size](figures/d2-blob-adapter.svg)

It comes down to the hosted reload: inline breaks it past two full turns, references never do.

<a name="d3"></a>
## D3 · Attachments ride beside the action's input, as references

| | |
|---|---|
| **Instead of** | A field inside each flow's input, checked by that flow |
| **Because** | Beside the input, one server check covers every flow, the worker door and every harness turn, and a hand-built request can't skip it |
| **Locks in** | `attachments: FileContent[]`, in reference form, on the request, the client and React send options, and `HarnessRunInput`. The engine checks the limits once and writes the files as `file` parts on the user line `userMessage` writes; an action with no `userMessage` refuses files by name |

**Settled by the owner, 2026-11-05**, after the Architect's note on #4766.

![D3: attachments beside the input, chosen, beside a field inside each flow's input. Decides it: a hand-built request can't skip the limits. Price: one new field on the request, client, React and harness input. Flips if files outside a person's turn became the common case](figures/d3-beside-input.svg)

It comes down to the server check: inside the input, every flow writes its own or skips it.

<a name="d4"></a><a name="q1"></a>
## D4 · A stored file part carries its reference in `FileContent.data`, as `fsd-blob:<id>`

| | |
|---|---|
| **Instead of** | A new `ref: { id }` field, with `data` made optional |
| **Because** | It keeps the published type as it is and matches the AI SDK, whose file part takes bytes or a URL in the same field. The price is a reader that assumes `data` is base64; none exists, since nothing produces `FileContent` yet |
| **Locks in** | `fsd-blob:` becomes public stored format. The guard is ER-1: one resolver, with a test, so no reader assumes `data` is base64 |

**Settled by the owner, 2026-11-05.**

**What would change my mind:** a consumer, ours or an adopter's, already reading `data` as base64.

![D4: the reference in FileContent.data, chosen, beside a new ref field. Decides it: the published type stays as it is. Price: a reader that assumes data is bytes gets a string it can't decode; one resolver and a test guard it. Flips if a consumer already reads data as base64](figures/d4-reference-in-data.svg)

It comes down to the published type: only `data` leaves it unchanged.

## Who owns what

![Who owns what: seven rules across FIX-824, FIX-2517 to 2524 and the closure FIX-2565; each rule has one owner](figures/ownership.svg)

Each rule has one owner. A *uses* cell is a place where a child must not decide again.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | One attachment shape: contracts' `FileContent` in reference form ([D4](#d4)), in the request, on the user item, on `HarnessRunInput` and on the task brief. No second shape, no `attachment` item type. One helper in `contracts/attachments` builds and parses `fsd-blob:`; one engine resolver turns a reference into bytes, for the model-message build and the harness hand-off alike. Nothing else string-matches the scheme or decodes `data`, and a test proves it | FIX-824 defines · FIX-2517 writes it | Cross-spec review; FIX-824's test |
| ER-2 | Bytes live only in the blob store and are reached only through its interface. Nothing writes them into a session, a request, a resource or `localStorage`, and nothing reads the local adapter's files directly | FIX-824 | Spec set; leg a's session read |
| ER-3 | A file is served only to a caller who can read the scope that owns it. Its id is not a key (BP-031). No direct read URL in v1: every read passes that check | FIX-824 | FIX-824's goal check |
| ER-4 | One limits set, in `@flow-state-dev/contracts/attachments` with a README entry, read by the composer and the server. Over a limit, the composer refuses before send and the server with a named error; nothing is dropped silently | FIX-824 defines · FIX-2517, 2518 enforce | Leg c |
| ER-5 | A target that can't take a type says so in the conversation; never a text-only fallback | FIX-2519 | FIX-2519's and FIX-2520's checks |
| ER-6 | Composer pieces come from the `packages/ui` registry. No app writes its own paste, drop, preview, downscale or upload (FIX-2152 ER-3 and ER-4) | FIX-2518 | The closure's sweep |
| ER-7 | A task's attachments are part of its brief, on the task row, as references, owned by the board's scope and deleted with the task; every run gets them. No task noun enters core | FIX-2522 · FIX-2519 hands them on | The closure's Shift Manager re-run |

## Coordination seams

| Seam | Between | Rule |
|---|---|---|
| A reference's owner | FIX-824, 2517, 2522 | Each file has one owner. FIX-824 claims an upload into the turn's session; FIX-2522 claims a task's files into the board's scope. Nothing shares a reference across owners, so a later session copy re-claims its files |
| The `blobs` slot | FIX-824, FIX-2452 | FIX-2452 keeps `blobs` (reserved until FIX-824 lands) and refuses only `queue` and `scheduler`. FIX-824 makes `blobs` real and names its factory in FIX-2452's store-factory family. |
| `sendAction` and `useSession` | FIX-2517, FIX-2450, FIX-2455 | FIX-2517 adds `attachments` to the send options on whichever handle FIX-2455 leaves |
| `prompt-input.tsx` and the registry `Conversation` | FIX-2518, 2520, FIX-2456 | FIX-2518 lands the pieces; FIX-2520 only widens `accept`; FIX-2456 owns the scroll chrome |
| Core's root | FIX-2517, 2519, FIX-2448 | `HarnessRunInput` moves with FIX-2448 to `core/harness`; nothing new lands on core's root |
| Kitchen Sink's harness pages, the lab's harness path | FIX-2521, 2523 | Both consume FIX-2519; neither adapts per app |
| The board run | FIX-2519, 2522 | FIX-2519 builds the hand-off; FIX-2522 only writes the brief |

## Decided in review, recorded so no child reopens them

- **Owner calls, 2026-11-05:** D2, D3, D4; the kill line in SPEC.md; `blobs` stays reserved
  until FIX-824 fills it; a task's files are its brief's; FIX-137 is not folded; Word, Excel and
  PowerPoint are cut.
- **The kill line is FIX-824's own check.** It sends the files through FIX-824's upload route
  and shows them through its read route, so it needs nothing from FIX-2517.
- **Limits.** 10 images and 5 documents a message; a file up to 20 MB as picked; images
  downscaled in the browser to 1,568 px on the longest side; PDFs to 100 pages; PNG, JPEG, WebP
  and GIF; HEIC refused. What one model call carries stays under its provider's request limit;
  FIX-2517's history rule owns that.
- **The store.** A blob store beside the store adapters, filled from the profile's `blobs` slot,
  with a local-disk default under the stores' rootDir, used whenever a profile names none. Its
  interface and layout are FIX-824's.
- **Lifetime.** Unclaimed uploads expire after a day; a session's files go with the session, a
  task's with the task. The store sweeps itself; nothing adds a scheduler for it.
- **Per-target detail is the children's.** FIX-2517 owns the history rule, FIX-2519 each
  harness's hand-off, FIX-2518 drafts. The epic fixes only the outcomes.
- **Documents.** Text-like files go as text headed by the filename; a PDF as a file part where
  the provider takes PDFs, else ER-5's message. No extraction library in v1. FIX-2520's in-app
  PDF checks are the closure's leg b.
- **FIX-367 and FIX-891 stay related.** FIX-367 can build on the `blobs` slot later; FIX-2517
  delivers FIX-891's file-part half, and upload-once is not this epic's.

## What the end-state POC showed

None built. The premise that could break the division is the kill line, and FIX-824's goal check
measures it directly.

<a name="analysis"></a>
## Analysis

**2026-11-05 · right approach, with changes.** The blob store **extends** the reserved `blobs`
slot and follows `createFilesystemStores`; it does not reuse `ContentStore`, which holds strings
per resource. Major concern: a hosted deploy has no adapter; named as debt.

## How it got here

- **Drafted (Nov 5).** From the product brief, on `main` at 9c75ce2. Closure FIX-2565 filed.
  FIX-2516 had left [FIX-2369](../FIX-2369/DECISIONS.md#decided-recorded-so-no-child-reopens-them)
  on the owner's call on Nov 4.
- **Merged (Nov 5, #4766, head 7012fb8).** Q1 and Q2 open.
- **Amended (Nov 5, #4787).** The owner settled storage (D2), the API shape (D3) and FIX-824
  joining. Folded from #4766's review: the hosted session read (Codex), FIX-2447's seams, the
  limits off core's root, nine-really-eight (the Architect), fewer ER rows (Cursor).
- **Round 1 on #4787 (Nov 5).** The owner settled the reference format (D4), the kill line and
  the reserved `blobs` slot, matching FIX-2452's spec (#4772). Folded from the Architect: no
  direct read URL, the host declares a non-persistent disk, a task's files' lifetime, one
  resolver. From Cursor: store mechanics left to FIX-824, the predecessor rows split.

**Open:** none.
