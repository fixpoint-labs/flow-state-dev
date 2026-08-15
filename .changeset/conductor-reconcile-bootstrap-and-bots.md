---
---

Internal: fixes two reconciliation bugs in `@flow-state-dev/conductor` (private,
unpublished). A PR observed for the first time now emits every transition the
read reveals — closed, a settled CI conclusion, a lost merge — instead of only
its opening, by running the first observation through the ordinary diff against
a copy that holds nothing. And a machine's review no longer becomes a signal on
the polling path, matching the webhook path. No public API surface changes.
