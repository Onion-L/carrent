import { spawn } from "node-pty";

import type { PtyAdapter } from "./terminalSessionManager";

export const nodePtyAdapter: PtyAdapter = { spawn };
