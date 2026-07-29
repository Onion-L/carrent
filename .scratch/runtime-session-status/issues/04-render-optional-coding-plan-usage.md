# 04 — Render optional Coding Plan usage

**What to build:** Show Weekly and 5h Coding Plan usage inside Carrent's Status panel only when the Runtime actually supplies those values, while safely omitting absent or malformed quota data and avoiding undocumented Kimi account integration.

**Blocked by:** 01 — Show Kimi Session Status end to end

**Status:** ready-for-agent

- [ ] The normalized Session Status result supports independent optional Weekly and 5h quota windows without making either one required for valid Session and Context data.
- [ ] Each quota window accepts only Runtime-reported used percentage and Runtime-reported reset information.
- [ ] Carrent derives remaining percentage only from a valid Runtime-reported used percentage and does not infer the source percentage, quota ceiling, account plan, or billing cycle.
- [ ] Weekly and 5h render independently, so one valid window remains visible when the other is absent or malformed.
- [ ] Each valid window displays used and remaining percentages, and displays reset information only when the Runtime explicitly provides it.
- [ ] The complete `Plan usage` section is omitted when no valid quota window is present; Carrent shows no zero, `Unavailable`, placeholder, or guessed value.
- [ ] Malformed optional quota data is ignored independently and cannot invalidate otherwise valid Session ID and Context data.
- [ ] Kimi ACP parsing tolerates chunked Status text and unknown additional lines while recognizing future Runtime-provided Weekly, 5h, and reset fields.
- [ ] Real-shaped Kimi Code 0.29.1 `/status` and `/usage` fixtures verify that current output contains no Plan usage and therefore renders no Weekly or 5h section.
- [ ] Carrent does not read Kimi credentials, call private account or billing endpoints, scrape the Kimi TUI, launch a parallel TUI process, or infer quota from HTTP errors or local token history.
- [ ] Mounted Composer tests cover Weekly-only, 5h-only, both windows, optional reset values, malformed partial data, derived remaining percentages, and complete section omission.
- [ ] Kimi ACP adapter tests cover optional future-shaped quota output separately from the required Context parser and prove that raw quota text does not enter Message Timeline.
