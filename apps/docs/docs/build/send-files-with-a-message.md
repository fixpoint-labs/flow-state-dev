---
title: Send files with a message
type: recipe
description: "Let users attach images, PDFs and text files to a chat message, so the model and coding harnesses read them on that turn and later ones."
---

# Send files with a message

A customer writing to support often has the answer in a file: a screenshot of the error, the invoice they were charged on. This page lets them attach it to the message.

A message takes images (PNG, JPEG, WebP, GIF), PDFs and text files (Markdown, CSV, JSON, YAML, HTML, XML, source code), up to 10 images and 5 documents, 20 MB a file. The browser uploads each file once, then sends a reference to it with the message.

## 1. Let the action take files

The action has to write the user's line with `userMessage`. The files go on that line after the text, so a reload shows them. An action without `userMessage` refuses files.

```ts title="src/flows/support/blocks/assistant.ts"
import { generator } from "@flow-state-dev/core";
import { attachmentsCapability } from "@flow-state-dev/core/attachments";
import { z } from "zod";

export const assistant = generator({
  name: "assistant",
  model: "openai/gpt-6-luna",
  prompt: "You answer support questions. Read any file the customer sends.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  uses: [attachmentsCapability],
  itemVisibility: { client: true, history: true },
});
```

```ts title="src/flows/support/blocks/ask.ts"
import { sequencer } from "@flow-state-dev/core";
import { recordAttachments } from "@flow-state-dev/core/attachments";
import { z } from "zod";
import { assistant } from "./assistant";

export const ask = sequencer({ name: "ask", inputSchema: z.object({ message: z.string() }) })
  .tap(recordAttachments)
  .step(assistant);
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { ask } from "./blocks/ask";

export default defineFlow({
  kind: "support",
  requireUser: true,
  actions: {
    ask: { block: ask, userMessage: (input) => input.message },
  },
})();
```

The files ride beside the input, so `inputSchema` never sees them. `recordAttachments` and `attachmentsCapability` are optional, and steps 5 and 6 say what each adds.

## 2. Upload, then send

```ts title="src/lib/ask-with-files.ts"
import { createClient } from "@flow-state-dev/client";
import { attachmentLimitRefusal, attachmentMediaType } from "@flow-state-dev/core/attachments";

export async function askWithFiles(userId: string, sessionId: string, message: string, files: File[]) {
  const support = createClient({ userId, baseUrl: "" }).flow("support");
  const typed = files.map((file) => ({ file, mediaType: attachmentMediaType(file) }));
  const refusal = attachmentLimitRefusal(typed);
  if (refusal) throw new Error(`Can't send ${files[refusal.index]!.name}: ${refusal.reason}`);

  const attachments = await Promise.all(
    typed.map(({ file, mediaType }) => support.upload({ data: file, mediaType, filename: file.name })),
  );
  return support.send("ask", { message }, { sessionId, attachments });
}
```

`upload` resolves to a `FileContent` whose `data` is a reference, `fsd-blob:<id>`. Send that, with a `sessionId`.

`attachmentLimitRefusal` runs the server's check on types and counts, so the page can refuse before uploading. `attachmentMediaType` types a text file by its extension; a browser types a `.ts` file as video.

`support.upload` checks the uploader with the flow's own sign-in; on an app without one, `client.upload` does the same. Every refusal the upload and send routes give, with its status code, is in the [HTTP API reference](../reference/http-api.md#attachments-voice-and-push).

## 3. A message box in React

```tsx title="src/app/support/composer.tsx"
"use client";

import { createClient } from "@flow-state-dev/client";
import { useDraftSend, useSession } from "@flow-state-dev/react";
import { useMemo } from "react";
import { useAttachments } from "@/components/flow-state/attachments";

export function Composer({ userId, sessionId }: { userId: string; sessionId: string }) {
  const session = useSession(sessionId);
  const uploader = useMemo(() => createClient({ userId, baseUrl: "" }).flow("support"), [userId]);
  const files = useAttachments({ client: uploader, sessionId });
  const box = useDraftSend("support", sessionId, files);

  const send = () =>
    box.submit((line, attachments) =>
      session.sendAction("ask", { message: line }, { userMessage: line, attachments }),
    );

  return (
    <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <textarea value={box.text} onChange={(event) => box.setText(event.target.value)} onPaste={files.onPaste} />
      <input type="file" multiple accept={files.accept} onChange={(event) => event.target.files && files.add(event.target.files)} />
      {files.files.map((file) => <span key={file.id}>{file.filename} ({file.status})</span>)}
      {box.failure && <p role="alert">{box.failure}</p>}
      <button disabled={!box.canSend || box.sending}>Send</button>
    </form>
  );
}
```

`useAttachments`, from the UI registry's `attachments` component, uploads each file as it is picked. `useDraftSend` waits for those uploads, hands their references to your send, and clears the box once it lands. A failed send keeps the text and the files and sets `failure`. A file refused during upload is never sent. The registry's ready-made box, `PromptInput`, is in the [UI components reference](../reference/ui-components.md#prompt-input-and-attachments).

## 4. What the model receives

On the turn that carries them, images go to the model as images. A PDF goes as a file to Anthropic, OpenAI and Google models, and as its extracted text to any other provider. A text file goes as text, headed with its file name.

With `history`, later turns carry earlier files too: counting back from the newest message, up to 10 images and 5 documents. An older file is named on its turn instead, as `[image: shot.png, not re-sent]`. Re-sent files are billed as input on every call; prompt caching keeps that cost down.

## 5. Let the model read an earlier document

`attachmentsCapability` in the generator's `uses` gives the model a `readAttachment` tool and a list of the session's newest documents. An earlier turn's document is named with its id instead of re-sent, and the model reads it when a question needs it, by id or by file name. It reads only this conversation's files. Images are not read this way and follow the step 4 rule. The capability reads the list `recordAttachments` keeps, so keep that step before the generator.

## 6. List a session's files

`recordAttachments` writes one entry per file into the session's `attachments` collection: `ref`, `filename`, `mediaType`, `requestId` (the turn that sent it) and `recordedAt`. No block or model can edit it, and it is deleted with the session.

```tsx title="src/app/support/session-files.tsx"
"use client";

import { useResourceCollectionList, useSession } from "@flow-state-dev/react";

type Entry = { filename: string | null; mediaType: string | null };

export function SessionFiles({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const { items } = useResourceCollectionList<Entry>(session, "attachments");
  return <ul>{items.map((item) => <li key={item.topic}>{item.clientData?.filename}</li>)}</ul>;
}
```

## 7. Files and coding harnesses

A turn's files reach Claude Code, Codex and Cursor too. From React, pass them as `useHarnessLines().send(prompt, { attachments })`. A line with files waits for the running turn to finish and goes as the next turn.

| Harness | Images | PDFs | Text files |
| --- | --- | --- | --- |
| Claude Code | Image blocks in the prompt | Document blocks | Text after the prompt |
| Codex | Image paths in a temporary folder outside the checkout | Text after the prompt | Text after the prompt |
| Cursor | Sent with the prompt | Text after the prompt | Text after the prompt |

A scanned PDF page has no text, and the text says so. A file a harness cannot read refuses the turn before it starts, naming the file and the harness. The per-harness details are in the [harness runs reference](../reference/harness-runs.md#per-agent-options).

A task filed from a message keeps its own copy of the message's files. Every run of the task gets them, and deleting the conversation leaves them; see [task fields](../reference/task-collections.md).

## Where the files are kept

Files are kept with the sessions: in `.fsdev/blobs/<profile>` under the working directory with SQLite or Postgres stores, in memory with memory stores. A database backup does not include them, so back that folder up too. To choose another folder, set the profile's `blobs` slot to `localBlobStores({ rootDir })` from `@flow-state-dev/engine`.

On Vercel the local disk does not last between requests, so uploads are refused until the `blobs` slot names a hosted store. See [Stores](../reference/stores.md#declaring-stores).

## Next

- [HTTP API](../reference/http-api.md#attachments-voice-and-push): the upload and read routes, size limits for PDFs and text files, and every refusal.
- [Generators](../reference/generators.md#history-and-user): how `history` carries earlier files.
- [UI components](../reference/ui-components.md#prompt-input-and-attachments): `PromptInput`, `useAttachments` and the attachment strip.
