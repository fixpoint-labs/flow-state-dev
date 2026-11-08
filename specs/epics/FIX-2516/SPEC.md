# FIX-2516 · Attachments: paste or upload images and documents in every chat

**Spec** · [Decisions](DECISIONS.md)

## Five teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **chats in Kitchen Sink, Shift Manager or a lab** | Kitchen Sink drops a pasted image; the rest can't attach | Paste, **+** or drop; the reply shows the model saw it, after a reload too |
| **runs a coding worker on Claude Code, Codex or Cursor** | Describes the bug in words | The turn's images reach the harness, or it says why not |
| **files a task in Shift Manager with a screenshot** | The worker never sees it | The image is in the task's brief, for every run |
| **builds a flow on FSD** | Hand-rolls base64 input | Sends `attachments` beside the input; bytes go to a blob store, local disk by default |
| **builds its own composer** | Rebuilds paste, picker and previews | Installs the registry's pieces with `fsdev ui add` |

**Why now.** The owner asked on 2026-11-03, and much of it is built and unused: `PromptInput`
has the picker, paste and limits, AI SDK 7 takes file parts, and the store profile reserves a
`blobs` slot.

## The goal, and how we'll know it's met

**In every chat in our apps, a person can attach images and documents to a message (paste, a +
picker, drag and drop), see and remove them before sending, and the reply shows the model or
harness saw them.** Kitchen Sink (Flow State chat, the Claude Code, Codex and Cursor pages), Shift
Manager, the Claude Code-style lab and the Teammates lab.

| Is it the right goal? | |
|---|---|
| **The real need** | People work by showing: a screenshot of the bug, the PDF of the spec |
| **Smaller, and rejected** | Images in Flow State chat only. The harnesses, where a screenshot matters most, stay blind |
| **Bigger, and not this epic's** | Hosted blob adapters · upload once at the provider ([FIX-891](https://linear.app/fixpoint-labs/issue/FIX-891)) |
| **Not done if** | An app lacks paste, **+** or drop · a reload or a restart loses an image · a session read carries file bytes · a refusal is silent · a re-run loses its brief's images · a closure finding is open |

```mermaid
flowchart LR
  A["each app · five chats"] --> L1["leg a · paste one image, pick a second, send"]
  A --> L2["leg b · attach a PDF, ask what only it says"]
  A --> L3["leg c · an 11th image, an oversized file, an unsupported type"]
  L1 -->|"reply describes both · reload and restart show both"| P["PASS · the goal is met"]
  L2 -->|"reply carries the PDF's code word · Codex and Cursor refuse it by name"| P
  L3 -->|"a plain message · nothing sent"| P
  C["control · today's main"] -.-> A
  A -.->|"under the control"| F["must FAIL · every leg"]
```

| How we verify | |
|---|---|
| **Goal check** | The closure, [FIX-2565](https://linear.app/fixpoint-labs/issue/FIX-2565), on one `main` commit, in each app's browser: persistent stores, real model, real harness |
| **Signal** | a: the reply names each image; a reload, and one after a restart, show both; the session read carries references, not bytes. b: the PDF's code word; on the Codex and Cursor pages, their named refusal ([FIX-2520 D1](../../issues/FIX-2520/DECISIONS.md#d1)). c: a composer message, no action request |
| **Input** | Fresh images and a PDF with a random code word, per run |
| **Anti-game** | Assert on what the person sees, never on a stubbed model |
| **Control that must fail** | Today's `main`: every leg. A planted strip of `file` parts: legs a and b |

| | |
|---|---|
| **Lead measure** | Children whose goal check passed. **None today** |
| **Not doing** | Files in replies · audio, video · a file library · drive pickers · Word and Excel · a hosted blob adapter · folding [FIX-137](https://linear.app/fixpoint-labs/issue/FIX-137) |
| **Kill line** · *the owner's, 2026-11-05* | "If FIX-824's goal check can't send 10 images and a 20 MB PDF by reference through a running local server, and show them all after a restart, with no new required dependency and no change to the existing store adapters, stop the app children and amend this epic." [How FIX-824 runs it](DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them) |

## What's in the box

![In the box: a blob storage adapter with a local-disk default, attachments as references, one limits set, file parts to a generator and each harness, a task brief that keeps its files, the composer pieces. Fence: a message carries only references. Not built: hosted adapters, files in replies, a file library](figures/end-state.svg)

The fence is [D2](DECISIONS.md#d2): messages, session reads and harness hand-offs carry
references, so no host's request or response limit caps an attachment.

**Docs:** one story, "a user turn can carry files", in the guide section FIX-2517 publishes.
FIX-824 adds where bytes live and what a serverless deploy configures, and says a database
backup misses the bytes on disk. FIX-2519 adds the harness table, FIX-2520 documents, FIX-2518
the registry page.

## The set · as of 2026-11-08

A dated snapshot; live state is Linear. Every child is specced in one spec-set PR.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-824](https://linear.app/fixpoint-labs/issue/FIX-824) · blob storage | The adapter, its local default, upload and read routes, the limits set. **Its goal check is the kill line** | Bytes go nowhere else ([ER-2](DECISIONS.md#who-owns-what)) | Backlog |
| [FIX-2517](https://linear.app/fixpoint-labs/issue/FIX-2517) · framework | `attachments` beside the input; `file` parts on the user item and to a generator | Every app uses its shape | Backlog · blocked by 824 |
| [FIX-2518](https://linear.app/fixpoint-labs/issue/FIX-2518) · UI library | Picker, paste, drop, previews, refusals, downscaling, upload | Else each app rebuilds it | Backlog · blocked by 824 |
| [FIX-2519](https://linear.app/fixpoint-labs/issue/FIX-2519) · harnesses | Images to Claude Code, Codex, Cursor; a task's brief files to every run | Where a screenshot matters most | Backlog · blocked by 824, 2517 |
| [FIX-2520](https://linear.app/fixpoint-labs/issue/FIX-2520) · documents | PDF and text-like files | Documents differ per target ([D1](DECISIONS.md#d1)) | Backlog · blocked by 2517–2519 |
| [FIX-2521](https://linear.app/fixpoint-labs/issue/FIX-2521) · Kitchen Sink | Flow State chat, three harness pages; the silent drop fixed | Two of five chats | Backlog · blocked by 2517–2519 |
| [FIX-2522](https://linear.app/fixpoint-labs/issue/FIX-2522) · Shift Manager | Every composer; a new task's files join its brief | Where a file outlives its turn | Backlog · blocked by 2517–2519 |
| [FIX-2523](https://linear.app/fixpoint-labs/issue/FIX-2523) · both labs | The Claude Code-style and Teammates composers, to Claude Code runs and to generator and coding teammates | Two chats | Backlog · blocked by 2517–2519 |
| [FIX-2524](https://linear.app/fixpoint-labs/issue/FIX-2524) · Teammates lab | **Merged into FIX-2523** by D1's collapse trigger; closed as a duplicate when the spec set is approved | — | — |
| [FIX-2565](https://linear.app/fixpoint-labs/issue/FIX-2565) · closure · **required** | Three legs per app, each team's journey, the seams | Proves the whole | Backlog · blocked by every child |

Eight children and a closure. Nine at the gate; **the spec set found neither lab spec had a
decision of its own**, D1's collapse trigger, so the labs are one issue.

## How the issues flow into each other

```mermaid
flowchart LR
  S["FIX-824 · blob storage"] -->|"references and the limits"| A["FIX-2517 · framework"]
  S -->|"the upload call"| B["FIX-2518 · UI library"]
  A -->|"the shape"| H["FIX-2519 · harnesses"]
  A -->|"file parts on the user line"| APPS
  B -->|"the composer pieces"| APPS
  H -->|"a turn's files reach each harness"| APPS
  A --> D["FIX-2520 · documents"]
  B --> D
  H --> D
  subgraph APPS["the apps"]
    KS["FIX-2521 · Kitchen Sink"]
    SM["FIX-2522 · Shift Manager"]
    CC["FIX-2523 · both labs"]
  end
  APPS --> Z["FIX-2565 · closure · required"]
  D --> Z
```

An edge is what one issue hands the next. FIX-824 goes first; the closure waits on all eight.

## What stays as it is

- **The action request stays JSON**; bytes go up the upload route.
- **The existing store adapters**, `ContentStore`'s strings, and the published `FileContent` type ([D4](DECISIONS.md#d4)).
- **The worker door's `{ message }`** and each flow's input schema ([D3](DECISIONS.md#d3)).
- **Steering stays text.** A line with files waits for the next turn.
- **Related, not children:** FIX-137, FIX-891, FIX-367, FIX-2152, FIX-2467, FIX-2371.

## What's already here, and the debt

The predecessor is this epic's merged spec, [#4766](https://github.com/fixpoint-labs/flow-state-dev/pull/4766).

| Already here | What the set does with it |
|---|---|
| #4766's Q1, storage: inline bytes under a cap | **Superseded** by [D2](DECISIONS.md#d2) |
| #4766's kill line | **Superseded** by the kill line above |
| How a stored part points at its bytes (new here, not #4766's) | **Settled** by the owner: [D4](DECISIONS.md#d4) |
| The reserved `blobs` slot (`packages/engine/src/stores/store-adapter.ts`) | **Extends**: FIX-824 backs it; FIX-2452 keeps it reserved until then |
| `createFilesystemStores` (`packages/engine/src/stores/index.ts`) | **Builds on**: the local default follows its rootDir |
| `FileContent` (`packages/contracts/src/items/content.ts`), never produced | **Reuses**, in reference form |
| `PromptInput`, `usePromptInputAttachments` | **Builds on** (FIX-2518) |
| `itemToLLMMessages`, `HarnessRunInput { prompt }`, the task row's `context` | **Extends** each to carry references |
| FIX-137's `attachment` item type | **Amended**: no item type; it stays open |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| A blob store and its local default | `ContentStore`; the `blobs` slot | Extends the slot; `ContentStore` holds strings per resource |
| Upload and read routes | The action route; the session read's check | The action route stays JSON; both reuse the check ([ER-3](DECISIONS.md#who-owns-what)) |
| `attachments` and one limits set | Input schemas; `PromptInput`'s limit props | Extends the request's parse step; the props default to the set |
| Per-turn files for Codex and Cursor | The workspace host | New and small: it places checkouts, not files |

**Removes** Kitchen Sink's silent drop. **Adds** the rows above; a
hosted deploy refuses attachments by name until it has an adapter. **Leaves** each adapter's
event-to-item helper. **Net: up, on purpose.**

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** five chats, images and PDFs,
named refusals, proved through a restart. If wrong: the harnesses stay blind.

**[The set's debt](#whats-already-here-and-the-debt), net up:** one capability, one local
adapter. If wrong: a hosted deploy waits on an adapter.

1. **[D1](DECISIONS.md#d1) · Eight children and a closure: storage, images, then documents; the labs merged in the spec set.**
   If wrong: one issue holding two apps a reviewer checks separately.
2. **[D2](DECISIONS.md#d2) · Bytes go through a blob storage adapter, local disk by default.**
   The owner's call. If wrong: a store we needn't have built.
3. **[D3](DECISIONS.md#d3) · Attachments ride beside the input, as references.** The owner's
   call. If wrong: a field we deprecate in a minor.
4. **[D4](DECISIONS.md#d4) · The reference rides in `FileContent.data`.** The owner's call.
   If wrong: a scheme check in each reader.

**Open: none.**

Epic · 8 children and a closure · Workforce: Shift Manager · Goal 1, validate through real usage
