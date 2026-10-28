# FIX-2289: Markdown in the Teammates lab's worker conversations

A fix with no spec: the issue is the unit of intent. The lab draws a worker's
text through the UI registry's `MessageResponse` (Streamdown), with Streamdown's
`raw` rehype plugin dropped so HTML a model writes shows as text.

`assets/` holds two shots of lead's conversation, 1280×860, from `fsdev dev`
on `openai/gpt-5.4-mini`, asked for a heading, a list, a TypeScript code block
and the literal text `<b>not bold</b>`:

- `streaming-open-code-block.png`: mid-answer, the code fence not yet closed,
  already drawn as a code block.
- `finished.png`: the same answer once it ended, highlighted, with no stray
  fence marks and the HTML shown as text.
