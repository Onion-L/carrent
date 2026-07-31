# 08 — Establish Fig rule expansion

**What to build:** Create the post-release path for growing enhanced terminal completion without copying VS Code internals or manually rewriting every CLI. Adapt a bounded Fig-derived rule through Carrent's existing candidate boundary, retain required license provenance, document a repeatable update process, and record the next shell-support decisions.

**Blocked by:** 06 — Add Git and GitHub CLI command candidates; 07 — Add JavaScript toolchain command candidates.

**Status:** ready-for-agent

- [ ] Carrent has a bounded adapter that can translate the supported subset of a Fig completion rule into its existing command-candidate contract.
- [ ] Unsupported Fig rule capabilities fail explicitly or are ignored safely rather than executing arbitrary rule code in the Renderer.
- [ ] The adapter preserves existing replacement ranges, descriptions, path composition, bounds, local-only processing, and native `Tab` behavior.
- [ ] One CLI outside the first-release Git, GitHub CLI, and JavaScript toolchain set is imported through the adapter and works end to end as the tracer bullet.
- [ ] Reused MIT-licensed source or rule material retains required copyright and license notices.
- [ ] The selected upstream repository and revision are recorded so completion behavior can be reproduced.
- [ ] A documented update procedure explains selection, import or generation, review, licensing, tests, and rollback for future CLI rule batches.
- [ ] Runtime completion does not fetch Fig data, call a model, or require network access while the user types.
- [ ] Adapter tests cover supported rule shapes, rejected capabilities, malformed rules, deterministic output, and coexistence with Carrent-authored providers.
- [ ] Renderer integration proves the imported CLI suggestion can be selected and inserted without regressing the first-release command providers.
- [ ] The ticket records a concrete recommendation and follow-up boundary for enhanced bash and fish completion without implementing those shells here.
