# Allow Kimi ACP to access its runtime-owned plan files

Kimi Code Plan Mode stores its review document under `~/.kimi-code/sessions/.../<sessionId>/agents/.../plans/*.md` and asks the ACP client to read and write that file. Carrent will advertise ACP text-file writes and allow the current Kimi Runtime Session to access project files plus only its own runtime-owned Markdown plan path outside the project; every other external path remains denied. This narrow exception keeps Kimi's native Plan Review flow working without granting general access to the user's home directory.
