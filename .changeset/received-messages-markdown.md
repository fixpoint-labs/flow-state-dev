---
"@flow-state-dev/shift-manager": patch
---

A message one worker sends another is drawn as Markdown in the conversation, as a worker's own replies are: tables, lists and code render, and a URL is a link. HTML in it shows as text, and an image is never loaded: it shows as `[Image blocked: <alt text>]`. The same holds for agent text on approval and review-hold cards. The DevTeam Lab's Shift Coordinator no longer restates a worker's message it was just sent; it says what the message means for you and what happens next (FIX-2792).

Docs: packages/shift-manager/README.md ("Messages between workers": a received message's text is drawn as Markdown).
