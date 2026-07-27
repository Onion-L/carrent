# Workspace -> Project -> Thread 三层信息架构重构规格

Status: ready-for-agent

## Problem Statement

Carrent Desktop App 当前把应用持久化状态称为 workspace，并以 Project、projectless Chat、Message 和 `activeThreadId` 为核心组织数据与导航。产品中的“工作上下文”、本地 Project Working Directory、App State Snapshot 和 Runtime Session 因此缺少清晰边界；Thread 的归属、跨 Project/Workspace 发现、生命周期、恢复和深链接也依赖旧的扁平结构。

随着 Carrent 承载更多长期 Coding Agent 工作，用户需要在多个长期工作上下文中复用本地 Project，并清楚知道每个 Thread 属于哪个 Workspace 和 Project。当前结构无法一致表达共享 Project、Workspace 内独立 Thread 集合、稳定导航、Thread Draft、级联删除、跨层搜索与待处理状态，也无法为三层数据的持久化、损坏隔离和恢复建立可靠契约。

本次重构需要一次性建立 Workspace、Project、Workspace-Project Association 和 Thread 的产品语义与持久化模型，使后续实现不再依赖 projectless Chat、旧路由或隐式 workspace snapshot，同时不改变 Runtime 的 Agent Loop 或用户的 Project Working Directory。

## Solution

Carrent 引入明确的 Workspace -> Project -> Thread 三层信息架构。Workspace 是用户可见的长期工作上下文；Project 是引用一个本地 Project Working Directory 的稳定 Carrent 对象；Workspace 与 Project 通过可保存 Workspace 内别名、排序和新 Thread 默认运行配置的 Association 建立多对多关系；Thread 固定归属一个 Workspace-Project 组合，并由 Carrent 持有可跨 Run 和 Runtime 延续的历史。

Desktop App 继续使用现有 Main Window 和三栏框架：左栏切换 Workspace 和进入应用级待处理/设置，中栏展示当前 Workspace 下按 Project 分组的 Thread，右栏显示 Workspace、Project、Thread 或 Settings 内容。导航、搜索、注意力聚合、创建、归档、删除、目录重新定位、空状态和恢复都围绕稳定的三层身份工作。

持久化采用新的显式 schema，不迁移当前未发布开发版的旧数据。App State Snapshot、Runtime Session 映射和附件存储各自承担独立职责，并按故障归属隔离。主状态无法验证时全局阻塞并允许重试或完整重置；局部 Runtime Session 或附件故障只影响对应数据。

## User Stories

1. As a Carrent user, I want to create a named Workspace, so that I can establish a durable work context.
2. As a Carrent user, I want Workspace names to be non-empty and case-insensitively unique, so that Workspace identity is not visually ambiguous.
3. As a Carrent user, I want an empty Workspace to be valid, so that I can create the context before adding Projects.
4. As a Carrent user, I want newly created Workspaces appended to a stable user order, so that unrelated activity does not rearrange my navigation.
5. As a Carrent user, I want to rename a Workspace without changing its identity, so that existing Threads and deep links remain valid.
6. As a Carrent user, I want Workspaces to remain flat rather than nested, so that the top-level navigation stays predictable.
7. As a Carrent user, I want Workspace to mean a Carrent product object rather than a directory or saved file, so that product language is consistent.
8. As a Carrent user, I want Workspace to avoid holding app-level preferences, so that Runtime availability, Provider Profiles and settings remain consistent across the app.
9. As a Carrent user, I want to add a Project by selecting a Project Working Directory, so that Coding Agent Runs use the intended local files.
10. As a Carrent user, I want Carrent to create one stable Project for a previously unseen directory, so that the directory has one product identity.
11. As a Carrent user, I want adding an already known directory to another Workspace to reuse its Project, so that Carrent does not create duplicate Project identities.
12. As a Carrent user, I want separate directory clones to remain separate Projects, so that Carrent does not infer identity from Git remotes or repository history.
13. As a Carrent user, I want the same Project available in multiple Workspaces, so that one local codebase can participate in different work contexts.
14. As a Carrent user, I want each Workspace-Project Association to have its own ordering, so that each Workspace can organize shared Projects independently.
15. As a Carrent user, I want an optional Project alias inside one Workspace, so that I can adapt presentation without renaming the shared Project.
16. As a Carrent user, I want clearing a Project alias to restore the shared Project name, so that aliases remain reversible presentation state.
17. As a Carrent user, I want global Project renaming to clearly affect every associated Workspace, so that shared identity changes are not surprising.
18. As a Carrent user, I want Project identity to survive directory moves or temporary unavailability, so that history is not tied to a mutable path.
19. As a Carrent user, I want Carrent to detect an unavailable Project Working Directory without guessing a replacement, so that it never binds history to the wrong files.
20. As a Carrent user, I want to explicitly relocate a Project to a new directory path, so that I control identity continuity.
21. As a Carrent user, I want Project relocation blocked while the Project has a live Run, so that a Runtime cannot change working directory mid-execution.
22. As a Carrent user, I want relocation rejected when the target directory already belongs to another Project, so that directory identity remains unique.
23. As a Carrent user, I want failed relocation to leave the old path and state unchanged, so that recovery never creates a half-updated Project.
24. As a Carrent user, I want Carrent never to move, copy or delete my Project Working Directory, so that project files remain under my control.
25. As a Carrent user, I want every Thread to belong to exactly one Workspace and one Project, so that its context is always unambiguous.
26. As a Carrent user, I want Thread ownership fixed at creation, so that history and Runtime context cannot silently move between codebases or Workspaces.
27. As a Carrent user, I want Threads for a shared Project to remain separate in each Workspace, so that work contexts do not leak into one another.
28. As a Carrent user, I want Thread identity and visible history owned by Carrent rather than a Runtime Session, so that switching Runtime does not replace the conversation.
29. As a Carrent user, I want Thread titles generated automatically and editable later, so that new conversations are easy to start and organize.
30. As a Carrent user, I want Thread runtime, model and run mode selections persisted on that Thread, so that later Runs use the expected configuration.
31. As a Carrent user, I want a new Thread to copy its Association's default run configuration once, so that creation is convenient without permanent inheritance.
32. As a Carrent user, I want later Association default changes to affect only future Threads, so that established Threads do not change unexpectedly.
33. As a Carrent user, I want the Composer to show the Thread's current actual configuration, so that I do not need to reason about an inheritance chain.
34. As a Carrent user, I want each Run to record the configuration it actually used, so that historical execution context remains inspectable.
35. As a Carrent user, I want one recoverable Thread Draft per Workspace-Project Association, so that I can prepare a first request before a Thread exists.
36. As a Carrent user, I want the Thread Draft to preserve unsent text, attachments and run configuration, so that navigation or restart does not discard composition.
37. As a Carrent user, I want a Thread created only when its first message is sent, so that the product never accumulates empty Threads.
38. As a Carrent user, I want the first send to atomically create the Thread in the Draft's Workspace and Project, so that content and ownership cannot diverge.
39. As a Carrent user, I want Thread Drafts excluded from lists, search, recent activity and archives, so that only real conversations appear there.
40. As a Carrent user, I want removing a Draft's parent Association or Workspace to discard the Draft and its unsent attachments, so that orphaned composition does not remain.
41. As a Carrent user, I want the left navigation rail to switch Workspaces, so that top-level context changes are always accessible.
42. As a Carrent user, I want the middle pane to show only the current Workspace's Projects and Threads, so that unrelated contexts do not overload the screen.
43. As a Carrent user, I want Threads grouped by Project in the middle pane, so that their code context is visible while browsing.
44. As a Carrent user, I want the right pane to display Workspace, Project or Thread content, so that the hierarchy uses one consistent shell.
45. As a Carrent user, I want a compact Workspace / Project / Thread path in Thread content, so that my location remains clear even when the middle pane is collapsed.
46. As a Carrent user, I want switching to a Workspace to restore its last valid Thread, so that I can resume where I left off.
47. As a Carrent user, I want a Workspace with no valid remembered Thread to open its overview, so that navigation has a stable fallback.
48. As a Carrent user, I want clicking the current Workspace again to leave my location unchanged, so that repeated clicks do not cause accidental navigation.
49. As a Carrent user, I want Workspace and Project headings to open their respective overviews, so that moving up the hierarchy is direct.
50. As a Carrent user, I want explicit Workspace, Project and Thread navigation recorded in browser history, so that Back and Forward replay my actions.
51. As a Carrent user, I want restart restoration and invalid-target fallback to replace history rather than append it, so that Back does not revisit broken locations.
52. As a Carrent user, I want Thread deep links to contain stable Workspace, Project and Thread IDs, so that names and local paths can change safely.
53. As a Carrent user, I want deep links to validate the complete ownership chain, so that a valid Thread ID cannot be opened under the wrong Workspace or Project.
54. As a Carrent user, I want an invalid deep link to fall back to the nearest valid parent, so that I remain in useful context.
55. As a Carrent user, I want one non-blocking notice when a deep-link target is missing, so that I understand why Carrent opened a different page.
56. As a Carrent user, I want Thread to behave like a normal route without a special close button, so that navigation remains consistent with other pages.
57. As a Carrent user, I want Carrent to restore the last active Workspace and Thread after restart, so that normal application restarts preserve my position.
58. As a Carrent user, I want Carrent to open the first stable Workspace or the global first-use state when no saved target is valid, so that startup always reaches a usable page.
59. As a Carrent user, I want an application-level Attention View, so that I can find Threads waiting for approval, waiting for an answer or failed across all Workspaces.
60. As a Carrent user, I want the Attention View count visible in the left rail, so that outstanding work is apparent without opening the view.
61. As a Carrent user, I want Attention items grouped by approval, answer and failure priority, so that the most actionable work appears first.
62. As a Carrent user, I want Attention items ordered by Thread Activity Time within each group, so that recent events are easier to find.
63. As a Carrent user, I want every Attention item to show its Workspace / Project path, so that similarly named Threads remain distinguishable.
64. As a Carrent user, I want opening Attention to replace only the middle pane, so that my current right-pane context remains visible until I select a Thread.
65. As a Carrent user, I want selecting an Attention item to return to normal three-column navigation for its Workspace, so that I regain full context.
66. As a Carrent user, I want Back to restore the previous Attention list state after opening an item, so that I can continue triage where I left off.
67. As a Carrent user, I want Running Threads shown only in their normal Project groups, so that progress is not confused with work requiring intervention.
68. As a Carrent user, I want Thread Status displayed on Thread items without reordering them, so that attention state does not destabilize navigation.
69. As a Carrent user, I want Thread Status priority to be approval, answer, running, then failed, so that one Thread presents one clear state.
70. As a Carrent user, I want failed status retained until the next Run begins, so that a failure does not disappear before I act on it.
71. As a Carrent user, I want a single Thread search interface with global, Workspace and Association scopes, so that discovery works consistently at every level.
72. As a Carrent user, I want Cmd/Ctrl+K to open global Thread search, so that cross-Workspace discovery has a predictable shortcut.
73. As a Carrent user, I want Workspace and Project search entry points to select the corresponding scope, so that local searches require fewer steps.
74. As a Carrent user, I want search to match active Thread titles case-insensitively by substring, so that results are predictable.
75. As a Carrent user, I want exact, prefix and other substring matches ranked before Thread Activity Time, so that the strongest title match wins.
76. As a Carrent user, I want each result to display Workspace / Project / Thread, so that result identity is clear.
77. As a Carrent user, I want empty search to show at most 20 recent active Threads in the current scope, so that search also supports quick return.
78. As a Carrent user, I want Drafts, Archived Threads, messages, attachments and Agent Activity excluded from search, so that title search remains focused and fast.
79. As a Carrent user, I want selecting the current Thread in search to close search without adding history, so that no-op navigation remains a no-op.
80. As a Carrent user, I want Thread pinning scoped to its Project group, so that important work stays near related Threads without creating global duplicates.
81. As a Carrent user, I want pinned and unpinned groups each ordered by Thread Activity Time, so that pinning and recency have clear roles.
82. As a Carrent user, I want Thread Activity Time updated only by meaningful interaction, so that opening or renaming a Thread does not make it look active.
83. As a Carrent user, I want only idle Threads with no queued messages to be archivable, so that active work cannot be hidden accidentally.
84. As a Carrent user, I want archiving to preserve all Carrent-owned Thread data and Runtime continuity, so that archive is a reversible suspension rather than deletion.
85. As a Carrent user, I want Archived Threads unable to start Runs, so that suspended work remains inactive.
86. As a Carrent user, I want all Archived Threads managed in one Settings area, so that restore and permanent deletion have one predictable location.
87. As a Carrent user, I want restoring an Archived Thread to return it to its original Workspace and Project, so that ownership never changes.
88. As a Carrent user, I want archive and restore to preserve Thread Activity Time and pin state, so that lifecycle operations do not fabricate activity.
89. As a Carrent user, I want permanent Thread deletion available only from the archive area, so that irreversible deletion is separated from daily navigation.
90. As a Carrent user, I want permanent Thread deletion to remove all Carrent-owned history, attachments, drafts, queues, Runtime Sessions and rewind data atomically, so that no partial Thread remains.
91. As a Carrent user, I want permanent deletion never to modify project files or Git state, so that removing Carrent history cannot alter my codebase.
92. As a Carrent user, I want removing a Workspace-Project Association to delete only that pair's Threads and Draft, so that the shared Project remains intact elsewhere.
93. As a Carrent user, I want deleting a Workspace to remove only its Associations, Threads and Drafts, so that shared Projects and other Workspaces remain intact.
94. As a Carrent user, I want Association removal and Workspace deletion blocked when affected Threads have live Runs, so that Carrent cannot delete active control state.
95. As a Carrent user, I want the final Association removal to remove the unused Carrent Project record without touching its directory, so that the app does not retain unreachable Projects.
96. As a Carrent user, I want destructive confirmations to show affected Thread counts and unaffected directories/Workspaces, so that I understand the scope before proceeding.
97. As a Carrent user, I want rename and pin actions available during live Runs, so that harmless organization remains possible.
98. As a Carrent user, I want Thread archive and Project relocation blocked during the relevant live Run, so that execution context remains stable.
99. As a Carrent user, I want post-delete navigation to choose a deterministic sibling or parent, so that I am never left on a removed route.
100. As a new Carrent user, I want a global empty state with a Workspace name field, so that first use begins with the required top-level object.
101. As a Carrent user, I want an empty Workspace overview to offer Add Project and explain that directories are not moved or copied, so that the action is safe and understandable.
102. As a Carrent user, I want an empty Project overview to offer New Thread through its Thread Draft, so that Thread creation follows the first-send rule.
103. As a Carrent user, I want empty Attention and search states to stay within their affected list area, so that unrelated content does not disappear.
104. As a Carrent user, I want an unavailable Project Working Directory to replace only the affected content and preserve navigation, so that historical context remains accessible.
105. As a Carrent user, I want an unavailable directory state to offer Recheck and Relocate Directory, so that I can recover without recreating the Project.
106. As a Carrent user, I want Runs blocked while the Project Working Directory is unavailable, so that the Runtime cannot execute against a missing path.
107. As a Carrent user, I want a valid target whose content failed to load to offer Retry and Open Parent Overview, so that transient failures do not masquerade as corruption.
108. As a Carrent user, I want normal empty, missing and loading states to replace the smallest affected content surface, so that valid hierarchy remains visible.
109. As a Carrent user, I want Carrent to use a new explicit App State Snapshot schema without migrating old development data, so that the three-level model starts from consistent state.
110. As a Carrent user, I want recognized old development data reset automatically and only within Carrent app data, so that Project Working Directories and Git data remain untouched.
111. As a Carrent user, I want initialization to stop if reset or new-state creation fails, so that Carrent never operates on mixed old and new state.
112. As a Carrent user, I want unknown schema data preserved and blocked rather than silently cleared, so that an unsupported data file is not destroyed automatically.
113. As a Carrent user, I want Runtime Session mappings keyed by Runtime and Thread, so that Workspace changes and shared Projects cannot cross-wire Runtime context.
114. As a Carrent user, I want Project relocation to detach all Runtime Sessions for that Project, so that a Runtime does not resume against a different directory.
115. As a Carrent user, I want a missing Runtime Session mapping treated as a fresh Runtime context, so that replaceable continuity data does not block a Thread.
116. As a Carrent user, I want an invalid Runtime Session mapping isolated to its Thread and Runtime, so that other history and Runs remain available.
117. As a Carrent user, I want a rejected Runtime resume to fail visibly and offer Remove Runtime Session and Retry, so that Carrent never silently duplicates a request.
118. As a Carrent user, I want historical messages to remain readable when an attachment is missing, so that one file does not erase a conversation.
119. As a Carrent user, I want an unavailable historical attachment clearly marked and never read from its original source path, so that snapshot semantics remain honest.
120. As a Carrent user, I want a Thread Draft with an unavailable attachment blocked from sending until I remove or replace it, so that the Runtime receives exactly what I approved.
121. As a Carrent user, I want unreferenced attachment-store files cleaned automatically when App State is valid, so that orphaned app data does not accumulate.
122. As a Carrent user, I want an invalid App State Snapshot to block navigation, Runs and writes, so that partial data cannot cause further corruption.
123. As a Carrent user, I want the global corruption state to offer Re-read, Copy Diagnostics and Full Reset, so that I have clear recovery choices.
124. As a Carrent user, I want Full Reset to require explicit confirmation and explain its exact scope, so that destructive recovery cannot be mistaken for Project deletion.
125. As a Carrent user, I want a successful Full Reset to open the first-use state without requiring an app restart, so that recovery completes in one flow.
126. As a Carrent user, I want failed reset to remain blocked with additional diagnostics, so that Carrent never enters half-initialized state.
127. As a Carrent user, I want copied diagnostics to exclude messages, Drafts, attachment contents and Provider configuration, so that troubleshooting does not leak sensitive content.
128. As a Carrent user, I want Carrent to use one Main Window, so that route, selection, Draft and Run controls have one owner.
129. As a Carrent user, I want launching Carrent again to focus the existing Main Window without changing its route, so that duplicate launches are harmless.
130. As a Carrent user, I want valid deep links to focus and navigate the existing Main Window, so that external navigation does not create conflicting windows.
131. As a Carrent user, I want Settings to remain a normal route in the Main Window, so that it shares the same shell and return behavior.
132. As a Carrent user, I want closing the Main Window to exit Carrent, so that no Run continues without a visible control surface.
133. As a Carrent user, I want closing with live Runs to warn and cancel them only after confirmation, so that active work is not stopped accidentally.
134. As a Carrent user, I want interrupted restart state normalized to cancelled or interrupted outcomes while preserving produced history, so that stale live indicators do not survive a process restart.
135. As a Carrent user, I want the existing fixed left rail, resizable middle pane and content pane retained, so that the information architecture changes without an unrelated shell redesign.
136. As a Carrent user, I want the middle pane to default to 280px and remain resizable from 200px to 480px, so that the established layout behavior remains familiar.
137. As a Carrent user, I want collapsing and reopening the middle pane during one app run to restore its prior width, so that temporary focus changes are reversible.
138. As a Carrent user, I want pane width and collapsed state reset on app restart, so that transient layout choices do not become persistent settings.
139. As a Carrent user, I want the 1080x720 minimum Main Window size retained without automatic drawer or single-pane conversion, so that layout state remains simple and predictable.

## Implementation Decisions

- Use the glossary terms Workspace, Project, Project Working Directory, Workspace-Project Association, Thread, Thread Draft, Runtime Session, Run, Attention View, Thread Status, Thread Activity Time and App State Snapshot consistently. Do not use workspace as a synonym for the persisted snapshot or Runtime cwd.
- Replace the current flat/projectless persistence model with one explicit schema version. The schema must represent Workspaces, Projects, Associations, Threads, messages, existing-Thread unsent composer state, Association-scoped Thread Drafts, queued messages, run configuration, latest Run Checklist, navigation restoration state and other existing Carrent-owned Thread history required by the current product.
- Workspace records own a globally unique stable ID, a non-empty case-insensitively unique name and stable user order. They do not own descriptions, pin state, Runtime defaults or app-level preferences.
- Project records own a globally unique stable ID, shared editable name, Project Working Directory path and derived directory availability. A canonicalized Project Working Directory can map to only one Project record.
- Workspace-Project Association records own the Workspace ID, Project ID, optional Workspace-local alias, stable order and defaults for newly created Threads. The default baseline is Primary Runtime, no explicit model selection and Approval Required.
- A Project must have at least one Association in stable persisted state. Adding a known Project creates only a missing Association; removing its final Association removes the Carrent Project record.
- Thread records own a globally unique stable ID and fixed Workspace ID + Project ID. Creation must validate that the corresponding Association exists. No operation may change either parent ID after creation.
- Thread records own title, pin state, Thread Activity Time, current Runtime/model/run mode, messages, attachments, existing-Thread unsent composer state, queued messages, current status inputs, latest Run Checklist and the Carrent-owned history needed by existing Run, Agent Activity and rewind behavior.
- Thread Draft is a separate Association-scoped pre-Thread record with at most one instance per Association. It owns unsent content, attachments and selected run configuration. First send creates the Thread and first message atomically, then removes the Thread Draft.
- Runtime Session remains a separate replaceable mapping keyed by Runtime ID + Thread ID. Workspace ID, Project ID and directory path are not part of the key because Thread ID is global and ownership is immutable.
- App-level settings such as theme, language, Runtime availability, Provider Profiles, Local MCP Server and Global Agent Instructions remain outside Workspace, Project, Association and Thread records.
- Thread Status is derived rather than independently copied to Workspace or Association. Waiting for approval outranks waiting for an answer, which outranks running, which outranks failed. Waiting and running exist only for a live Run; failure remains until the next Run begins.
- Thread Activity Time changes only for a submitted user message, a Run ending or an Approval Request. Opening, renaming, pinning and individual streaming updates do not change it.
- Workspace and Association order are stable user order. Within a Project group, pinned Threads precede unpinned Threads; each group sorts by Thread Activity Time descending.
- Use explicit three-level routes. Workspace overview uses the Workspace stable ID, Project overview uses Workspace + Project stable IDs, and Thread uses Workspace + Project + Thread stable IDs. Names and filesystem paths never enter routes.
- The concrete route contract is `/workspace/:workspaceId`, `/workspace/:workspaceId/project/:projectId` and `/workspace/:workspaceId/project/:projectId/thread/:threadId`. `/` is the Workspace selection/first-use entry and `/settings` remains the Settings route.
- Route resolution validates every parent-child relationship. A missing Thread falls back to its Project overview, a missing Project falls back to its Workspace overview, and a missing Workspace falls back to `/`. Invalid-target fallback uses history replacement and emits one dismissible notice.
- Old `/project/:projectId`, `/thread/:projectId/:threadId` and `/chat/:threadId` routes are not compatible and do not translate IDs. They replace-navigate to `/` and show one non-blocking incompatibility notice.
- The Main Window owns the active route, current selection and browser history. Workspace, Project, Thread, Thread Draft and Run are application objects rather than window-owned objects.
- Retain the existing DesktopShell composition: 58px Workspace rail, middle navigation pane and right content pane. The middle pane defaults to 280px, resizes between 200px and 480px, and can be manually collapsed.
- Middle-pane width and collapse state are session-only. Reopening during one app process restores the last expanded width; app restart returns to 280px expanded.
- Retain the 1080x720 Main Window minimum. Do not add automatic responsive conversion, drawer navigation, overlay navigation, a fourth fixed column or mobile behavior.
- Workspace, Project and Thread pages use the three-column shell. Settings keeps the left rail, replaces the middle pane with Settings Tabs and renders the selected setting in the right pane.
- The left rail contains the application-level Attention View entry, Workspace switcher, create Workspace action and Settings entry. Running Threads do not get a separate global entry.
- The middle pane normally renders only the current Workspace, grouped by Associations/Projects. Opening Attention temporarily replaces the middle pane while preserving current right-pane content.
- Attention includes only active Threads waiting for approval, waiting for an answer or failed. It excludes running-only, pinned-only, recent, search, Archived Thread and Thread Draft entries.
- Attention groups use approval, answer and failed order. Items within a group sort by Thread Activity Time descending and display Workspace / Project context. Opening an item exits Attention and performs normal three-level navigation; Back restores the prior Attention list state.
- Provide one title-only Thread search surface with global, Workspace and Association scope. Cmd/Ctrl+K opens global scope; Workspace and Project entry points select their local scope; the user can change scope in the search UI.
- Search trims surrounding whitespace, compares case-insensitively and uses substring matching. Rank exact matches, then prefix matches, then other substring matches; break ties by Thread Activity Time descending.
- Search includes active Thread titles only. It excludes Thread Drafts, Archived Threads, message bodies, attachments, Agent Activity and command output. Empty query shows at most 20 recent active Threads in scope.
- Search results show the full Workspace / Project / Thread path. Opening another Thread closes search and adds normal navigation history; selecting the current Thread only closes search. Browser Back does not reopen search.
- Creating Workspace validates the name, appends it to stable order and opens its overview. No wizard, template, copy or nested Workspace flow is introduced.
- Add Project performs one atomic operation: canonicalize and validate the selected directory, reuse or create the Project, create the missing Association, and open Project overview. Selecting an already-associated Project opens it without duplicating data.
- New Association defaults are copied into a new Thread exactly once. Association changes never mutate existing Threads and no inheritance metadata or restore-inheritance action is stored.
- Workspace and Thread rename update their own names. Project rename from a Workspace changes the Association alias; Project settings changes the shared Project name and must communicate its global effect.
- Relocate Project Directory is explicit and atomic. It requires no live Run for the Project, rejects a directory owned by another Project, preserves Carrent history, updates the path for every Association and Thread, and detaches every Runtime Session for the Project.
- Rewind data that can still be validated as the same repository remains usable after relocation; unverifiable prior points become Rewind Barriers. Relocation failure leaves all state unchanged.
- Thread archive is reversible and allowed only when the Thread is idle with no queued messages. Archive preserves all Thread-owned data, Runtime Sessions, rewind data, pin state and Thread Activity Time, but disables new Runs.
- Archived Threads are managed in one Settings area. Restore returns to the original parents and stays on Settings with an explicit Open action. Permanent deletion is available only there for an individual Thread.
- Permanent Thread deletion atomically removes all Carrent-owned Thread data, attachment snapshots, composer state, queued work, Run Checklist, Runtime Session mappings and rewind data. It never reverses Run Changes or changes project files, Git refs, HEAD, branch, index, stash or commits.
- Association removal atomically deletes the Association, its Thread Draft and all Threads owned by that Workspace-Project pair. Workspace deletion atomically deletes its Associations, Thread Drafts and Threads. Both are blocked before confirmation if any affected Thread has a live Run.
- Association removal and Workspace deletion preserve the shared Project and its other Associations. A Project record disappears only after its final Association is removed. Project Working Directory content is always preserved.
- Rename, alias, pin, archive and restore do not require confirmation. Permanent Archived Thread deletion, Association removal and Workspace deletion use standard confirmation without typed-name entry. Cascade confirmations show affected Thread counts and clarify that project directories and other Workspaces are unaffected.
- Live Runs permit Workspace/Project/Association/Thread rename and pin changes. They block archive of the same Thread, relocation of the same Project and deletion of any containing object.
- After archiving the current Thread, select the next active Thread in the same Project by current order or open Project overview. After Association removal, open Workspace overview. After Workspace deletion, select the next Workspace, then previous, then global first-use state. Permanent deletion in Settings stays in the archive area and selects the next item.
- Treat no Workspace as the global first-use state. Treat empty Workspace and empty Project as valid local states. New Thread from Project overview opens the Association's Thread Draft rather than creating a zero-message Thread.
- Empty Attention and search states replace only their list region. Project Working Directory unavailable and target content load failure replace only the affected right content surface while preserving resolvable navigation and hierarchy.
- Project Working Directory unavailable shows the recorded path, blocks new Runs and offers Recheck and Relocate Directory. Successful recovery returns to the prior Project/Thread position with history replacement; cancellation or failure stays in the error state.
- A valid identity whose content failed to load offers Retry and Open Parent Overview. Retry success replaces the current route; explicit parent navigation adds history. This state must not be labelled as data corruption.
- Persist each Workspace's last visited Thread and the app's last active Workspace/Thread. Startup restore uses those values only when their ownership chain remains valid; otherwise use the established nearest valid fallback without adding history.
- Use a new App State Snapshot schema and do not migrate the current old development schema. Recognized old development data triggers one automatic, unconfirmed reset of Carrent-owned app data, creation of an empty new snapshot and one informational notice.
- Old-data cleanup includes the old App State Snapshot, Runtime Session mappings, attachment store and old projectless-chat internal directories. It must not scan or modify Project Working Directories, project files, Git state or old Carrent private refs; old refs may remain orphaned.
- Any failure during recognized-old-data cleanup or creation of the new snapshot blocks initialization. The app must not expose mixed old/new or partially initialized state.
- The persistence layer must distinguish a genuinely uninitialized/reset app from an expected App State Snapshot that is missing. First use produces the empty state; unexpected loss of an established snapshot enters corruption recovery.
- The target reader accepts only explicitly supported schema versions. Unknown schema versions preserve the original file and block data-layer startup; no automatic clearing or implicit migration is allowed.
- App State writes and destructive multi-record operations are atomic. Validation covers record shapes, global IDs, Workspace name uniqueness, Project directory uniqueness, Association references, Thread ownership and every persisted cross-reference required by the schema.
- App State Snapshot validation is all-or-nothing. Malformed JSON, partial writes, invalid record shapes or internal reference inconsistency enter a global recovery state; the Renderer must not display a partially normalized subset.
- The global recovery state blocks normal navigation, Runs and all data writes. It offers Re-read, Copy Diagnostics and Full Reset only; no import, export, backup restore, partial repair or inferred reconstruction is provided.
- Full Reset is explicitly user initiated and requires a second confirmation describing permanent deletion of Carrent app data and preservation of Project Working Directories, project files, Git state and Carrent private refs.
- Successful Re-read restores normal operation in the current Main Window and restores/falls back from the saved route using history replacement. Successful Full Reset creates empty state, opens first use and shows one reset notice. Failed reset remains blocked and adds failure diagnostics.
- Diagnostic copy may include app version, subsystem, failure stage, error summary, data path, timestamp and identifiable Workspace/Project/Thread/Runtime/attachment IDs. It must exclude full App State, message bodies, composer/Draft text, attachment content, Provider configuration and other sensitive payloads.
- Missing Runtime Session mapping means no continuity handle and starts a new Session on the next Run. A structurally invalid mapping is detached before Run with one non-blocking notice and does not block Thread history or other Runs.
- Runtime rejection of a resumed Session fails the current Run without silent replay. The Thread offers Remove Runtime Session and Retry; the action changes only that Runtime ID + Thread ID mapping.
- Attachment storage remains Carrent-owned and separate from App State. Persist metadata/reference identity in App State and store snapshot bytes in the attachment store. Never fall back to the original file path when a stored snapshot is missing or unreadable.
- A missing/unreadable historical attachment renders as unavailable while preserving its message and allowing future Runs. An unavailable attachment in Thread Draft blocks send until removed or replaced.
- When App State is valid, attachment files unreferenced by any message, existing-Thread composer state, queue or Thread Draft may be deleted automatically. Do not attempt orphan reconciliation when App State itself cannot be trusted.
- Retain one Main Window. Repeated application launch focuses it without route changes; valid deep links focus and navigate it; Settings does not create another window.
- Closing the Main Window exits Carrent. If Runs are live, show confirmation; confirmation cancels the Runs and exits, while cancellation returns to the app. Runs never continue after the window is closed.
- On startup, persisted running Runs and running Agent Activity become cancelled while produced messages/activity remain. Pending Approval Requests, questions and running Subagent Tasks become interrupted. Carrent never automatically resumes a Run; the user sends a new message to start work.

## Testing Decisions

- Tests assert externally observable domain, persistence, navigation and UI behavior rather than private React state, internal helper call order or storage implementation details.
- The primary Renderer seam mounts the application shell and Workspace provider with a MemoryRouter and a fake preload bridge. Tests drive user-visible commands and routes, then assert rendered hierarchy, selected context, navigation history, empty/error states and persisted bridge requests.
- Cover representative end-to-end Renderer journeys at this seam: first-use Workspace creation; Project creation/reuse across Workspaces; Thread Draft first send; Workspace switching and last-location restore; three-level route validation and fallback; Attention navigation and Back restoration; search scope/ranking/open behavior; archive/restore/delete; Association/Workspace cascade behavior; directory unavailable/recovery; Settings entry/return; restart-normalized state; global corruption recovery.
- The persistence seam uses the existing Workspace Store plus Workspace IPC boundary. Tests round-trip the complete new schema, reject invalid cross-references, verify atomic replacement, exercise known-old-data reset, preserve unknown schema files, distinguish first use from unexpected snapshot loss, and verify failure never exposes partial state.
- Persistence tests inject filesystem failures at delete, rename and final write boundaries for recognized-old-data reset, Full Reset and destructive operations. Each assertion checks either the complete before-state or complete after-state, never an intermediate state.
- Runtime Session tests use the existing provider-session store/session-manager boundary to verify Runtime ID + Thread ID keys, Project relocation detachment, missing mappings, invalid mapping isolation, Runtime resume rejection and explicit remove-and-retry without silent duplicate dispatch.
- Attachment tests use the existing attachment-store and Workspace state cleanup boundaries to verify historical unavailable rendering inputs, Draft send blocking, exact snapshot-path behavior, cascade cleanup, reference preservation and orphan deletion only after valid App State reconciliation.
- Pure domain tests are reserved for high-combination invariants that are cheaper and clearer below the mounted application seam: Workspace name uniqueness, directory-to-Project identity, Association/Thread ownership validation, Thread Status priority, Thread Activity Time updates, pinned/activity ordering, Attention grouping, search ranking and deterministic post-removal selection.
- Route tests cover the concrete three-level path builders and resolvers, ownership mismatch, old-route fallback, nearest-valid-parent fallback and history push-versus-replace behavior.
- Component-level tests cover accessibility and layout commands that are not reliably asserted through data-state tests: selected navigation semantics, dialogs, menu actions, pane collapse controls, Settings Tabs, unavailable attachment labels and destructive confirmation text.
- Reuse the repository's existing Bun test style, happy-dom React mounting, MemoryRouter usage, Workspace Store tests, Workspace IPC tests, WorkspaceContext behavior tests, route resolver tests, Sidebar navigation tests, attachment-store tests and provider-session tests as prior art.
- Do not add an Electron E2E or Playwright test framework solely for this refactor. The retained 58px/280px pane geometry, resize limits, 1080x720 minimum window and prototype-matched visual composition receive component assertions plus manual desktop verification.
- Manual verification covers the four primary screens, middle-pane resize/collapse, minimum-window behavior, long Project/Thread names, all confirmation dialogs, empty/loading/corruption states, Attention and search transitions, and one full restart cycle with persisted navigation and Thread Draft.

## Out of Scope

- Migrating or preserving current old development App State, projectless Chats, Messages, Thread Work, attachments, Runtime Session mappings, IDs or old routes.
- Workspace import, export, backup, restore format or support for manually copying/replacing Carrent app data.
- Workspace, Project or Thread duplication; Thread movement between parents; nested Workspaces; projectless General Chat.
- Global Project deletion or any operation that moves, copies, deletes or edits Project Working Directory contents.
- Cloud sync, accounts, permissions, collaboration, remote project management or cross-machine identity.
- Multiple Main Windows, separate Settings windows, background Runs after window close or cross-window state coordination.
- Landing site, mobile UI, automatic narrow-window navigation modes or a redesign of the existing desktop shell.
- Redesigning Message Timeline, Composer, Run, Agent Activity, Plan Review, Run Checklist or Thread Rewind beyond the hierarchy context and lifecycle behavior explicitly required here.
- Changing Runtime or Agent Loop protocols except for carrying the stable Thread/Project context already required by existing dispatch and Runtime Session ownership.
- New Runtime providers, Provider Profile behavior, model discovery, Local MCP Server behavior or Global Agent Instructions behavior.
- Searching message bodies, attachments, Agent Activity, command output, Thread Drafts or Archived Threads.
- A global Running view, global pinned view, recent-view page, notification center or dedicated Recovery Center.
- Automatic repair of corrupted App State, unsupported schema migration, or recovery from project/Git changes caused by Runs.
- Building new Electron E2E/Playwright infrastructure as part of this refactor.

## Further Notes

- The canonical domain language is defined in the Desktop App context glossary. Implementation should update that glossary only if a genuinely new domain term is introduced; implementation-specific storage or component names do not belong there.
- Navigation decisions were validated by the low-fidelity prototype archived on `codex/prototype-workspace-navigation` at commit `812517207fcb0528f7e948805ef82fb6737c46f4`.
- Screen and pane decisions were validated by the prototype archived on `codex/prototype-screen-pane-behavior` at commit `3732c42`.
- Empty, missing and recovery-state decisions were validated by the prototype archived on `codex/prototype-empty-recovery-states` at commit `2759fcd`.
- Existing attachment ADRs continue to require Carrent-owned snapshot files outside Project Working Directories and exact read-only Runtime access. Existing rewind ADRs continue to require transactional rewind behavior, no Git history rewriting and Runtime Session detachment where specified.
- This specification is intentionally a full replacement of the current flat/projectless information architecture. Implementation plans should use vertical user-visible slices while preserving the final schema and invariants described here.
