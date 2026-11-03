---
"@flow-state-dev/react": patch
---

`@flow-state-dev/react` exports `useSubmit(action)`, which holds a button or form while its async call runs (`busy`) and keeps the refusal's message to show (`error`) instead of throwing, so a double click sends a call once and a failure never looks like it worked (FIX-2372).
