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
2. Confirm the version-controlled electron-builder configuration defines the DMG installer layout before building. The release DMG must contain the Carrent app, an Applications alias, a light installer background with a drag arrow, and fixed icon positions matching the approved installer layout. Do not rely on Finder state or an untracked local asset.
3. Run the release script with the requested version. It updates `apps/desktop/package.json`, builds `dmg` and `zip` targets for `x64` and `arm64`, and uses the `carrent-notary` Keychain profile by default.
4. Verify each signed app with `codesign`, `stapler`, and `spctl`, and each DMG with `hdiutil`. Mount every DMG at a temporary mount point and require `.DS_Store`, `.VolumeIcon.icns`, `.background.tiff`, `Carrent.app`, and `Applications` at its root. Open one mounted DMG in Finder and verify the installer background, arrow, and app-to-Applications layout visually.
5. Report both absolute DMG paths only after all verification commands succeed.

Set `APPLE_KEYCHAIN_PROFILE` when using another local profile:

```bash
APPLE_KEYCHAIN_PROFILE=my-profile bun .agents/skills/carrent-release/scripts/release-macos.ts 0.0.1
```

## Failure handling

- Never print or commit Apple passwords, API keys, or Keychain contents.
- If notarization is `In Progress`, poll the submission with `xcrun notarytool info --keychain-profile <profile>` and do not claim the release is complete.
- If credentials are missing, ask the user to configure the Keychain profile; do not silently distribute an unnotarized build.
- If the DMG layout resources are absent or the mounted view differs from the approved installer layout, stop the release. Add the layout assets and electron-builder configuration to the repository, then rebuild from a clean release output.
- Release artifacts are under `apps/desktop/release/` and are ignored by git.
