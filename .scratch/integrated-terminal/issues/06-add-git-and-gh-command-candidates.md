# 06 — Add Git and GitHub CLI command candidates

**What to build:** Extend the zsh candidate surface with argument-aware Git and GitHub CLI suggestions so users can discover common subcommands and options directly in a Project Terminal Tab without changing native shell completion.

**Blocked by:** 05 — Provide general command candidates.

**Status:** ready-for-agent

- [ ] The candidate engine recognizes `git` and `gh` command positions without treating a similarly named argument or path as the command.
- [ ] Git suggestions cover the commonly used clone, init, status, add, restore, commit, branch, switch, checkout, merge, rebase, log, diff, stash, fetch, pull, push, remote, tag, and worktree flows.
- [ ] GitHub CLI suggestions cover the commonly used auth, repo, pr, issue, run, workflow, release, gist, and api flows.
- [ ] Supported subcommands expose concise local descriptions and relevant options at the correct argument position.
- [ ] Options already present are not repeatedly suggested when repetition is invalid, while repeatable options remain eligible.
- [ ] Commands that expect local files or directories continue to compose with the general path candidate provider.
- [ ] Unknown subcommands or unsupported deep syntax fall back without corrupting general executable, shell symbol, path, ghost-text, or native `Tab` behavior.
- [ ] Completion results are generated from bundled local rules and do not invoke Git, GitHub CLI, a model, or a network service while the user types.
- [ ] Rule-engine tests cover representative nested commands, options, replacement ranges, duplicate suppression, unknown syntax, and composition with paths.
- [ ] Renderer integration tests prove Git and GitHub CLI candidates can be selected and inserted into the real editable shell line.

