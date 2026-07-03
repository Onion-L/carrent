# Image Attachments PRD

Status: implemented

## Problem Statement

Carrent 的 composer 现在主要支持纯文本输入。用户在和 Coding Agent 协作时，经常需要发送截图、UI 状态、报错图片、对比图或设计参考。如果只能描述图片内容，沟通成本高，Coding Agent 也更容易误解。

用户需要在 Agent GUI 里像现代聊天产品一样添加 Image Attachment：可以从输入框里粘贴或选择图片，发送前看到缩略图，发送后在历史消息里继续看到缩略图，点击后可以预览大图。Carrent 还必须保护用户内容边界：不要修改图片格式，不要把附件写进用户项目目录，不要把 raw path 暴露在历史正文里，也不要把大块图片数据塞进 workspace 状态文件。

## Solution

Carrent 支持用户在 composer 中添加 Image Attachment。图片可以通过粘贴和文件选择进入输入框，最多 30 张，支持 PNG、JPEG、WebP 和 GIF。单张图片最大 10MB，同一条消息总图片大小最大 100MB。

Carrent 在发送前将图片复制到自己维护的 app data attachment store。workspace 状态只保存消息和图片元数据，不保存 base64 图片内容，也不写入用户项目目录。用户可见历史只显示原始文本和图片缩略图，不显示 Carrent 管理的本地路径。

发送给 Runtime 时，Carrent 使用内部 payload 携带 Image Attachment 元数据和 Carrent 管理的稳定本地路径。支持原生图片输入的 Runtime 可以接收图片 part；只能接收文本 prompt 的 Runtime 可以在运行时 prompt 中临时获得图片路径，但这些路径不写回用户消息正文。

图片-only 消息可以发送。发送后 composer 清空，历史消息显示图片缩略图和用户原文。点击缩略图打开应用内 lightbox，背景压暗，展示大图，支持关闭、下载、缩放和多图切换。

## User Stories

1. As a Carrent user, I want to paste an image into the composer, so that I can quickly send screenshots to the Coding Agent.
2. As a Carrent user, I want to select images from disk, so that I can attach existing screenshots or design references.
3. As a Carrent user, I want image previews inside the composer, so that I can confirm I attached the right images before sending.
4. As a Carrent user, I want image previews to appear as thumbnails, so that the composer does not become too tall.
5. As a Carrent user, I want up to 30 images in one message, so that I can share comparison sets or multi-step UI states.
6. As a Carrent user, I want the composer preview to scroll horizontally when many images are attached, so that the input layout remains stable.
7. As a Carrent user, I want to remove an image before sending, so that mistakes are easy to fix.
8. As a Carrent user, I want the remove control to appear on each composer thumbnail, so that image deletion is obvious and local to the image.
9. As a Carrent user, I want to send a message that only contains images, so that I do not need to type filler text for obvious screenshots.
10. As a Carrent user, I want a sensible default prompt for image-only messages, so that the Coding Agent still receives a clear request.
11. As a Carrent user, I want PNG images to be supported, so that screenshots work naturally.
12. As a Carrent user, I want JPEG images to be supported, so that photos and compressed screenshots work naturally.
13. As a Carrent user, I want WebP images to be supported, so that modern web images work.
14. As a Carrent user, I want GIF images to be supported, so that animated or exported UI references can be attached.
15. As a Carrent user, I want unsupported formats to be rejected before send, so that I know which images need a different format.
16. As a Carrent user, I want clear feedback when a selected image is over 10MB, so that I can replace it.
17. As a Carrent user, I want clear feedback when total images exceed 100MB, so that I know why sending is blocked.
18. As a Carrent user, I want the whole message to stay unsent if any image fails validation, so that I do not accidentally send a partial set.
19. As a Carrent user, I want the whole message to stay unsent if any image fails to persist, so that the Coding Agent does not receive an incomplete message.
20. As a Carrent user, I want my typed text to remain in the composer when attachment persistence fails, so that I do not lose work.
21. As a Carrent user, I want successfully selected images to remain visible after a send failure, so that I can remove or replace only the broken one.
22. As a Carrent user, I want sent images to appear in the user message, so that I can review what I sent later.
23. As a Carrent user, I want sent image thumbnails to appear near the message text, so that text and images feel like one message.
24. As a Carrent user, I want the message body to remain clean, so that raw file paths do not clutter conversation history.
25. As a Carrent user, I want app data paths hidden from the chat UI, so that internal storage details do not leak into my workflow.
26. As a Carrent user, I want original image formats preserved, so that screenshot quality and details are not changed.
27. As a Carrent user, I want Carrent not to compress my images, so that UI text and visual details remain readable.
28. As a Carrent user, I want Carrent not to write attachments into my project folder, so that my repository is not polluted by chat data.
29. As a Carrent user, I want Carrent not to modify `.gitignore` for image attachments, so that my project files remain under my control.
30. As a Carrent user, I want image history to survive app restarts, so that previous conversations remain useful.
31. As a Carrent user, I want image history to avoid depending on temporary clipboard paths, so that previews do not break later.
32. As a Carrent user, I want a clicked thumbnail to open an in-app preview, so that I can inspect the image without leaving Carrent.
33. As a Carrent user, I want the preview to use a dark overlay, so that focus stays on the image.
34. As a Carrent user, I want the preview to show a large image, so that I can inspect details.
35. As a Carrent user, I want the preview to support closing with a visible control, so that I can return to the chat easily.
36. As a Carrent user, I want the preview to support zoom controls, so that small text in screenshots can be inspected.
37. As a Carrent user, I want the preview to support moving between images, so that multi-image messages are easy to browse.
38. As a Carrent user, I want the preview to offer download or save access, so that I can recover an attachment when needed.
39. As a Carrent user, I want the preview title to use the original file name when useful, so that I can identify the attachment without seeing raw paths.
40. As a Carrent user, I want sent attachments to be immutable from the historical message UI, so that the UI matches what the Coding Agent received.
41. As a Carrent user, I want the composer to clear after a successful image send, so that I can start a new message cleanly.
42. As a Carrent user, I want the composer not to clear before all images are safely persisted, so that failed sends do not lose input.
43. As a Carrent user, I want Carrent to send images directly to capable Runtimes, so that the Coding Agent can inspect image content natively.
44. As a Carrent user, I want Carrent not to block sending just because a Runtime capability flag is missing, so that local agents can still handle images by path when possible.
45. As a Carrent user, I want text-only Runtimes to receive image references internally, so that the Coding Agent can still attempt to read the images.
46. As a Carrent user, I want internal image references not to become visible message text, so that the chat remains readable.
47. As a Carrent user, I want image attachments to work in project-scoped threads, so that screenshots can guide project work.
48. As a Carrent user, I want image attachments to work in general chats, so that non-project conversations can include images too.
49. As a Carrent user, I want Carrent to retain images while their messages remain in history, so that old image conversations do not silently decay.
50. As a Carrent user, I want Carrent to defer automatic cleanup, so that image history is not accidentally broken.
51. As a Carrent developer, I want Image Attachment to be part of the shared chat request model, so that renderer and runtime code agree on the payload.
52. As a Carrent developer, I want workspace persistence to store only attachment metadata, so that the workspace state remains small and robust.
53. As a Carrent developer, I want attachment persistence owned by the Electron side, so that file system operations stay outside renderer-only state.
54. As a Carrent developer, I want runtime-specific prompt construction to decide how image paths are exposed, so that user history and runtime prompt are separate concerns.
55. As a Carrent developer, I want tests at the chat turn boundary, so that behavior is verified from the user's send action through runtime request shape.

## Implementation Decisions

- Use the Desktop App domain term **Image Attachment** for images included in a user message as input for the Coding Agent.
- Image Attachment is not a general file attachment feature.
- Supported input methods are paste and file selection.
- Drag and drop is out of scope for this PRD.
- A single message can include up to 30 Image Attachments.
- Supported formats are PNG, JPEG, WebP, and GIF.
- SVG, PDF, HEIC, and non-image files are out of scope.
- Single-image size limit is 10MB.
- Per-message total image size limit is 100MB.
- Carrent preserves the original image format and bytes as much as possible.
- Carrent does not compress images.
- Carrent does not transform images to another format.
- Carrent copies incoming images into a Carrent-owned app data attachment store before sending.
- Carrent does not write Image Attachments into the user's project directory.
- Carrent does not create hidden project attachment directories.
- Carrent does not modify project `.gitignore` for this feature.
- `workspace.json` stores message metadata and attachment metadata only.
- `workspace.json` must not contain base64 image payloads.
- Attachment metadata should include stable attachment identity, original file name, MIME type, byte size, stored local path or storage key, and any dimensions that are cheap and reliable to capture.
- Original file name is retained for internal metadata and preview titles.
- The UI must not display raw app data paths in normal chat history.
- Sent user messages display text plus image thumbnails.
- Composer displays pending thumbnails in the top-left area of the composer shell.
- Composer thumbnails use fixed dimensions and a per-image remove button before send.
- Composer thumbnails use horizontal scrolling for many images.
- Sent-message thumbnails are immutable; users can inspect them but not remove them from historical messages.
- A lightbox preview opens from any thumbnail.
- The lightbox uses an in-app dark overlay rather than the system image viewer.
- The lightbox supports close, zoom controls, download access, and multi-image navigation.
- Image-only messages are allowed.
- Image-only messages use an internal default text request such as asking the Coding Agent to inspect the attached images.
- The visible history for image-only messages should remain clean and not show implementation-only filler unless product copy requires it.
- Carrent does not block image sends based solely on Runtime/model image capability.
- Runtime request payloads carry Image Attachments internally.
- Runtimes that support native image parts should receive native image parts.
- Runtimes that only accept text should receive a runtime-only prompt augmentation containing Carrent-managed local image paths.
- Runtime-only image path augmentation must not be written back to the visible user message.
- If any image validation, copy, or persistence step fails, the entire message is not sent.
- On attachment failure, typed text and pending image previews remain in the composer.
- Attachment files are retained while their messages remain in history.
- Automatic attachment expiry is out of scope until Carrent has deletion or archive cleanup semantics.
- The implementation should respect ADR-0003: image attachments live in Carrent's app data attachment store and avoid mutating user project contents.

## Testing Decisions

- The primary test seam should be the chat turn boundary: user-visible composer/send behavior should produce the expected persisted message shape and runtime request shape.
- Tests should assert external behavior rather than implementation details such as individual helper function internals.
- Existing workspace persistence behavior is a useful prior seam because messages already persist through workspace snapshots.
- Existing chat run tests are a useful prior seam because user sends already become `ChatTurnRequest` values and runtime events.
- Existing renderer state tests around workspace messages are a useful prior seam for verifying messages with attachment metadata.
- Attachment storage should be tested through its public Electron/IPC-facing API rather than by reaching into private storage paths.
- Tests should cover successful paste/file-selection attachment flow at the highest practical UI or state boundary.
- Tests should cover validation failures for unsupported type, too many images, single-image size limit, and total-size limit.
- Tests should cover the all-or-nothing send rule: one bad image prevents the entire message from being sent.
- Tests should cover that failed sends preserve typed text and pending attachments.
- Tests should cover that workspace snapshots persist attachment metadata but not base64 image data.
- Tests should cover that visible message content does not include raw local paths.
- Tests should cover that runtime prompt augmentation for text-only runtimes can include local paths without changing persisted visible history.
- Tests should cover image-only sends and the default internal request text.
- Tests should cover that sent-message attachments are rendered as thumbnails and can open the lightbox.
- Tests should cover lightbox navigation for multiple images.
- Tests should cover app restart or rehydration behavior for attachment thumbnails through persisted metadata.
- Tests should avoid requiring real external Runtimes for attachment behavior.

## Out of Scope

- Drag and drop image attachment.
- General file attachments.
- PDF, SVG, HEIC, video, audio, or archive attachment support.
- Automatic image compression.
- Image format conversion.
- Writing attachments into project directories.
- Editing `.gitignore`.
- Showing raw app data paths in normal UI.
- Deleting attachments from already-sent messages.
- Automatic attachment expiry or garbage collection.
- Cross-device sync for image attachments.
- Cloud upload or remote attachment hosting.
- Full Runtime-specific native image support for every Runtime if a Runtime does not expose an image-capable protocol yet.
- Reworking the whole chat UI beyond the three required states: composer thumbnails, sent-message thumbnails, and lightbox preview.

## Further Notes

- This PRD follows the Desktop App context glossary and ADR-0003.
- The three target visual states are: image thumbnails inside the composer, image thumbnails in sent user messages, and a dark in-app lightbox preview.
- Carrent should keep a separate attachment scope that is mostly invisible to users.
- Raw storage data should be exposed only to Runtime integration code when needed, not to normal chat history.
- The feature should preserve user-owned content as much as possible: image bytes, project files, visible message text, and history readability.
