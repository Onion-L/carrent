# 07 — Add JavaScript toolchain command candidates

**What to build:** Extend the zsh candidate surface with argument-aware Bun, npm, npx, pnpm, and Yarn suggestions so common Project package and script workflows are discoverable without replacing the tools' own shell completion.

**Blocked by:** 05 — Provide general command candidates.

**Status:** ready-for-agent

- [ ] The candidate engine recognizes `bun`, `npm`, `npx`, `pnpm`, and `yarn` command positions without confusing them with arguments or paths.
- [ ] Bun suggestions cover commonly used run, test, install, add, remove, update, create, init, build, and x flows with concise local descriptions.
- [ ] npm and npx suggestions cover commonly used install, uninstall, update, run, test, exec, init, create, publish, pack, and configuration flows where applicable.
- [ ] pnpm and Yarn suggestions cover their common install, add, remove, update, run, exec, create, workspace, and publish flows where applicable.
- [ ] Script-name candidates are derived locally from the current Project package manifest when a supported run command expects a script name.
- [ ] Package-manifest parsing is bounded, rejects malformed content safely, and does not block general terminal input when the manifest is absent or invalid.
- [ ] Supported subcommands expose relevant positional and option suggestions, avoid invalid duplicates, and compose with file or directory candidates.
- [ ] Unknown subcommands and unsupported syntax fall back without affecting ghost text, generic candidates, or native `Tab` completion.
- [ ] Completion results require no model call, registry lookup, package-manager execution, or network service while the user types.
- [ ] Rule-engine tests cover every supported tool, script-name discovery, nested workspace syntax, options, replacement ranges, malformed manifests, and provider composition.
- [ ] Renderer integration tests prove representative toolchain candidates and Project scripts can be selected and inserted into the editable shell line.

