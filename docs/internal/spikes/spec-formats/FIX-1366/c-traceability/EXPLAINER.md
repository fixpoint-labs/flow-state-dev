# FIX-1366 · explainer

> **Control.** This is the explainer as it exists today on PR #1765, unchanged. Approach C keeps it beside the spec so the question "does a separate comprehension artifact still earn its place next to a grid-shaped spec?" is answered by comparison rather than by assertion. A, B and D fold it in.

## 1. Today

```mermaid
flowchart LR
  R["reader wants a worker"] --> O["Workforce → Overview<br/><i>the front door</i>"]
  O --> K["lead example:<br/>kinds map is the required step"]
  K --> P["kind named <b>worker-agent</b><br/><i>reads like a built-in</i>"]
  W["workers-on-disk.md<br/>line 258"] --> G["<b>good section already exists</b><br/>zero-code hire · no memory · factory"]
  G -.->|"never linked<br/>from the front door"| O
  G --> T["but its reference is thin:<br/>says 3 settings, API has 5+4"]
  AT["Atlas (public Pages root)"] --> S["calls a <i>removed</i> API<br/>'may not need to exist'"]
```

The built-in is **already taught** — and taught well — two-thirds down a page about the file format. The overview never mentions it. So the content is not missing; it is unfindable, sitting beside a placeholder name that reads like a shipped default, with an options list that undercounts the real API.

## 2. After (proposed)

```mermaid
flowchart LR
  R["reader wants a worker"] --> O["Overview: leads with<br/>zero-code hire, no kinds"]
  O --> M["names it, states<br/><b>no memory</b>"]
  M -->|"anchor link"| G["<b>same section, grown</b><br/>workers-on-disk.md"]
  G --> G1["complete inventory:<br/>5 app options · 4 worker settings"]
  G --> G2["everything else unchanged"]
  O --> F["custom kinds → <b>custom-agent</b>"]
  AT["Atlas: workforce.html"] --> AF["3 classes of false claim<br/>corrected, nothing else"]
```

**No new page.** The front door is reshaped to answer the question it is asked, and links into the section that already holds the answer. That section grows only where it was thin.

## 3. Where the decision fell

```mermaid
flowchart TD
  I["FIX-1366"] --> D1["grow + promote in place"]
  D1 -.->|"rejected, twice"| R1["new built-in-worker.md<br/>· then its redirect-stub variant"]
  R1 -.->|"why it died"| E["premise was 'nothing teaches it'<br/><b>— evidence said otherwise</b>"]
  I --> D2["reference becomes complete<br/>emphasis unchanged"]
  D2 -.->|"rejected"| R2["ship '3 options' as if whole"]
  I --> D3["Atlas: bounded factual pass,<br/>workforce.html only"]
  D3 -.->|"rejected"| R3["restructure · or sweep<br/>all 4 atlas pages"]
  I --> Z["found en route:<br/>shipped docstring asserts<br/>the wrong option count"]
  I --> Y["residue → FIX-1387:<br/>3 sibling atlas pages<br/>still assert removed API"]
```

Three calls. The branch worth reading is the dashed one under Decision 1: this spec argued for a new page, review produced the page that already existed, and the direction reversed. The classifier is documented but **not promoted** — opt-in, off by default.
