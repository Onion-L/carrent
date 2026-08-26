/**
 * Makes node-pty's spawn-helper binaries executable on this machine.
 *
 * Two confirmed failure modes, both surfaced by node-pty as a bare
 * "posix_spawnp failed." with no errno:
 *
 * 1. Mode bits: npm's node-pty tarballs ship prebuilds/<platform>/spawn-helper
 *    as 0644; posix_spawn then fails with EACCES. Fixed with chmod.
 * 2. macOS provenance (verified 2026-08-26, darwin 27 / macOS 26+): prebuilt
 *    helpers carry a downloaded-origin com.apple.provenance xattr. Gatekeeper
 *    denies exec with EACCES even when the mode is 0755 and the embedded
 *    signature verifies, and the xattr cannot be deleted. Rewriting the file
 *    through a fresh inode (temp file + rename) resets provenance to
 *    locally-created and unblocks exec. See
 *    plans/incident-acp-tool-channel-failure.md for the reproduction.
 *
 * Wired into the root postinstall and safe to re-run; never fails the install.
 *
 * Usage: bun scripts/fix-node-pty-permissions.ts [--output report.json]
 */
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  LOCAL_PROVENANCE_PREFIX,
  defaultReadProvenance as readProvenance,
} from "../apps/desktop/electron/chat/acpTerminalManager";

const REPO_ROOT = join(import.meta.dirname, "..");

type ActionResult = {
  path: string;
  modeFixed: boolean;
  provenanceReset: boolean;
  provenanceBefore: string | null;
};

function findSpawnHelpers(directory: string, found: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) findSpawnHelpers(path, found);
    else if (entry.isFile() && entry.name === "spawn-helper") found.push(path);
  }
  return found;
}

// Bun hoists workspace deps into node_modules/.bun/<pkg>@<ver>/node_modules/,
// so the classic node_modules/node-pty paths usually do not exist. Resolve the
// real module the way the app does, then fall back to a .bun scan.
function nodePtyRoots(): string[] {
  const roots: string[] = [];
  try {
    const require = createRequire(join(REPO_ROOT, "apps", "desktop", "package.json"));
    roots.push(dirname(require.resolve("node-pty/package.json")));
  } catch {
    // Not installed; the .bun scan below may still find something.
  }
  roots.push(
    join(REPO_ROOT, "node_modules", "node-pty"),
    join(REPO_ROOT, "apps", "desktop", "node_modules", "node-pty"),
    join(REPO_ROOT, "node_modules", ".bun"),
  );
  return roots;
}

// The blocked provenance observed so far marks an npm-download origin; locally
// created/rewritten files exec fine. Anything that is neither known-local nor
// absent is reset too — an unnecessary rewrite is harmless, a missed block is
// the plan-007 incident again.
function isBlockedProvenance(provenance: string | null): boolean {
  return provenance !== null && !provenance.startsWith(LOCAL_PROVENANCE_PREFIX);
}

function resetProvenance(path: string): void {
  const contents = readFileSync(path);
  const temp = join(dirname(path), `.spawn-helper.reset-${process.pid}`);
  writeFileSync(temp, contents, { mode: 0o755 });
  renameSync(temp, path);
  chmodSync(path, 0o755);
}

if (process.platform === "win32") {
  console.log(JSON.stringify({ status: "skipped", reason: "spawn-helper is unix-only" }));
  process.exit(0);
}

const seen = new Set<string>();
const results: ActionResult[] = [];
let errors = 0;
for (const root of nodePtyRoots()) {
  for (const helper of findSpawnHelpers(root)) {
    const resolved = realpathSync(helper);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const mode = statSync(resolved).mode & 0o777;
      const modeFixed = (mode & 0o111) === 0;
      if (modeFixed) chmodSync(resolved, mode | 0o755);
      const provenanceBefore = readProvenance(resolved);
      const provenanceReset =
        process.platform === "darwin" && isBlockedProvenance(provenanceBefore);
      if (provenanceReset) resetProvenance(resolved);
      results.push({ path: resolved, modeFixed, provenanceReset, provenanceBefore });
    } catch (error) {
      errors += 1;
      results.push({
        path: resolved,
        modeFixed: false,
        provenanceReset: false,
        provenanceBefore: `error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

const report = {
  status: errors > 0 ? "partial" : "ok",
  helpers: results,
  fixedModes: results.filter((result) => result.modeFixed).length,
  resetProvenance: results.filter((result) => result.provenanceReset).length,
};
const json = JSON.stringify(report, null, 2);
console.log(json);

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
if (outputIndex >= 0 && args[outputIndex + 1]) {
  mkdirSync(dirname(args[outputIndex + 1]), { recursive: true });
  writeFileSync(args[outputIndex + 1], json);
}
process.exit(0);
