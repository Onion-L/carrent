# Desktop App

The Carrent desktop app is the product context for project-scoped coding agent chat.

## Language

**Coding Agent**:
An agent that can work inside a local project by reading files, editing files, running shell commands, and continuing work across a thread.
_Avoid_: Chat agent, chatbot, model

**Thread**:
A project-scoped conversation that preserves user messages, agent activity, runtime selection, and continuity across runs.
_Avoid_: Session, chat

**Runtime Session**:
A runtime-owned continuity handle associated with a Carrent thread so later runs can resume the coding agent's context.
_Avoid_: Thread, Carrent session

**Run**:
One execution of a coding agent in a thread, beginning with a user request and ending in completion, failure, or cancellation.
_Avoid_: Thread, runtime session, message

**Thread Status**:
The single attention state shown for a thread. Waiting for approval takes precedence over running, which takes precedence over failed; waiting and running exist only while a run is live, and an interrupted run without an explicit failure returns to idle. A failed result remains visible until the thread's next run begins, while an idle thread without a failure has no status.
_Avoid_: Runtime status, message status

**Thread Activity Time**:
The time of a thread's most recent meaningful interaction: a submitted user message, a run ending, or an approval request. Opening, renaming, pinning, and individual streaming updates are not thread activity.
_Avoid_: Updated time, viewed time, modified time

**Approval Request**:
A request from a run for the user's decision before a controlled action can proceed. Permission is reserved for runtime protocol and implementation terminology.
_Avoid_: Permission request, confirmation

**Agent GUI**:
A graphical workspace for driving coding agents, managing project-scoped threads, and controlling how agent runs execute.
_Avoid_: Chat client, API client

**Runtime**:
An external coding agent implementation that Carrent drives for a run. A runtime owns the agent loop; Carrent owns selection, orchestration, persistence, and presentation around it.
_Avoid_: Provider, model, API endpoint

**Runtime Setup**:
The user-facing state and flow for making an external runtime usable by Carrent, including local command availability and runtime-owned sign-in or configuration.
_Avoid_: Runtime error, diagnostics, onboarding

**Agent Loop**:
The decision loop that turns a user request into model calls, tool use, file edits, shell commands, and follow-up reasoning.
_Avoid_: Chat completion, single API call

**Agent Activity**:
The ordered activity trail produced during a coding agent run, including reasoning summaries, tool activity, file activity, and shell commands.
_Avoid_: Tool log, reasoning block, execution log

**Thinking**:
The user-facing label for agent activity while a coding agent run is in progress. It refers to visible reasoning summaries and tool activity, not hidden chain of thought; settled labels are `Completed`, `Failed`, or `Cancelled`.
_Avoid_: Full chain of thought, separate reasoning panel

**Reasoning Step**:
A concise summary of the coding agent's current reasoning shown as one item in agent activity, ordered alongside tool activity by when it occurred.
_Avoid_: Thinking panel, separate summary, hidden chain of thought

**Tool Activity**:
An agent activity item representing a capability the coding agent used during a run, such as reading a file, editing a file, updating a plan, or running a shell command.
_Avoid_: Shell-only step, file log, action item

**Provider Profile**:
Non-secret configuration that tells a runtime which provider, proxy, gateway, or model configuration to use for a run.
_Avoid_: Runtime, API client, account

**Primary Runtime**:
The runtime Carrent optimizes first and treats as the default path for the current product version. Primary does not mean exclusive; future runtimes may become available without changing the current primary runtime.
_Avoid_: Only runtime, preferred model, provider

**ACP Runtime**:
A runtime driven through Agent Client Protocol over stdio, where Carrent acts as the client and the runtime process acts as an agent server.
_Avoid_: Stream parser, CLI prompt mode

**Carrent Bridge**:
A Carrent-owned capability surface that lets a runtime discover and request Carrent-provided skills, tools, or resources during a run. Skill reads through this surface are explicit, logged, and separate from prompt-injected skill text.
_Avoid_: Kimi Bridge, prompt-injected skills

**Local MCP Server**:
The user-controlled built-in Carrent MCP server that exposes Carrent-owned capabilities, including skills, to runtimes and MCP clients for the current desktop app. Turning it off disables those local MCP capabilities.
_Avoid_: MCP marketplace, plugin server, third-party server list

**Skill Catalog**:
The set of installed skills Carrent can present to users and expose to runtimes through the Carrent Bridge.
_Avoid_: Prompt prefix, static skill dump

**CLI Runtime**:
A runtime driven by starting the runtime's command-line process directly for a run, where Carrent maps CLI output into Carrent chat events.
_Avoid_: ACP runtime, API runtime

**RTK**:
A local shell command proxy that coding agents can use before development commands to reduce token-heavy command output while preserving command intent.
_Avoid_: Runtime, provider profile, model

**Image Attachment**:
An image included in a user message as input for the coding agent to inspect during that run.
_Avoid_: Preview image, uploaded file, file attachment

**Thread Attachment**:
A user-added resource, such as an image, file, or pasted text, that becomes available to the coding agent for the current thread. Adding the resource is the user's authorization for Carrent and the selected runtime to read it in that thread.
_Avoid_: Upload, project file, workspace file

**User Message Edit**:
An interaction that turns an existing user message bubble into an inline editor so the user can revise the text, cancel, or submit the revised text. Submitting updates that same user message and discards later messages in the same thread before starting the replacement run.
_Avoid_: Retry, message rewrite

**File Attachment**:
A local file added to a thread as a thread attachment, whether it is inside or outside the active project. Carrent stores a snapshot of single-file attachments so the thread can keep using them if the original file changes, moves, or disappears; folders are represented as additional local directories instead.
_Avoid_: File reference, project-only file

**Global Agent Instructions**:
A user-owned `AGENTS.md` file outside the project tree that a runtime can read as standing instructions for every run. Carrent may let users view and edit these files, but the runtime decides how they are applied.
_Avoid_: Settings value, prompt injection, project instructions

**Settings Tab**:
A top-level settings category selected from the Settings middle pane. Each tab contains one coherent group of user preferences or app controls.
_Avoid_: Settings section, subpage
