---
---

Internal only — no published package changes.

Adds one model-free goal, `goals/context-supply/assembles-the-same-brief-every-pass`, proving that a phase's context recipe hands the model a byte-identical brief on every pass and that its standing half survives a change of issue. Nothing reusable ships: no assembly machinery, no recipe format, no persistence, no second phase. Three files in one goal folder; no workspace member, no config edit, no change to any package.

The recipe is a real generator run through the real `runAction`, so what is measured is the framework's own message assembly rather than a helper written for the test. The stub is step-capable and its legacy `generate` throws, because a `generate()`-only stub drives the SDK-owned compatibility path production never takes — and would have passed green while measuring the wrong mechanism.

The assembly seam was deterministic across every pass, so there is no framework finding to file.
