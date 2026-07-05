# Desktop App

The Carrent desktop app is the product context for project-scoped coding agent chat.

## Language

**Coding Agent**:
An agent that can work inside a local project by reading files, editing files, running shell commands, and continuing work across a thread.
_Avoid_: Chat agent, chatbot, model

**Agent GUI**:
A graphical workspace for driving coding agents, managing project-scoped threads, and controlling how agent runs execute.
_Avoid_: Chat client, API client

**Runtime**:
An external coding agent implementation that Carrent drives for a run. A runtime owns the agent loop; Carrent owns selection, orchestration, persistence, and presentation around it.
_Avoid_: Provider, model, API endpoint

**Agent Loop**:
The decision loop that turns a user request into model calls, tool use, file edits, shell commands, and follow-up reasoning.
_Avoid_: Chat completion, single API call

**Provider Profile**:
Non-secret configuration that tells a runtime which provider, proxy, gateway, or model configuration to use for a run.
_Avoid_: Runtime, API client, account

**Primary Runtime**:
The runtime Carrent optimizes first and treats as the default path for the current product version.
_Avoid_: Only runtime, preferred model, provider

**ACP Runtime**:
A runtime driven through Agent Client Protocol over stdio, where Carrent acts as the client and the runtime process acts as an agent server.
_Avoid_: Stream parser, CLI prompt mode

**CLI Runtime**:
A runtime driven by starting the runtime's command-line process directly for a run, where Carrent maps CLI output into Carrent chat events.
_Avoid_: ACP runtime, API runtime

**Image Attachment**:
An image included in a user message as input for the coding agent to inspect during that run.
_Avoid_: Preview image, uploaded file, file attachment
