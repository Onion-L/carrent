# Desktop App

The Carrent desktop app is the product context for project-scoped coding agent chat.

## Language

**Workspace**:
A durable, user-visible top-level Carrent object with a stable identity and non-empty, case-insensitively unique name that defines a long-lived work context. A Workspace groups zero or more Projects through non-exclusive associations, scopes its own Threads, and cannot contain another Workspace. Deleting it permanently removes its scoped Threads, Thread Drafts, and Associations after a confirmation, but is blocked while any of those Threads has a live Run.
_Avoid_: Project directory, working directory, app state snapshot, window

**App State Snapshot**:
The app-owned persisted representation used to restore shared Carrent application data across launches. Carrent Windows present the same application data rather than keeping window-specific copies.
_Avoid_: Workspace

**Carrent Window**:
One of the peer user-visible top-level windows that owns only its current route, selection, browsing history, and presentation state for Workspace, Project, Thread, and Settings views. Every Carrent Window provides complete application navigation while presenting the same shared Carrent application data.
_Avoid_: Main Window, Workspace, Settings window, auxiliary window

**Project Working Directory**:
The local filesystem directory used as the coding agent's working directory for project-scoped runs.
_Avoid_: Workspace, Project

**Project**:
A durable Carrent object with a stable identity and shared, user-editable name that references one Project Working Directory without owning or relocating it. Its default name is the directory name. A Project is associated with one or more Workspaces and may be shared by them; importing the same Project Working Directory into another Workspace reuses the Project, while separate directory clones are separate Projects. It has no global deletion operation; removing its final Association removes its Carrent record. It does not require a Git repository and remains the same object when its directory is moved, renamed, or temporarily unavailable. Carrent detects whether the recorded path is available but never searches for, guesses, or automatically adopts a replacement; only an explicit user relocation can change the directory reference, and not while any Thread for that Project has a live Run.
_Avoid_: Workspace, Project Working Directory, repository

**Terminal Tab**:
A Project-owned interactive shell process and its terminal presentation, retained in memory for the Carrent process lifetime. A Project's Terminal Tabs are shared across every Carrent Window and Workspace-Project Association showing that Project.
_Avoid_: window terminal, persisted terminal

**Workspace-Project Association**:
The relationship that makes one Project available inside one Workspace. It stores Workspace-specific presentation, including an optional display alias used by in-Workspace rename actions, and defaults for that Project without changing the Project's identity or affecting the same Project in other Workspaces. Clearing the alias restores the shared Project name. Removing it permanently deletes the Threads and Thread Draft scoped to that Workspace-Project pair after a confirmation, but is blocked while any affected Thread has a live Run.
_Avoid_: Project copy, Project ownership, nested Project

**Thread Draft**:
A recoverable composition that is scoped to exactly one existing Workspace-Project Association but has not yet become a Thread. It stores unsent content, attachments, and selected run configuration; each Association has at most one shared across all Carrent Windows. Sending its first message creates the Thread everywhere. A Thread Draft is excluded from Thread lists, search, recent activity, and archives. It never blocks removal of its Association or Workspace; either operation discards the draft and its unsent attachment snapshots.
_Avoid_: Draft Thread, projectless Thread, empty Thread

**Thread Composer State**:
The recoverable unsent content, attachments, and selected run configuration for an existing Thread. A Thread has one shared Thread Composer State that is presented and edited consistently in every Carrent Window showing that Thread.
_Avoid_: Thread Draft, window draft, local composer state

**Coding Agent**:
An agent that can work inside a local project by reading files, editing files, running shell commands, and continuing work across a thread.
_Avoid_: Chat agent, chatbot, model

**Thread**:
A Carrent-owned conversation with an automatically generated, user-editable title that belongs to exactly one Workspace and one Project whose association already exists. Both relationships are fixed when the Thread is created. A Thread may be open in multiple Carrent Windows, which present the same shared messages, Run state, and pending interactions. Carrent preserves its user-visible history across runs and Provider Profile changes; projectless General Chat is not a Thread in the target model.
_Avoid_: Session, chat

**Archived Thread**:
A losslessly suspended Thread removed from normal navigation. It preserves its identity, title, history, attachments, draft, run configuration, and pin state, but cannot start a Run while archived. Only an idle Thread with no queued messages can be archived; restoring it returns it to its original Workspace and Project without changing its Thread Activity Time. Archiving is reversible and applies only to Threads; Workspaces, Projects, and Workspace-Project Associations do not have an archived lifecycle state.
_Avoid_: Deleted Thread, hidden Project, archived Workspace

**Permanent Thread Deletion**:
The irreversible removal of a Thread and all Carrent-owned data attached to it, including messages, attachment snapshots, drafts, queued work, and Run Checklists. A single active Thread can reach this operation only through the archive area; deleting a Workspace also applies it to every Thread scoped by that Workspace. It never reverses Run Changes or modifies project files, Git branches, commits, the index, or stashes, and it succeeds atomically or leaves the containing operation intact.
_Avoid_: project cleanup, archive

**Run**:
One execution of a coding agent in a thread, beginning with a user request and ending in completion, failure, or cancellation. A Run is shared application state and may be observed or controlled from any Carrent Window showing its Thread.
_Avoid_: Thread, message

**Run Checklist**:
A coding agent-produced, mutable checklist of intended work and each item's current state. Each thread keeps its latest checklist across navigation and app restarts until that thread's next run begins; it communicates current progress, not permanent history, chronological activity, or a plan awaiting review.
_Avoid_: Todo list, ACP Plan, Plan Review, Agent Activity

**Run Changes**:
The project file changes associated with one run, regardless of whether the run completes, fails, or is cancelled, and independent of unrelated changes made later by the user or another thread.
_Avoid_: Workspace snapshot, Git diff

**Thread Status**:
The single status shown for a thread. Waiting for approval takes precedence over waiting for an answer, which takes precedence over running, which takes precedence over failed; both waiting states and running exist only while a run is live, and an interrupted run without an explicit failure returns to idle. A failed result remains visible until the thread's next run begins, while an idle thread without a failure has no status.
_Avoid_: message status

**Thread Activity Time**:
The time of a thread's most recent meaningful interaction: a submitted user message, a run ending, or an approval request. Opening, renaming, pinning, and individual streaming updates are not thread activity.
_Avoid_: Updated time, viewed time, modified time

**Approval Request**:
A request from a run for the user's decision before a controlled action can proceed.
_Avoid_: Permission request, confirmation

**Agent Core**:
The Carrent-owned coding agent implementation that owns the Agent Loop, built-in tools, approval flow, provider calls, and system instructions.
_Avoid_: Runtime, Native Runtime, ACP Runtime, API client

**Usage**:
The token consumption Carrent can observe from Agent Core model calls. It excludes provider-account-wide usage, balances, billing, and monetary cost.
_Avoid_: Provider bill, account quota, API cost

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
The local configuration that tells Agent Core which Anthropic or OpenAI-compatible endpoint, credential, and model to use for a Run.
_Avoid_: Runtime, API client, account

**Skill Catalog**:
The set of installed skills Carrent can present to users and reference in Agent Core prompts.
_Avoid_: Prompt prefix, static skill dump

**RTK**:
A local shell command proxy that coding agents can use before development commands to reduce token-heavy command output while preserving command intent.
_Avoid_: Agent Core, provider profile, model

**Image Attachment**:
An image included in a user message as input for the coding agent to inspect during that run.
_Avoid_: Preview image, uploaded file, file attachment

**Thread Attachment**:
A user-added resource, such as an image, file, or pasted text, that becomes available to the coding agent for the current thread. Adding the resource is the user's authorization for Carrent and Agent Core to read it in that thread.
_Avoid_: Upload, project file, workspace file

**File Attachment**:
A local file added to a thread as a thread attachment, whether it is inside or outside the active project. Carrent stores a snapshot of single-file attachments so the thread can keep using them if the original file changes, moves, or disappears; folders are represented as additional local directories instead.
_Avoid_: File reference, project-only file

**Local Path Context**:
A structured reference to a local non-image file or folder the user dragged into the composer, stored as the original absolute path plus a `file` or `directory` kind. It is not a File Attachment or Thread Attachment: Carrent copies no bytes, owns no snapshot, and never enumerates descendants, so it stays a live reference that can become unavailable if the source moves or is deleted. Supported image drops remain snapshot-backed Image Attachments. Agent Core applies the current approval policy when accessing the path. It is rendered as removable composer cards before send and as compact badges in sent messages, never parsed from message prose.
_Avoid_: File Attachment, Thread Attachment, Project Working Directory, uploaded file

**Global Agent Instructions**:
A user-owned `AGENTS.md` file outside the project tree that Agent Core reads as standing instructions for every run. Carrent may let users view and edit these files.
_Avoid_: Settings value, prompt injection, project instructions

**Settings Tab**:
A top-level settings category selected from the Settings middle pane. Each tab contains one coherent group of user preferences or app controls.
_Avoid_: Settings section, subpage
