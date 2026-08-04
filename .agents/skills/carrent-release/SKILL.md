---
name: carrent-release
description: Build, sign, notarize, and verify Carrent macOS DMG releases for Intel and Apple Silicon. Use when the user asks to package, release, build a DMG, or publish a Carrent version.
---

# Carrent Release

## Quick start

From the repository root, run:

```bash
bun .agents/skills/carrent-release/scripts/release-macos.ts 0.0.1-alpha06
```

The version argument is required and must be a valid semver version, including optional prerelease text.

## Workflow

1. Check `git status --short`. Preserve all existing user changes; do not reset or clean the worktree.
2. Run the release script with the requested version. It updates `apps/desktop/package.json`, builds `dmg` and `zip` targets for `x64` and `arm64`, and uses the `carrent-notary` Keychain profile by default.
3. The script verifies the signed app with `codesign`, `stapler`, and `spctl`, and verifies each DMG with `hdiutil`.
4. Report both absolute DMG paths only after all verification commands succeed.

Set `APPLE_KEYCHAIN_PROFILE` when using another local profile:

```bash
APPLE_KEYCHAIN_PROFILE=my-profile bun .agents/skills/carrent-release/scripts/release-macos.ts 0.0.1
```

## Failure handling

- Never print or commit Apple passwords, API keys, or Keychain contents.
- If notarization is `In Progress`, poll the submission with `xcrun notarytool info --keychain-profile <profile>` and do not claim the release is complete.
- If credentials are missing, ask the user to configure the Keychain profile; do not silently distribute an unnotarized build.
- Release artifacts are under `apps/desktop/release/` and are ignored by git.
