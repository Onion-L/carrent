# 05 — Provide general command candidates

**What to build:** Add an IDE-style candidate surface for enhanced zsh Terminal Tabs. Suggestions should reflect commands and paths available in the current shell and directory, insert at the real shell cursor, remain keyboard accessible, and avoid taking ownership of zsh history or native `Tab` completion.

**Blocked by:** 04 — Provide zsh history ghost text.

**Status:** ready-for-agent

- [ ] Eligible prompt input can show a bounded candidate surface positioned with the active terminal cursor without obscuring preceding terminal content.
- [ ] Candidates include executables from the active shell PATH, zsh builtins, aliases, and functions reported by trusted Shell Integration state.
- [ ] Candidates include files and directories relative to the shell's trusted current directory and typed path prefix.
- [ ] Candidate insertion replaces the correct token range at the shell cursor instead of appending blindly to the command line.
- [ ] File and directory candidates preserve required escaping for spaces and other common zsh path characters.
- [ ] Duplicate candidates from several providers are removed, prefix relevance is stable, and candidate count and documentation size are bounded.
- [ ] Candidate state follows current input, cursor, PATH, shell symbols, and current directory without using terminal command output.
- [ ] The surface can be navigated, accepted, and dismissed with a keyboard and exposes listbox, active option, and descriptive text to assistive technology.
- [ ] Candidate interaction does not consume native `Tab` and does not permanently steal Up or Down history navigation after the surface is dismissed.
- [ ] Unsupported prompts, alternate-screen programs, disabled Shell Integration, non-zsh shells, and stale trusted state do not show candidates.
- [ ] All candidate discovery and ranking is local and performs no model call or runtime network request.
- [ ] Completion engine tests use fixture PATH entries, shell symbols, directories, Unicode names, escaping cases, duplicates, cursor positions, and malformed trusted input.
- [ ] Renderer integration tests cover positioning, keyboard operation, insertion at the cursor, dismissal, native-key preservation, directory changes, and fallback states.

