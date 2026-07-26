# 06 — Runtime modes, settings boundary, and domain docs

**What to build:** Make structured questions available exactly where Kimi permits interactive input, keep the internal Run interaction server independent of the user-controlled Local MCP Server, and document that distinction in Carrent's architecture and domain language.

**Blocked by:** 02 — Run-scoped MCP single question

**Status:** done

- [ ] Kimi default, Plan, and YOLO Runs receive the Run-scoped interaction MCP server.
- [ ] Kimi Auto Runs do not start or advertise the interaction server.
- [ ] Disabling the Local MCP Server removes global Carrent Bridge and Skill Catalog access but does not disable structured questions.
- [ ] Runtime model listing, status checks, and other non-Run operations do not start an interaction server.
- [ ] New and resumed Runtime Sessions receive the correct server descriptor set for the current Run and mode.
- [ ] User prompts remain unchanged; no routing instruction is injected per prompt or per Run.
- [ ] Tests cover all Kimi mode mappings, Local MCP Server enabled and disabled states, new and resumed Runtime Sessions, and non-Run checks.
- [ ] ADR-0005 is revised to exclude the internal Run interaction server from the user-controlled Local MCP Server preference.
- [ ] Desktop App domain documentation distinguishes the global Local MCP Server from the Run-scoped interaction surface without weakening the existing Skill Catalog rules.
