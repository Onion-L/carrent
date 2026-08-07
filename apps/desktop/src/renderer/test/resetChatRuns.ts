import { afterEach } from "bun:test";

import { resetChatRunsForTests } from "../hooks/useChatRun";

// bun runs every test file in one process, so module-level renderer state
// (the chat Run coordinator singleton) would leak between files. Registered
// via bunfig.toml [test] preload so the hook applies to every test file.
afterEach(() => {
  resetChatRunsForTests();
});
