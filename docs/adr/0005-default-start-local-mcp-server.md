# Default start Local MCP Server

Carrent will start the built-in Local MCP Server by default when no user preference exists and show its state in the desktop UI, because Kimi skill support depends on that local MCP capability being available without extra setup. Users can turn it off from the UI, and that off state is remembered across app restarts; turning it off disables Carrent-provided local MCP capabilities, including skill access, so the product must make that consequence visible before or during agent runs.

## Revision: Run interaction server excluded

The preference above governs the global Local MCP Server surface only: the Carrent Bridge and the Skill Catalog access it provides. The internal Run-scoped `carrent_session` interaction server is not part of that preference and is not disabled when the Local MCP Server is off. It exists only for a live Kimi Run to ask the user structured questions, is never globally installable, and starts independently of Skill Catalog availability.
