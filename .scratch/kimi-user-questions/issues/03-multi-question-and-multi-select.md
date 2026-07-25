# 03 — Multi-question and multi-select interaction

**What to build:** Expand the Carrent question tool and question panel to Kimi's complete synchronous structured-question contract: one to four questions, two to four described options per question, per-question single-select or multi-select behavior, progressive navigation, and combinable `Other` text.

**Blocked by:** 02 — Run-scoped MCP single question

**Status:** ready-for-agent

- [ ] The advertised MCP schema accepts one to four uniquely worded questions and two to four uniquely labeled options per question.
- [ ] Each question preserves its header, option labels, option descriptions, and `multi_select` setting.
- [ ] `background` is neither advertised nor accepted.
- [ ] The Composer replacement displays one question at a time with progress, Back, Next, Submit, Skip, and Stop actions as applicable.
- [ ] Moving between questions retains predefined selections and custom text without submitting early.
- [ ] Single-select questions keep one answer, while multi-select questions allow several predefined answers.
- [ ] `Other` is exclusive for single-select and combinable with predefined choices for multi-select.
- [ ] Next and Submit remain disabled until the current or complete question set has valid selections and non-empty selected `Other` text.
- [ ] Final submission returns one Kimi-compatible `answers` entry per question; multi-select values contain the selected labels and custom answer without losing either.
- [ ] Component and Run-boundary tests cover multiple questions, multi-select, option descriptions, navigation, validation, combined `Other`, and final answer formatting.

