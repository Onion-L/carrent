# Store image attachments for history and agent access

Carrent stores image attachments as stable files in the app data attachment store instead of embedding image data in the App State Snapshot or writing hidden attachment directories into user projects. This keeps conversation history viewable without bloating App State. Agent Core receives native image input when the selected provider supports it, with Carrent-managed local paths used only as needed for access. Attachment files are retained while their messages remain in history.
