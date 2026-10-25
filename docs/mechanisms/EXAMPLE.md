# Fence example

Not a spec. A file the checker can run so the opt-in fence has a passing example.

```mechanisms
uses:
  - task
  - sequencer-dsl
extends:
  - task.notice-taken
adds:
  - name: a fifth notice marker
    considered:
      - task.held-ending
      - task.notice-taken
      - task.notice-deferred
      - task.lapsed-slot-backoff
    because: |
      The four records already cover a lapsed wait, a delivery claim, a deferral, and the backoff. This example says which job it would repeat.
```
