# 01 — Native ACP single-choice question

**What to build:** Turn Kimi's native ACP `AskUserQuestion` compatibility request into a real single-choice interaction in the owning Thread. The pending question replaces the Composer, exposes every option Kimi actually forwarded plus Skip and Stop, and returns the selected ACP option to the same Run instead of presenting a generic Approval Request.

**Blocked by:** None — can start immediately

**Status:** done

- [ ] A real-shaped Kimi ACP question request is classified as a structured question rather than an Approval Request.
- [ ] The shared question contract is transport-neutral and binds the request to Carrent-owned Run and Thread identifiers.
- [ ] The question panel fully replaces the normal Composer while the request is pending.
- [ ] All single-choice options forwarded by Kimi are visible and selecting one does not submit automatically.
- [ ] Explicit Submit returns the matching upstream ACP option identifier and restores the normal Composer.
- [ ] Skip dismisses the question without stopping the Run, while Stop uses normal Run cancellation.
- [ ] Unsupported or malformed native question payloads fail safely without fabricating dropped questions, multi-select behavior, descriptions, or `Other` content.
- [ ] Tests drive the behavior from a fake ACP request through the Renderer response and assert the final ACP response.
