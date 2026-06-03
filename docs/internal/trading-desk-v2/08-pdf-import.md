# Slice 4b — PDF holdings import

Lets a user import holdings from a brokerage statement PDF, broker-agnostically,
and SAFELY (real money). Built on top of the existing import pipeline (Slice 4 /
Spine B) — it reuses `importHoldings` verbatim and adds only the PDF→rows front
half.

## The path, end to end

```
PDF file  ──(client, base64-encode bytes)──▶
          ──sendAction("extractHoldingsFromPdf", { pdfBase64 })──▶  server
server:   decodeStatement handler: base64 → bytes → extractPdfText (unpdf, Node)
          ──▶  statement text
          extract-holdings-generator (LLM, strict output)  ──▶  pdfImport resource
          ──session.refresh()──▶  client reads pdfImport via useResource
client:   reconcile(extraction)  (pure, deterministic — NOT the LLM)
          ──▶  review table: per-row check + total check + skipped rows
          ──user CONFIRMS──▶  toCanonicalRows → canonicalRowsToCsv
          ──sendAction("importHoldings", { csvText })──▶  EXISTING import path
```

Three responsibilities, three different mechanisms:

1. **PDF → text**: deterministic, SERVER-side, `unpdf` (worker-free pdfjs in Node).
2. **text → structured rows**: an LLM (broker-agnostic transcription). The ONLY
   model step.
3. **rows → trust → import**: deterministic TS (reconciliation + canonical
   mapping) + the existing `importHoldings`. NEVER the LLM.

> **Streaming progress is a deferred follow-up.** The dialog shows a single
> "Processing…" state (a spinner + label) for the whole server round-trip
> (decode → extract → LLM). Streaming per-page / per-phase progress back to the
> dialog is a follow-up — server-side extraction makes it straightforward. See
> `BUILD_PLAN.md` §10.

## Decisions

### Server-side text extraction (unpdf, worker-free)

`src/flows/trading-desk/portfolio/extract-pdf-text.server.ts` extracts the PDF
text on the SERVER with `unpdf` (a worker-free, serverless pdfjs build). The
dialog uploads the PDF bytes (base64-encoded); the `extractHoldingsFromPdf`
action's first step decodes them and calls `extractPdfText`. Rationale:

- **pdfjs's worker fought the bundler from both ends.** pdfjs needs a worker to
  parse a PDF. In the browser that worker's URL resolved unreliably under turbopack
  (Next 16's dev bundler) and `getDocument()` hung forever (the dialog stuck on
  "extracting"). Moving to the server didn't escape it: `pdfjs-dist`'s "fake worker"
  dynamically imports `pdf.worker.mjs`, which turbopack rewrote to a `.next` chunk
  it never emitted ("Setting up fake worker failed: Cannot find module"). `unpdf`
  has NO worker at all — it parses on the Node main thread — so the whole class is
  gone. It is kept out of the server bundle via `serverExternalPackages` in
  `next.config.mjs` (belt-and-suspenders against turbopack).
- **No new privacy exposure.** The extracted holdings already go to the server and
  on to the LLM transcription, so the statement's content already leaves the
  browser. The raw bytes simply travel the same path the text already did.
- **Target PDFs are text-based, not scanned**, so a text extractor is enough — no
  OCR. A scanned image PDF yields empty text; the decode step detects that and
  throws a clear error the dialog surfaces rather than importing nothing.

`extract-pdf-text.server.ts` is NODE-ONLY (it imports `unpdf`) and lives in the
server flow tree, named `.server.ts`, so it never gets imported from client code.
It copies the incoming bytes into a plain `Uint8Array` first (pdfjs rejects a Node
`Buffer`, which extends `Uint8Array`). Its linearization logic (space-join within a
line, newline on `hasEOL`, blank line between pages, marked-content items skipped)
is unit-tested offline with `unpdf` MOCKED in `test/extract-pdf-text.server.spec.ts`
— which also asserts a true `Uint8Array`, never a `Buffer`, reaches it.

Dependency change: `unpdf` was ADDED and `pdfjs-dist` REMOVED (unpdf vendors its
own worker-free pdfjs). The browser-worker scaffolding —
`components/portfolio/pdf-text.ts`, `scripts/copy-pdf-worker.mjs`, the copied
`/public/pdf.worker.min.mjs`, the worker-only `.gitignore`, and the
`copy-pdf-worker` prefix on the `dev`/`build` scripts — was REMOVED.

### LLM extraction, not a per-broker parser

`extract-holdings-generator.ts` is broker-agnostic by design. Every broker lays
the holdings table out differently (Wealthfront's `Security | Symbol/CUSIP |
Shares | Share Price | Value` is not Schwab's nor Fidelity's), and PDF text
extraction reorders/merges cells unpredictably. A per-broker text parser would be
a maintenance treadmill and silently wrong on an unseen layout. The model maps
columns by meaning; the strict schema + deterministic reconciliation are the
safety net that catches its mistakes.

- `agentName: "statementParser"` (added to `AGENTS`, reuses the `pm` team so it
  mints no new sidebar group — it never appears in `PHASE_GROUPS`).
- `uses: [tradingDesk]` for model selection (`intent/${costPreset}`) + the shared
  grounding clause. The prompt tells the model to IGNORE the `<ticker>`/`<date>`
  context tags (they describe an unrelated analysis) and read only the statement.
- BP-011: it is a generator composed into a SEQUENCER action, never a handler
  calling `block.run()`.

### Strict output schema (BP-016)

`pdfExtractionSchema` in `portfolio-pdf.ts`:

```
z.object({
  rows: z.array(z.object({
    ticker:    z.string().nullable(),
    quantity:  z.number().nullable(),
    costBasis: z.number().nullable(),   // ALWAYS null from a snapshot
    price:     z.number().nullable(),
    value:     z.number().nullable(),
  })),
  statedTotal: z.number().nullable(),
})
```

Every field is required at the object level; absence is `nullable` only — no
`optional`/`default`/`record`/`union`. Added to the strict walker in
`test/output-schemas-strict.spec.ts`.

### Resource channel (mirrors getQuotes / portfolioQuotes)

`sendAction` returns only a status envelope in this runtime, so the action writes
its result to a session-scoped, transient resource (`pdfImportResource`) that the
dialog reads via `useResource` after `session.refresh()`. This is the exact
pattern `getQuotes` → `portfolioQuotes` uses. The reconciliation is NOT stored —
it is a pure function of the rows, recomputed client-side, so the resource stays
the single source of truth.

### Deterministic reconciliation (never the LLM)

`reconcile()` in `portfolio-pdf.ts` is the trust gate. A holdings statement
carries shares AND price AND value for every row, plus a stated total — so we
re-derive the arithmetic ourselves:

- **Per row**: `quantity * price ~= value`. Within tolerance → `ok`; both present
  and out of tolerance → `mismatch` (flagged); an input missing → `unchecked`.
  Tolerance: `max($0.02, 0.5%)` — absorbs fractional-share rounding without
  masking a dropped-digit transcription error.
- **Total**: `Σ(stated value) ~= statedTotal`. Tolerance `max($1, 0.5%)` (a
  portfolio of N rows accumulates N roundings). `unchecked` when the statement
  prints no total.

Both surface in the review table (a per-row ✓ / `≠ computed`, and a total-check
banner). Boundary behavior is pinned by unit tests.

### Mandatory review + confirm — NEVER auto-import

The dialog (`import-pdf-dialog.tsx`) is a parallel of `import-csv-dialog.tsx` with
a three-phase flow (pick → extracting → review). The user SEES the transcribed
rows, both reconciliation results, and the skipped rows, and must click **Confirm
import**. On confirm, the importable rows are mapped to `CanonicalRow[]` and
serialized to the SAME CSV `importHoldings` parses — so re-validation, dedupe-
merge, and `(account, ticker)` keying are all reused. `replace-account` keeps its
typed `REPLACE` confirmation.

### Honesty (real money)

- **No cost basis.** A holdings snapshot has no cost basis — only shares, the
  current mark, and current value. Every imported row gets `costBasis: null`; we
  never derive a cost from the snapshot price (that is the mark, not what the user
  paid). The review banner states: "cost basis is NOT in this statement … add it
  manually later for P/L." `toCanonicalRows` forces `costBasis: null` even if the
  model emits something, and `canonicalRowsToCsv` deliberately emits NO price
  column (the CSV parser would map a bare `price` to cost — exactly wrong here).
- **Skipped rows are reported, not silently dropped.** A row is skipped when it
  has no valid ticker (blank, or a contra-CUSIP like `436CVR021`), is cash/sweep,
  is a money-market fund, or has zero/no quantity. Each skip carries a 1-based row
  number + human reason, shown in the dialog.
- **MMF + cash handling.** Money-market funds (TIMXX, SPAXX, …) and cash are
  account-level cash equivalents, NOT equity positions. Importing them as holdings
  would pollute the holdings table and double-count against the account
  `cashBalance`. They are skipped + reported; the user enters cash via the
  account's existing cash field. MMF detection is broker-agnostic: a symbol ending
  in `XX` AND priced at ~$1.00 (the dual signal keeps it conservative; a missing
  price never triggers a false MMF skip). Folding a detected MMF balance into
  account cash automatically is a documented future seam, not built.
- **Contra-CUSIP detection.** A 9-char all-alphanumeric token containing a digit
  is treated as a CUSIP, not a ticker (real exchange tickers are ≤ ~6 chars). The
  generator emits `ticker: null` for symbol-less rows anyway; the CUSIP heuristic
  is the deterministic backstop.
- **Provenance.** The extraction stamps `extractedAt`; the source file name is
  display-only and tracked client-side by the dialog. Rows imported this way are
  not specially tagged in the holdings collection in v1 — they go through the same
  `importHoldings` upsert as CSV rows. (A `source: "imported-from-PDF"` field on
  `holdingStateSchema` is a candidate future seam; it was not added to avoid
  changing the committed Slice-4 schema for a display-only label.)

## Files

New:
- `src/flows/trading-desk/portfolio/portfolio-pdf.ts` — pure leaf: strict schema,
  `reconcile()`, `toCanonicalRows()`, `canonicalRowsToCsv()`.
- `src/flows/trading-desk/portfolio/portfolio-pdf-resource.ts` — session-scoped
  `pdfImport` resource.
- `src/flows/trading-desk/portfolio/extract-pdf-text.server.ts` — NODE-ONLY
  server-side PDF→text extraction (`unpdf`, worker-free).
- `src/flows/trading-desk/portfolio/extract-holdings-generator.ts` — the
  broker-agnostic extraction generator.
- `src/flows/trading-desk/portfolio/extract-holdings-action.ts` — the
  decode + generator + commit-tap sequencer action.
- `components/portfolio/import-pdf-dialog.tsx` — the review/confirm dialog.
- `test/portfolio-pdf.spec.ts` — reconciliation + mapping unit tests.
- `test/extract-pdf-text.server.spec.ts` — linearization unit tests (mocked `unpdf`).
- `test/pdf-import-e2e.spec.ts` — action wiring (mocked extractor + generator) +
  flow into the existing `importHoldings`.

Changed:
- `src/flows/trading-desk/agents.ts` — added the `statementParser` agent.
- `src/flows/trading-desk/flow.ts` — registered the action + resource.
- `test/output-schemas-strict.spec.ts` — added `pdfExtractionSchema` to the walker.
- `components/portfolio/portfolio-pane.tsx` — added the "Import PDF" button + dialog.
- `examples/trading-desk/package.json` — `unpdf` added, `pdfjs-dist` removed; the
  `dev`/`build` scripts reverted to plain `next dev` / `next build`.
- `next.config.mjs` — `serverExternalPackages: ["unpdf"]` (keep it out of the
  server bundle so its worker-free pdfjs loads from node_modules).

Removed (browser-worker scaffolding):
- `components/portfolio/pdf-text.ts` — the client pdfjs extractor.
- `scripts/copy-pdf-worker.mjs` — the build-step worker copier.
- `public/pdf.worker.min.mjs` — the copied worker artifact.
- `examples/trading-desk/.gitignore` — its only entry was the worker.

## What is NOT verified offline

Live extraction ACCURACY on a real statement (column mapping, fractional shares,
the TIMXX/contra-CUSIP/$0.00 rows) cannot be tested without a real PDF. The
offline suite mocks `unpdf` (the linearization-logic unit test) and the generator,
and tests only the deterministic reconciliation + mapping + wiring. The real
`unpdf` parse (worker-free pdfjs in Node) is exercised by the dev server, not the
offline suite. Validate accuracy with a real Wealthfront /
Schwab / Fidelity statement via `fsdev`/the dev server before relying on it.
```
