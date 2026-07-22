# Plan 010: Support mixed image and text File Attachments

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When done, update
> this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
> `rtk git diff --stat 56b3117..HEAD -- apps/desktop/src/shared/chat.ts apps/desktop/src/shared/imageAttachment.ts apps/desktop/src/shared/imageAttachment.test.ts apps/desktop/electron/attachments/attachmentStore.ts apps/desktop/electron/attachments/attachmentStore.test.ts apps/desktop/electron/attachments/attachmentIpc.ts apps/desktop/electron/attachments/attachmentIpc.test.ts apps/desktop/electron/preload.ts apps/desktop/src/renderer/env.d.ts apps/desktop/src/renderer/lib/imageAttachments.ts apps/desktop/src/renderer/lib/imageAttachments.test.ts apps/desktop/src/renderer/components/chat/Composer.tsx apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.tsx apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/mock/uiShellData.ts apps/desktop/src/renderer/hooks/chatMessageQueue.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/context/WorkspaceContext.tsx apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.ts apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/electron/chat/chatPrompt.ts apps/desktop/electron/chat/chatPrompt.test.ts apps/desktop/electron/chat/chatSessionManager.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/kimiAcpChat.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/CONTEXT.md docs/adr`
> Compare any changed file with the Current state and product contract below.
> A semantic mismatch is a STOP condition.
>
> **Dirty-worktree warning**: when this plan was authored, the user's working
> tree already contained uncommitted changes in `Composer.tsx`,
> `chatMessageQueue.ts`, and adjacent renderer files. Do not overwrite, revert,
> or silently omit those changes. Execute only after the operator has committed
> them or in a worktree that contains them; otherwise stop and ask for the
> intended base.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none, but preserve the uncommitted queue/composer work noted above
- **Category**: direction
- **Planned at**: commit `56b3117`, 2026-07-22

## Why this matters

Carrent already accepts multiple images, but every layer names and validates the
payload as `ImageAttachment`. The file picker rejects non-images, history can
only render thumbnails, and Kimi ACP turns every attachment into an image block.
Changing only the input `accept` attribute would let users select files that the
main process rejects or the Runtime cannot consume.

Generalize the existing attachment path end to end. One user message may contain
any mixture of the existing image formats and multiple UTF-8 text files such as
source code, Markdown, JSON, YAML, logs, CSV, SVG markup, or extensionless config
files. Keep snapshots in Carrent's app-data attachment store, persist metadata
only, render non-image files as compact File Attachment rows, and send them to
Kimi as ACP `resource_link` blocks with exact read-only access to those stored
files.

## Required product contract

Implement this behavior exactly:

1. Keep the existing limit of 30 total attachments per message, 10 MB per
   attachment, and 100 MB total. The limits apply to the mixed set, not once per
   attachment kind.
2. Preserve existing native support for PNG, JPEG, WebP, and GIF Image
   Attachments.
3. Add File Attachment support for bytes that are valid UTF-8. Do not require a
   known extension or a non-empty browser MIME type.
4. Treat unsupported image MIME types that contain valid UTF-8, such as SVG, as
   File Attachments rather than image previews.
5. Reject binary non-image files with a clear message. PDF, Office documents,
   audio, video, archives, and arbitrary binary formats are out of scope for
   this increment.
6. One selection or paste may contain multiple files and may mix images and text
   files. Validate the entire combined pending set before accepting any newly
   selected file.
7. Preserve the original bytes and original display name. Store only a generated
   storage key in Carrent-controlled app data; never write attachments into the
   project.
8. Keep raw app-data paths out of visible messages and `workspace.json`.
9. Pending and sent images keep the existing thumbnail/lightbox behavior.
   Pending and sent File Attachments use a compact fixed-height row with a
   `FileText` or `FileCode` icon, truncated name, byte-size label, and full name
   in a tooltip. File rows do not open the image lightbox.
10. Attachment-only messages remain sendable. Use the existing image-only
    default for all-image messages; use a generic attached-files default when at
    least one File Attachment is present.
11. Kimi receives images as ACP `image` blocks and File Attachments as ACP
    `resource_link` blocks, in the user's original attachment order.
12. A Kimi Runtime Session may read only the exact File Attachment paths present
    on its current `ChatTurnRequest`. It may not write them, enumerate the
    attachment directory, or read another Thread's attachment by guessing a
    storage key.
13. Existing image history without an attachment `kind` must continue to load as
    images. Do not bump the workspace snapshot version for this additive change.
14. Queued messages, message edits, thread deletion, and project deletion must
    preserve or clean up the generalized attachment metadata exactly as they do
    for images today.
15. Do not add folders, drag-and-drop, cloud upload, attachment mutation in sent
    history, arbitrary binary parsing, or a new dependency.

## Current state

### Relevant decisions and vocabulary

- `apps/desktop/CONTEXT.md:107-120` distinguishes **Image Attachment** from the
  broader **Thread Attachment** and **File Attachment**. Use those terms in UI,
  tests, and docs; avoid `upload` in product copy.
- `docs/adr/0003-store-image-attachments-for-history-and-agent-access.md`
  requires Carrent-owned app-data snapshots, metadata-only workspace history,
  and no hidden directories in user projects.
- `docs/adr/0007-reference-files-instead-of-uploading-them.md` already decides
  that a File Attachment is copied as a stable snapshot and that folders are a
  separate additional-directory concept. Its singular wording does not yet
  describe mixed multi-file messages.
- `.scratch/image-attachments/PRD.md` is an implemented historical PRD. It
  explicitly excludes general File Attachments. Do not rewrite it; record the
  new decision in a new ADR.

### Shared request and persistence types are image-specific

`apps/desktop/src/shared/chat.ts:11-23`:

```ts
export type ImageAttachmentMetadata = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  width?: number;
  height?: number;
};

export type ImageAttachment = ImageAttachmentMetadata & {
  localPath?: string;
};
```

`ChatTurnRequest.attachments`, renderer `Message.attachments`, queued messages,
workspace normalization, preload types, and deletion ownership all use this
type. `workspacePersistence.ts:46-63` accepts image metadata and strips
runtime-only fields before saving.

Generalize the type while keeping the persisted field name `attachments` and
the deletion field `attachmentStorageKeys`. Renaming those serialized fields
would create an unnecessary migration.

### Validation and storage only recognize four image MIME types

`apps/desktop/src/shared/imageAttachment.ts:1-10` defines the current limits and
supported image list. `validateImageAttachments` rejects every non-image, and
`extensionForMimeType` returns `bin` for unknown MIME types.

`apps/desktop/electron/attachments/attachmentIpc.ts:29-37` repeats image-only
validation in the main process before writing bytes. This boundary must remain
authoritative: renderer validation improves UX but cannot replace IPC
validation.

`attachmentStore.ts:42-55` creates `<uuid>.<mime-derived extension>` and returns
image metadata. The storage-key traversal protection and exact-byte writes are
already correct; preserve them.

### The Composer already supports multiple images

At commit `56b3117`, `Composer.tsx:1264-1325` validates the combined pending set,
stores each selected file, and handles pasted images. The hidden input already
has `multiple`, but its `accept` value is image-only:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/png,image/jpeg,image/webp,image/gif"
  multiple
  className="hidden"
  onChange={(event) => {
    void handleAddFiles(event.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }}
/>
```

Pending items always create an object URL and always render `<img>` at
`Composer.tsx:2011-2047`. `MessageTimeline.tsx:113-168` likewise reads every
stored attachment into an image Blob and renders a thumbnail. Generic files
therefore need a separate presentation, not a relaxed image component.

### Runtime prompt construction assumes every attachment is an image

`apps/desktop/electron/chat/chatPrompt.ts:41-68` uses an image-specific default
message and an `Attached images:` path section for text-only runtimes.

`apps/desktop/electron/chat/kimiAcpChat.ts:301-342` reads every local attachment
and produces ACP image blocks:

```ts
for (const attachment of imageAttachments ?? []) {
  const data = await readFile(attachment.localPath);
  parts.push({
    type: "image",
    data: data.toString("base64"),
    mimeType: attachment.mimeType,
    uri: pathToFileURL(attachment.localPath).toString(),
  });
}
```

Kimi Code 0.27.0's ACP schema treats `resource_link` as a baseline prompt block.
Use this exact shape for File Attachments:

```ts
{
  type: "resource_link",
  uri: "file:///absolute/carrent/attachment/path",
  name: "original-name.ts",
  mimeType: "text/plain",
  size: 1234,
}
```

Do not embed text file contents into the initial prompt and do not use ACP blob
resources. Kimi 0.27.0 converts a file resource link to a path reference and can
then request its contents through `fs/read_text_file`.

### Kimi currently rejects every attachment path outside the workspace

`kimiAcpChat.ts:877-915` permits text-file access only inside the project or the
current Kimi Runtime Session's Plan Review path. Carrent's attachment store is
outside both roots, including in general chats. File Attachment resource links
will be unusable unless the current request's exact stored paths become a third,
read-only target kind.

Do not authorize the whole `attachments/` directory. Resolve and compare exact
real paths from `request.attachments`, and expose the original attachment name in
Agent Activity instead of the app-data path.

### Existing conventions to match

- Shared validation helpers live under `apps/desktop/src/shared` with adjacent
  Bun tests.
- Electron filesystem behavior is tested through public store/IPC functions and
  temporary directories.
- Renderer helpers use adjacent `.test.ts` files and avoid adding a DOM test
  framework. Static markup tests may use `react-dom/server`, as existing
  component tests do.
- UI uses Lucide icons, stable dimensions, theme tokens, compact controls, and
  accessible labels/titles. Follow `DESIGN.md`; do not add literal theme colors.
- Error messages are concise user-facing English strings.
- Git history uses Conventional Commit style, for example
  `feat(desktop): add image attachment support to composer and history`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Shared/IPC tests | `rtk bun test apps/desktop/src/shared/attachment.test.ts apps/desktop/electron/attachments/attachmentStore.test.ts apps/desktop/electron/attachments/attachmentIpc.test.ts` | all selected tests pass |
| Runtime tests | `rtk bun test apps/desktop/electron/chat/chatPrompt.test.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/chatIpc.test.ts` | all selected tests pass |
| Renderer tests | `rtk bun test apps/desktop/src/renderer/lib/attachments.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/shared/workspacePersistence.test.ts` | all selected tests pass |
| Full tests | `rtk bun test` | all tests pass |
| Typecheck | `rtk bun run typecheck` | exit 0, no errors |
| Lint | `rtk bun run lint` | exit 0, no findings |
| Build | `rtk bun run build` | every workspace builds |
| Diff hygiene | `rtk git diff --check` | no whitespace errors |

## Scope

**In scope**:

The only files the executor may create, rename, or modify are:

- `apps/desktop/src/shared/chat.ts`
- `apps/desktop/src/shared/imageAttachment.ts` -> rename to
  `apps/desktop/src/shared/attachment.ts`
- `apps/desktop/src/shared/imageAttachment.test.ts` -> rename to
  `apps/desktop/src/shared/attachment.test.ts`
- `apps/desktop/electron/attachments/attachmentStore.ts`
- `apps/desktop/electron/attachments/attachmentStore.test.ts`
- `apps/desktop/electron/attachments/attachmentIpc.ts`
- `apps/desktop/electron/attachments/attachmentIpc.test.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/renderer/env.d.ts`
- `apps/desktop/src/renderer/lib/imageAttachments.ts` -> rename to
  `apps/desktop/src/renderer/lib/attachments.ts`
- `apps/desktop/src/renderer/lib/imageAttachments.test.ts` -> rename to
  `apps/desktop/src/renderer/lib/attachments.test.ts`
- `apps/desktop/src/renderer/components/chat/Composer.tsx`
- `apps/desktop/src/renderer/components/chat/Composer.test.ts`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.tsx`
- `apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts`
- `apps/desktop/src/renderer/mock/uiShellData.ts`
- `apps/desktop/src/renderer/hooks/chatMessageQueue.ts`
- `apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts`
- `apps/desktop/src/renderer/context/WorkspaceContext.tsx`
- `apps/desktop/src/renderer/context/WorkspaceContext.test.ts`
- `apps/desktop/src/shared/workspacePersistence.ts`
- `apps/desktop/src/shared/workspacePersistence.test.ts`
- `apps/desktop/electron/chat/chatPrompt.ts`
- `apps/desktop/electron/chat/chatPrompt.test.ts`
- `apps/desktop/electron/chat/chatIpc.ts`
- `apps/desktop/electron/chat/chatIpc.test.ts`
- `apps/desktop/electron/chat/chatSessionManager.ts`
- `apps/desktop/electron/chat/chatSessionManager.test.ts`
- `apps/desktop/electron/chat/kimiAcpChat.ts`
- `apps/desktop/electron/chat/kimiAcpChat.test.ts`
- `apps/desktop/CONTEXT.md` only if a glossary sentence must be clarified; do
  not rename existing domain terms
- `docs/adr/0010-support-file-attachments-as-read-only-snapshots.md` (create)
- `plans/010-mixed-file-attachments.md` only for status updates
- `plans/README.md` only for status updates

**Out of scope**:

- PDF, Office, audio, video, archive, executable, or other binary File
  Attachments.
- Folders or an `--add-dir` equivalent.
- Drag-and-drop. Preserve existing file-picker and clipboard entry points only.
- Opening, saving-as, editing, deleting, or replacing a sent File Attachment.
- Adding attachment contents to transcript text or visible message content.
- Automatic orphan cleanup, expiry, deduplication, or content-addressed storage.
- Changing attachment-count/size limits.
- Adding native file blocks for disabled Codex, Claude Code, or pi runtimes.
- A MIME database, syntax highlighter, file previewer, new state library, or new
  package dependency.
- Rewriting the implemented `.scratch/image-attachments/PRD.md`.

## Git workflow

- Branch: `codex/plan-010-file-attachments`
- Suggested commit: `feat(desktop): support mixed file attachments`
- Keep one focused commit unless the operator requests otherwise.
- Do not push or open a PR unless instructed.
- Include screenshots of a mixed pending attachment set and the corresponding
  sent user message in Night and Paper themes.

## Steps

### Step 1: Generalize the shared attachment model and validation

Rename the shared image helper and test with `rtk git mv`, then replace the public
image-only model with:

```ts
export type AttachmentKind = "image" | "file";

export type AttachmentMetadata = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  width?: number;
  height?: number;
};

export type Attachment = AttachmentMetadata & {
  localPath?: string;
};
```

Use `AttachmentMetadata[]` for `ChatTurnRequest.attachments`, messages, composer
submit requests, queued messages, workspace context methods, preload results,
and tests. Do not rename the serialized `attachments` field.

In `src/shared/attachment.ts`:

1. Keep the three current limits with attachment-generic names and messages.
   Add exact metadata bounds: attachment id at most 128 characters, original
   name at most 255 UTF-8 bytes, MIME type at most 255 characters, and storage
   key at most 128 characters.
2. Keep `SUPPORTED_IMAGE_MIME_TYPES` and `isSupportedImageMimeType` for image
   classification.
3. Add `classifyAttachmentBytes({ mimeType, data })`:
   - return `image` for the four supported image MIME types;
   - otherwise use `new TextDecoder("utf-8", { fatal: true })` on the bytes and
     return `file` when decoding succeeds;
   - return a structured rejection for invalid UTF-8 binary input.
4. Add `validateAttachmentSelection` for count, per-file size, and total size.
   It accepts only `{ size: number }[]`; byte/type validation remains in the
   authoritative IPC path.
5. Add a safe storage-extension helper. Images retain MIME-derived extensions.
   File Attachments preserve a short ASCII alphanumeric original extension when
   present; otherwise use `txt`. The generated UUID remains the filename stem.
6. Move the current storage-key pattern into a shared
   `assertValidAttachmentStorageKey` helper so the store and `chat:send` parser
   enforce the same traversal-safe rule.
7. Add `isImageAttachment` and `isFileAttachment` type guards used by renderer
   and Runtime code.

Required shared tests:

- mixed image/file selections obey one shared count and total limit;
- all four image MIME types classify as images;
- UTF-8 source bytes classify as files even with empty MIME or an unknown
  extension;
- UTF-8 SVG classifies as a file, not an image;
- invalid UTF-8 PDF-like/binary bytes are rejected;
- a safe original extension is preserved while unsafe/long extensions fall back
  to `txt`;
- existing image extension mappings remain unchanged.

Update imports across the declared scope. Do not leave compatibility aliases
named `ImageAttachmentMetadata`; completing the rename is part of the done
criteria.

**Verify**:
`rtk bun test apps/desktop/src/shared/attachment.test.ts`
-> all new classification, validation, and extension tests pass.

### Step 2: Make Electron storage and IPC authoritative for mixed files

Update `attachmentStore.ts` to return `AttachmentMetadata` and use the new safe
extension helper. Keep exact bytes, UUID storage keys, traversal validation,
read, resolve, and delete behavior unchanged. Replace its private storage-key
regex with the shared `assertValidAttachmentStorageKey` helper; do not maintain
two patterns.

Update `attachmentIpc.ts` so `readStoreInput`:

1. validates object shape, a non-empty bounded display name, byte data, and the
   10 MB single-attachment limit;
2. classifies the actual bytes instead of trusting the renderer's proposed
   kind;
3. normalizes an empty File MIME type to `text/plain` while preserving supplied
   image MIME types;
4. passes the authoritative `kind` into the store;
5. returns a clear binary rejection such as
   `Unsupported file type. Attach PNG, JPEG, WebP, GIF, or UTF-8 text files.`

Do not accept a renderer-provided local path or storage key. Do not inspect file
contents by extension alone.

Update preload and `env.d.ts` to return `AttachmentMetadata`. Keep the existing
`attachments:store` and `attachments:read` channel names; no new IPC channel is
required.

Required store/IPC tests:

- store and read a UTF-8 `.ts` File Attachment with exact bytes and `.ts`
  storage extension;
- store an extensionless UTF-8 file with `.txt` storage extension;
- accept a mixed sequence through repeated public store calls;
- reject invalid UTF-8 binary data and an oversized file;
- prove a fake renderer `kind` cannot override byte-based classification (omit
  `kind` from the input contract entirely);
- preserve storage-key traversal and deletion tests.

**Verify**:
`rtk bun test apps/desktop/electron/attachments/attachmentStore.test.ts apps/desktop/electron/attachments/attachmentIpc.test.ts`
-> all existing security tests and new File Attachment cases pass.

### Step 3: Render and send mixed attachments from the Composer

Rename the renderer attachment helper and test with `rtk git mv`. Change `PendingAttachment` so
only images own a `previewUrl`; File Attachments must not create or revoke object
URLs. Add small pure helpers for:

- converting a stored metadata result plus `File` into a pending item;
- filtering pending image items for the lightbox;
- formatting attachment byte sizes;
- selecting the correct compact file icon from the original extension, without
  adding a syntax/type registry.

In `Composer.tsx`:

1. Rename `storeImageAttachmentFile` to `storeAttachmentFile` and make bridge
   errors attachment-generic.
2. Replace `validateImageAttachments` with the mixed selection validator before
   any new file is stored.
3. Store every selected file through the existing preload bridge. If the IPC
   rejects one file, show `Failed to attach <name>: <reason>`, stop processing
   later files, and preserve the text plus already accepted pending items. Do
   not silently omit the rejected file.
4. Remove the input's image-only `accept`; keep `multiple`.
5. Paste every clipboard `File`, not only `image/*`, and prevent default only
   when at least one clipboard file is handed to `handleAddFiles`.
6. Render image pending items with the current 64px thumbnail/remove treatment.
   Render File Attachments as fixed-height compact rows with icon, truncated
   filename, formatted size, and the same remove command.
7. Build lightbox items from image pending items only. Removing a File
   Attachment must never shift an open image lightbox to a file row.
8. Generalize all send/edit/queue metadata types. Keep selection order when
   calling `metadataOnly` and constructing `ChatTurnRequest.attachments`.
9. Replace the queued-message image count icon with `Paperclip` and a total
   attachment count. Preserve the user's current uncommitted queue editing and
   steer behavior.
10. Revoke only existing image preview URLs when removing, sending, queuing, or
    unmounting.
11. Change the toolbar control to a `Paperclip` icon with title and accessible
    label `Attach files`; keep the compact existing layout.

Do not add a modal file browser, drop zone, nested card, or file-content preview.

Required renderer/helper tests:

- storing a UTF-8 file sends its name, MIME, and bytes through the preload
  bridge and returns File Attachment metadata;
- pending images create preview URLs while pending files do not;
- byte-size formatting covers bytes, KB, and MB deterministically;
- mixed pending items preserve order and filter lightbox items correctly;
- generic bridge errors no longer say `Image attachments are unavailable`;
- queued messages retain mixed `AttachmentMetadata[]` unchanged.

**Verify**:
`rtk bun test apps/desktop/src/renderer/lib/attachments.test.ts apps/desktop/src/renderer/components/chat/Composer.test.ts apps/desktop/src/renderer/hooks/chatMessageQueue.test.ts`
-> all existing Composer/queue tests and new mixed attachment cases pass.

### Step 4: Preserve mixed File Attachments in history and workspace state

Update `uiShellData.ts`, `WorkspaceContext.tsx`, and related tests to use
`AttachmentMetadata`. Keep the current ownership calculation based on
`storageKey`; it already works for any attachment kind.

Update `workspacePersistence.ts`:

1. rename `normalizeImageAttachmentMetadata` to
   `normalizeAttachmentMetadata`;
2. accept `kind: "image" | "file"` for new snapshots;
3. when `kind` is absent, accept the record only if its MIME type is one of the
   four legacy supported image types, then backfill `kind: "image"`;
4. strip `localPath`, base64, and every unknown runtime-only field as today;
5. keep `WORKSPACE_SNAPSHOT_VERSION = 1`.

In `MessageTimeline.tsx`, split attachments by kind:

- images use the current `StoredAttachmentThumbnail` and
  `ImageAttachmentLightbox` path;
- files render a compact unframed attachment list inside the user message using
  the same icon/name/size presentation as the Composer, but without a remove
  button or click-to-open behavior;
- image lightbox item indexes include images only;
- mixed messages display text, image thumbnails, and file rows without raw
  paths or layout overlap;
- the existing message-edit path retains all attachment metadata unchanged.

Extract only a small local static-render seam if needed for tests. Do not create
a generic document viewer.

Required tests:

- a new mixed snapshot round-trips image and file metadata;
- a legacy image record without `kind` loads with `kind: "image"`;
- a non-image record without `kind` is discarded rather than guessed;
- runtime-only `localPath` and base64 remain absent after normalization;
- thread/project deletion collects File Attachment storage keys exactly like
  image keys;
- static user-message markup contains a filename and size for files, an image
  thumbnail for images, and no app-data path;
- message edit drafts preserve mixed attachments.

**Verify**:
`rtk bun test apps/desktop/src/shared/workspacePersistence.test.ts apps/desktop/src/renderer/context/WorkspaceContext.test.ts apps/desktop/src/renderer/components/chat/MessageTimeline.test.ts`
-> all existing persistence/deletion/history tests and new migration cases pass.

### Step 5: Send ACP resource links and authorize exact attachment reads

Generalize `chatPrompt.ts` first:

- keep `DEFAULT_IMAGE_ONLY_PROMPT` for an attachment-only message whose entire
  set is images;
- add `DEFAULT_FILE_ONLY_PROMPT`, for example
  `Inspect the attached files and summarize the relevant contents.`;
- rename the text-only augmentation to `Attached files:` and include all
  attachment names/paths without writing this text back to visible history;
- add tests for all-image, file-only, mixed, and no-attachment requests.

Add a focused `chat:send` attachment parser/validator in `chatIpc.ts` before the
request reaches `ChatSessionManager`. It must validate:

- `attachments` is absent or an array with at most 30 entries;
- every entry has a valid `kind`, non-empty bounded `id`, `name`, `mimeType`,
  safe `storageKey`, finite non-negative `size`, and no renderer-supplied
  `localPath`;
- each metadata size is at most 10 MB and the summed size is at most 100 MB.

Return a sanitized `ChatTurnRequest` containing only the declared metadata
fields. Main-process validation cannot prove the metadata byte size equals the
stored file without changing the store contract; exact-byte classification and
single-file size enforcement remain owned by `attachments:store`.

Update `buildKimiPromptParts` in `kimiAcpChat.ts` to iterate the original
attachment array once:

- add the text part first when message/default text is non-empty;
- for `kind === "image"`, read bytes and emit the existing ACP image block;
- for `kind === "file"`, do not read or base64 the bytes during prompt
  construction; emit `resource_link` with `pathToFileURL(localPath)`, original
  name, normalized MIME, and size;
- when including transcript for a fresh session, strip `localPath` from the
  request passed to `buildChatPrompt`, but still append every attachment block
  after the transcript text;
- preserve attachment order after the leading text part.

Extend Kimi's file boundary with exact request-scoped authorization:

1. Build a map from each current File Attachment's canonical real path to its
   original display name before sending the prompt. Missing stored files should
   fail the Run with a clear attachment-unavailable error.
2. In `resolveTextFileTarget`, after the workspace check and before the Kimi
   plan-path check, allow an exact canonical-path match only when
   `access === "read"`.
3. Return an `attachment` target kind with the original name. Emit Agent
   Activity such as `Read config.json`; never display the app-data path.
4. Reject writes to File Attachments and reject sibling files in the same
   attachment directory.
5. Resolve symlinks/canonical paths before comparison. Do not authorize by
   lexical prefix or storage-directory membership.

Update `chatSessionManager.ts` to use generalized `Attachment` paths without
changing thread deletion or Runtime Session behavior.

Required Runtime tests:

- `chat:send` rejects too many attachments, oversized metadata, invalid kind,
  unsafe storage keys, and renderer-supplied local paths before starting a Run;
- Kimi emits one text part followed by mixed image and resource-link parts in
  selection order;
- a file-only request uses the generic default prompt;
- transcript replay does not duplicate attachment paths in visible text;
- `resource_link` contains the original name, MIME, size, and file URI but no
  embedded bytes;
- Kimi may read the exact current File Attachment through
  `fs/read_text_file`;
- Kimi cannot write that attachment;
- Kimi cannot read a sibling attachment not present on the request;
- Kimi cannot escape via a symlink or guessed app-data path;
- workspace and current Plan Review file access tests still pass unchanged;
- image-only ACP behavior remains byte-for-byte compatible with existing tests.

**Verify**:
`rtk bun test apps/desktop/electron/chat/chatPrompt.test.ts apps/desktop/electron/chat/kimiAcpChat.test.ts apps/desktop/electron/chat/chatSessionManager.test.ts apps/desktop/electron/chat/chatIpc.test.ts`
-> all Runtime prompt and filesystem-boundary tests pass.

### Step 6: Record the expanded decision and run repository gates

Create `docs/adr/0010-support-file-attachments-as-read-only-snapshots.md` with a
short decision that states:

- Carrent now supports one or more mixed Image and UTF-8 File Attachments per
  message;
- every file is copied into Carrent's attachment store as a stable snapshot;
- File Attachments are sent as ACP resource links and are readable only through
  exact current-request paths;
- images retain native image blocks and previews;
- folders remain additional directories, not attachments;
- binary non-image formats remain unsupported until the primary Runtime exposes
  a reliable binary/document input path;
- this extends ADR 0003 and supersedes only the single-file cardinality wording
  in ADR 0007.

Then run, in order:

1. `rtk bun test`
2. `rtk bun run typecheck`
3. `rtk bun run lint`
4. `rtk bun run build`
5. `rtk git diff --check`
6. `rtk git status --short`

Expected results: every command exits 0. Status contains only the declared
source/docs paths plus the two plan status files. There are no stale
`ImageAttachmentMetadata`, `ImageAttachment`, `validateImageAttachments`, or
`storeImageAttachmentFile` references outside the image-lightbox component name
and the historical image PRD/ADR.

Start the desktop app and verify in both a project Thread and general chat:

- select at least two files at once, including one PNG and one `.ts`/`.md` file;
- paste multiple clipboard files when the OS exposes them as `File` items;
- remove an image and a file independently before send;
- send text plus mixed attachments and an attachment-only mixed message;
- inspect sent history before and after app restart;
- open image lightbox navigation and confirm files are excluded;
- confirm Kimi reads the attached text file without requesting access to an
  unrelated app-data path;
- confirm a PDF or ZIP is rejected before the message is sent;
- repeat the visual check in Night and Paper themes and at the largest app text
  setting.

**Verify**:
`rtk git diff --check && rtk git status --short`
-> no whitespace errors and no out-of-scope files.

## Test plan

Use existing adjacent Bun tests and public seams. Do not add a browser test
framework or require a real Kimi account for automated tests.

Minimum regression matrix:

- Selection: multiple images, multiple text files, and one mixed selection.
- Classification: supported image, UTF-8 text with known MIME, UTF-8 text with
  empty MIME, SVG-as-file, invalid UTF-8 binary.
- Limits: shared count, single size, and total size across mixed attachments.
- Storage: exact bytes, safe extension, traversal rejection, deletion.
- Composer: mixed pending rendering helpers, removal, bridge failure, queue and
  edit resend metadata.
- Persistence: new `kind`, legacy image backfill, unknown legacy file rejection,
  runtime-field stripping.
- History: mixed image/file presentation, image-only lightbox indexes, no raw
  local paths.
- Prompt: all-image default, file/mixed default, generic path augmentation.
- ACP: native image block, resource link, original order, exact read allowlist,
  write/sibling/symlink refusal.
- Cleanup: thread and project deletion include every generalized storage key.

Focused verification commands are listed in each step. Final verification is
`rtk bun test`, `rtk bun run typecheck`, `rtk bun run lint`, and
`rtk bun run build`, all exiting 0.

## Done criteria

- [ ] A single Composer message accepts multiple files and a mixed set of PNG,
      JPEG, WebP, GIF, and UTF-8 File Attachments.
- [ ] PDF, Office, archive, audio, video, and other binary files are rejected
      with clear feedback before send.
- [ ] Existing total/count/size limits apply to the combined attachment set.
- [ ] Renderer and Electron both validate; IPC classifies actual bytes and does
      not trust renderer-provided attachment kind.
- [ ] Stored metadata uses `AttachmentMetadata` with `kind: "image" | "file"`;
      raw bytes and local paths are absent from `workspace.json`.
- [ ] Legacy persisted images without `kind` still load and render.
- [ ] Pending and sent images retain thumbnails/lightbox behavior; File
      Attachments render compact name/size rows and never enter the lightbox.
- [ ] Attachment-only image messages retain the old default prompt; file/mixed
      messages use the generic attached-files default.
- [ ] Kimi receives images as `image` blocks and files as `resource_link` blocks
      in selection order.
- [ ] Kimi can read only the exact current request's File Attachment paths and
      cannot write them or read sibling stored files.
- [ ] Queued messages, edit resends, workspace reload, Thread deletion, and
      Project deletion preserve generalized attachment behavior.
- [ ] New ADR 0010 records the product/runtime boundary and binary-file deferral.
- [ ] `rtk rg -n "ImageAttachmentMetadata|type ImageAttachment\\b|validateImageAttachments|storeImageAttachmentFile" apps/desktop` returns no matches, except an explicitly reviewed image-lightbox component/type name if it is intentionally retained.
- [ ] `rtk bun test` exits 0.
- [ ] `rtk bun run typecheck` exits 0.
- [ ] `rtk bun run lint` exits 0 with no findings.
- [ ] `rtk bun run build` exits 0.
- [ ] `rtk git diff --check` exits 0.
- [ ] No source or docs file outside the declared scope is modified.
- [ ] `plans/README.md` marks Plan 010 DONE.

## STOP conditions

Stop and report; do not improvise if:

- The user's uncommitted Composer/queue changes are absent from the execution
  base or conflict with attachment work.
- The primary enabled Runtime is no longer Kimi ACP or its prompt contract no
  longer accepts baseline `resource_link` blocks.
- Kimi requires binary embedded resources to consume the requested file types;
  this plan intentionally supports only UTF-8 non-image files.
- Supporting a selected file requires granting access to the whole attachment
  store, a home directory, or another Thread's files.
- Workspace persistence has moved to a version other than 1 or attachment
  metadata is stored outside `Message.attachments`.
- The current Image Attachment storage decision has been superseded and files
  are no longer Carrent-owned snapshots.
- Mixed attachment rendering requires replacing the Composer or timeline layout
  rather than extending the existing compact strip.
- A verification command fails twice after a reasonable local correction.
- Implementation requires a new dependency or a source file outside the
  declared scope.

## Maintenance notes

- Future PDF/Office/audio support needs a Runtime capability that reliably
  consumes binary/document content. Do not expand the allowlist based only on a
  file picker MIME string.
- If ACP later adds a binary read API or Kimi stops dropping embedded blob
  resources, revisit the `AttachmentKind` model before adding format-specific
  branches.
- The exact-path allowlist is a security boundary. Review canonicalization,
  symlink handling, read-only enforcement, and path redaction carefully.
- Automatic cleanup of pending/abandoned attachment snapshots remains deferred.
  If attachment sizes increase later, add a separate lifecycle plan rather than
  hiding cleanup changes inside format support.
- Keep image presentation separate from generic File Attachment presentation;
  the lightbox should not become a document viewer.
