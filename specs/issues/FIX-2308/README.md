# FIX-2308: the Teammates lab's own Grok Bot-like theme

A change with no spec: the issue is the unit of intent. The lab drops the
design system's Shift Manager stylesheet for a local theme, `src/lib/theme.css`,
which sets the same token names over the registry's `tokens` item. This is a
deliberate exception to the FIX-2152 epic's rule that labs take their theme
from the design system: this lab should read as the app it copies.

`assets/` holds each lab screen before and after, 1280×860, from `fsdev dev`
on one stored conversation (a real `openai/gpt-5.4-mini` run), so the two sets
show the same content:

- `1-empty`: lead's conversation before anything is said (the "after" one from
  a fresh store).
- `2-lead-top`, `3-lead-bottom`: lead's conversation: your lines, a message to
  researcher, its reply, Markdown (heading, table, link, highlighted code), a
  coding task waiting for a project, and the task's ending.
- `4-talk-panel`: the Talk panel, open beside lead.
- `5-researcher`: researcher's conversation, with the message it received.
- `6-coder`: coder, which takes tasks only, with its task card.
